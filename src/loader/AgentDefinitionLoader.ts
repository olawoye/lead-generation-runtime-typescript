import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { AgentDefinition } from '../types';

// ---------------------------------------------------------------------------
// JSON Schema for AgentDefinition v1.0
// ---------------------------------------------------------------------------

const retryPolicySchema = {
  type: 'object',
  required: ['maxAttempts', 'backoffMs'],
  properties: {
    maxAttempts: { type: 'integer', minimum: 1, maximum: 10 },
    backoffMs: { type: 'integer', minimum: 0 },
    backoffMultiplier: { type: 'number', minimum: 1 },
  },
  additionalProperties: false,
};

const stepDefinitionSchema = {
  type: 'object',
  required: ['id', 'name', 'type'],
  properties: {
    id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    type: { type: 'string', enum: ['tool', 'llm', 'noop'] },
    tool: { type: 'string', minLength: 1 },
    provider: { type: 'string', minLength: 1 },
    params: { type: 'object' },
    dependsOn: { type: 'array', items: { type: 'string' } },
    retry: retryPolicySchema,
    timeoutMs: { type: 'integer', minimum: 1 },
    inputHints: { type: 'array', items: { type: 'string' } },
    outputHints: { type: 'array', items: { type: 'string' } },
    queryStrategy: { type: 'string' },
    queryTemplates: { type: 'array', items: { type: 'string' } },
    negativeTerms: { type: 'array', items: { type: 'string' } },
    entityFocus: { type: 'string', enum: ['company', 'person', 'lead', 'event', 'signal'] },
    extractionContract: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['company', 'person', 'lead', 'event', 'signal'] },
        fields: { type: 'array', items: { type: 'string' } },
        mode: { type: 'string', enum: ['llm', 'schema', 'regex', 'hybrid'] },
        requiredFields: { type: 'array', items: { type: 'string' } },
        outputKey: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

const agentDefinitionSchema = {
  type: 'object',
  required: ['version', 'id', 'name', 'steps'],
  properties: {
    version: { type: 'string', enum: ['1.0'] },
    id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    steps: {
      type: 'array',
      minItems: 1,
      items: stepDefinitionSchema,
    },
    defaultRetry: retryPolicySchema,
    defaultTimeoutMs: { type: 'integer', minimum: 1 },
  },
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AgentDefinitionValidationError extends Error {
  constructor(
    message: string,
    public readonly validationErrors: unknown[],
  ) {
    super(message);
    this.name = 'AgentDefinitionValidationError';
  }
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * AgentDefinitionLoader validates and returns a typed AgentDefinition.
 *
 * It is deliberately decoupled from any specific agent (e.g. lead-discovery)
 * so the same loader can handle future agent definitions.
 */
export class AgentDefinitionLoader {
  private readonly validate: ValidateFunction;

  constructor() {
    const ajv = new Ajv({ allErrors: true });
    addFormats(ajv);
    this.validate = ajv.compile(agentDefinitionSchema);
  }

  /**
   * Load and validate a raw definition object.
   *
   * @param raw - Parsed JSON / plain object to validate.
   * @returns A fully-typed AgentDefinition.
   * @throws {AgentDefinitionValidationError} if validation fails.
   */
  load(raw: unknown): AgentDefinition {
    const normalized = this.normalizeDefinition(raw);
    const valid = this.validate(normalized);
    if (!valid) {
      throw new AgentDefinitionValidationError(
        'Invalid AgentDefinition: schema validation failed',
        this.validate.errors ?? [],
      );
    }
    this.validateSemantics(normalized);
    return normalized;
  }

  /**
   * Accept both the legacy runtime definition and the provider-neutral
   * declarative definition shape used by the definition repo.
   */
  private normalizeDefinition(raw: unknown): AgentDefinition {
    if (!raw || typeof raw !== 'object') {
      throw new AgentDefinitionValidationError('AgentDefinition input must be an object', []);
    }

    const candidate = raw as Record<string, unknown>;

    const isDeclarativeDefinition =
      candidate.apiVersion === 'agent.definition/v1' &&
      candidate.kind === 'AgentDefinition' &&
      candidate.spec && typeof candidate.spec === 'object';

    if (!isDeclarativeDefinition) {
      return raw as AgentDefinition;
    }

    const metadata = (candidate.metadata ?? {}) as Record<string, unknown>;
    const spec = candidate.spec as Record<string, unknown>;
    const policies = (spec.policies ?? {}) as Record<string, unknown>;
    const steps = Array.isArray(spec.steps) ? spec.steps : [];

    const defaultRetry = this.normalizeRetryConfig(
      (policies.maxRetries ?? policies.max_retries) !== undefined
        ? {
            maxAttempts: Number(policies.maxRetries ?? policies.max_retries),
            backoffMs: 0,
          }
        : undefined,
    );

    const defaultTimeoutMs =
      typeof policies.timeoutSeconds === 'number' || typeof policies.timeout_seconds === 'number'
        ? ((Number(policies.timeoutSeconds ?? policies.timeout_seconds) || 0) * 1000)
        : undefined;

    return {
      version: '1.0',
      id: String((metadata.name as string) ?? 'unnamed-agent'),
      name: String((metadata.displayName as string) ?? (metadata.name as string) ?? 'Unnamed Agent'),
      description: typeof metadata.description === 'string' ? metadata.description : undefined,
      steps: steps.map((step) => {
        const stepRecord = step as Record<string, unknown>;
        const stepPolicy = (stepRecord.policy ?? {}) as Record<string, unknown>;
        const retryConfig = this.normalizeRetryConfig(
          (stepRecord.retry_policy as Record<string, unknown>) ??
            ((stepRecord.retry ?? {}) as Record<string, unknown>),
        );
        const stepTimeoutMs =
          typeof stepPolicy.timeoutSeconds === 'number' || typeof stepPolicy.timeout_seconds === 'number'
            ? ((Number(stepPolicy.timeoutSeconds ?? stepPolicy.timeout_seconds) || 0) * 1000)
            : undefined;

        const toolIds = Array.isArray(stepRecord.tools) ? stepRecord.tools : [];
        const toolName = typeof toolIds[0] === 'string' ? toolIds[0] : undefined;
        const staticParams = {
          ...(typeof stepRecord.configuration === 'object' && stepRecord.configuration ? stepRecord.configuration : {}),
          ...(typeof stepRecord.objective !== 'undefined' ? { objective: stepRecord.objective } : {}),
          ...(typeof stepRecord.inputs !== 'undefined' ? { inputs: stepRecord.inputs } : {}),
          ...(typeof stepRecord.outputs !== 'undefined' ? { outputs: stepRecord.outputs } : {}),
          ...(typeof stepRecord.next_steps !== 'undefined' ? { next_steps: stepRecord.next_steps } : {}),
          ...(typeof stepRecord.quality_rules !== 'undefined' ? { quality_rules: stepRecord.quality_rules } : {}),
          ...(typeof stepRecord.enabled !== 'undefined' ? { enabled: stepRecord.enabled } : {}),
        };

        const extractionContract =
          typeof stepRecord.extractionContract === 'object' && stepRecord.extractionContract !== null
            ? {
                target: typeof (stepRecord.extractionContract as Record<string, unknown>).target === 'string'
                  ? ((stepRecord.extractionContract as Record<string, unknown>).target as string)
                  : undefined,
                fields: Array.isArray((stepRecord.extractionContract as Record<string, unknown>).fields)
                  ? ((stepRecord.extractionContract as Record<string, unknown>).fields as unknown[]).map(String)
                  : undefined,
                mode: typeof (stepRecord.extractionContract as Record<string, unknown>).mode === 'string'
                  ? ((stepRecord.extractionContract as Record<string, unknown>).mode as string)
                  : undefined,
                requiredFields: Array.isArray((stepRecord.extractionContract as Record<string, unknown>).requiredFields)
                  ? ((stepRecord.extractionContract as Record<string, unknown>).requiredFields as unknown[]).map(String)
                  : undefined,
                outputKey: typeof (stepRecord.extractionContract as Record<string, unknown>).outputKey === 'string'
                  ? String((stepRecord.extractionContract as Record<string, unknown>).outputKey)
                  : undefined,
              }
            : undefined;

        return {
          id: String(stepRecord.id ?? 'unnamed-step'),
          name: String(stepRecord.name ?? stepRecord.id ?? 'Unnamed Step'),
          type: toolName ? 'tool' : 'noop',
          tool: toolName,
          params: Object.keys(staticParams).length > 0 ? staticParams : undefined,
          dependsOn: Array.isArray(stepRecord.dependsOn) ? stepRecord.dependsOn.map(String) : [],
          inputHints: Array.isArray(stepRecord.inputHints) ? stepRecord.inputHints.map(String) : undefined,
          outputHints: Array.isArray(stepRecord.outputHints) ? stepRecord.outputHints.map(String) : undefined,
          queryStrategy: typeof stepRecord.queryStrategy === 'string' ? stepRecord.queryStrategy : undefined,
          queryTemplates: Array.isArray(stepRecord.queryTemplates) ? stepRecord.queryTemplates.map(String) : undefined,
          negativeTerms: Array.isArray(stepRecord.negativeTerms) ? stepRecord.negativeTerms.map(String) : undefined,
          entityFocus: typeof stepRecord.entityFocus === 'string' ? stepRecord.entityFocus as StepDefinition['entityFocus'] : undefined,
          extractionContract,
          retry: retryConfig,
          timeoutMs: stepTimeoutMs,
        };
      }),
      defaultRetry,
      defaultTimeoutMs,
    };
  }

  private normalizeRetryConfig(
    value?: Record<string, unknown>,
  ): AgentDefinition['defaultRetry'] | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const maxAttempts =
      typeof value.maxAttempts === 'number'
        ? value.maxAttempts
        : typeof value.max_attempts === 'number'
          ? value.max_attempts
          : undefined;

    const backoffMs =
      typeof value.backoffMs === 'number'
        ? value.backoffMs
        : typeof value.backoff_ms === 'number'
          ? value.backoff_ms
          : undefined;

    const backoffMultiplier =
      typeof value.backoffMultiplier === 'number'
        ? value.backoffMultiplier
        : typeof value.backoff_multiplier === 'number'
          ? value.backoff_multiplier
          : undefined;

    if (typeof maxAttempts !== 'number' && typeof backoffMs !== 'number') {
      return undefined;
    }

    return {
      maxAttempts: Number(maxAttempts ?? 1),
      backoffMs: Number(backoffMs ?? 0),
      ...(typeof backoffMultiplier === 'number' ? { backoffMultiplier } : {}),
    };
  }

  /**
   * Additional semantic checks that JSON Schema alone cannot express.
   */
  private validateSemantics(def: AgentDefinition): void {
    const ids = new Set<string>();
    for (const step of def.steps) {
      if (ids.has(step.id)) {
        throw new AgentDefinitionValidationError(
          `Duplicate step id "${step.id}" in agent "${def.id}"`,
          [],
        );
      }
      ids.add(step.id);
    }

    for (const step of def.steps) {
      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          if (!ids.has(dep)) {
            throw new AgentDefinitionValidationError(
              `Step "${step.id}" depends on unknown step "${dep}" in agent "${def.id}"`,
              [],
            );
          }
        }
      }
      if (step.type === 'tool' && !step.tool) {
        throw new AgentDefinitionValidationError(
          `Step "${step.id}" has type "tool" but no "tool" field in agent "${def.id}"`,
          [],
        );
      }
      if (step.type === 'llm' && !step.provider) {
        throw new AgentDefinitionValidationError(
          `Step "${step.id}" has type "llm" but no "provider" field in agent "${def.id}"`,
          [],
        );
      }
    }
  }
}
