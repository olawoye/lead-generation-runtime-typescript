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
    const valid = this.validate(raw);
    if (!valid) {
      throw new AgentDefinitionValidationError(
        'Invalid AgentDefinition: schema validation failed',
        this.validate.errors ?? [],
      );
    }
    const def = raw as AgentDefinition;
    this.validateSemantics(def);
    return def;
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
