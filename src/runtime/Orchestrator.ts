import { v4 as uuidv4 } from 'uuid';
import {
  AgentDefinition,
  ExecutionResult,
  ExecutionStatus,
  StepResult,
  StepStatus,
  LLMRequest,
} from '../types';
import { ExecutionContext } from '../context/ExecutionContext';
import { ToolInvoker } from '../mcp/ToolInvoker';
import { LLMAdapterRegistry, LLMProviderNotFoundError } from '../llm/LLMProviderAdapter';
import { ObservabilityEmitter } from '../observability/ObservabilityEmitter';
import { StepResolver, ResolvedStep } from '../resolver/StepResolver';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface OrchestratorOptions {
  /** Global default step timeout in ms. Overridden by definition/step values. */
  defaultTimeoutMs?: number;
  /** Initial inputs injected into every execution context. */
  inputs?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class OrchestratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrchestratorError';
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Orchestrator is the heart of the runtime.
 *
 * Responsibilities:
 *  - Iterate through ResolvedSteps in declaration order.
 *  - Wait for declared dependencies (dependsOn) to complete successfully.
 *  - Dispatch each step to the correct handler (tool / llm / noop).
 *  - Apply per-step retry/backoff logic.
 *  - Enforce per-step timeouts.
 *  - Record every result in the ExecutionContext.
 *  - Emit structured observability events.
 *  - Return a complete ExecutionResult.
 *
 * The Orchestrator is NOT coupled to any specific agent; it works with any
 * valid AgentDefinition.
 */
export class Orchestrator {
  private readonly resolver = new StepResolver();

  constructor(
    private readonly toolInvoker: ToolInvoker,
    private readonly llmRegistry: LLMAdapterRegistry,
    private readonly emitter: ObservabilityEmitter,
  ) {}

  async execute(
    definition: AgentDefinition,
    options: OrchestratorOptions = {},
  ): Promise<ExecutionResult> {
    const executionId = uuidv4();
    const startedAt = new Date();

    const ctx = new ExecutionContext(
      executionId,
      definition.id,
      options.inputs ?? {},
    );

    this.emitter.emit('execution.started', executionId, {
      agentId: definition.id,
      agentName: definition.name,
    });

    const resolvedSteps = this.resolver.resolve(
      definition.steps,
      definition.defaultRetry,
      definition.defaultTimeoutMs ?? options.defaultTimeoutMs,
    );

    let executionStatus: ExecutionStatus = 'running';
    let executionError: string | undefined;

    for (const resolved of resolvedSteps) {
      const dep = resolved.definition.dependsOn ?? [];
      if (dep.length > 0 && !ctx.allSucceeded(dep)) {
        const skippedResult = this.makeSkippedResult(resolved, 'Dependencies did not all succeed');
        ctx.recordResult(skippedResult);
        this.emitter.emit('step.failed', executionId, {
          stepId: resolved.definition.id,
          reason: 'skipped – dependencies not met',
        });
        continue;
      }

      const result = await this.executeStep(resolved, ctx, executionId);
      ctx.recordResult(result);

      if (result.status === 'failed' || result.status === 'timed_out') {
        executionStatus = 'failed';
        executionError = result.error;
      }
    }

    if (executionStatus === 'running') {
      executionStatus = 'succeeded';
    }

    const finishedAt = new Date();
    const executionResult: ExecutionResult = {
      executionId,
      agentId: definition.id,
      status: executionStatus,
      stepResults: [...ctx.getResults()],
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      error: executionError,
    };

    this.emitter.emit(
      executionStatus === 'succeeded' ? 'execution.succeeded' : 'execution.failed',
      executionId,
      { agentId: definition.id, status: executionStatus },
    );

    return executionResult;
  }

  // ---------------------------------------------------------------------------
  // Step execution with retry
  // ---------------------------------------------------------------------------

  private async executeStep(
    resolved: ResolvedStep,
    ctx: ExecutionContext,
    executionId: string,
  ): Promise<StepResult> {
    const { definition, retry, timeoutMs } = resolved;
    const stepInputs = ctx.buildStepInputs(
      definition.params,
      definition.dependsOn,
    );

    this.emitter.emit('step.started', executionId, { stepId: definition.id });

    const startedAt = new Date();
    let lastError = '';
    let attempts = 0;
    let backoff = retry.backoffMs;

    for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
      attempts = attempt;
      if (attempt > 1) {
        this.emitter.emit('step.retry', executionId, {
          stepId: definition.id,
          attempt,
          backoffMs: backoff,
        });
        await this.sleep(backoff);
        backoff = Math.round(backoff * (retry.backoffMultiplier ?? 1));
      }

      let output: unknown;
      let stepStatus: StepStatus = 'succeeded';
      let error: string | undefined;

      try {
        output = await this.dispatchStep(definition, stepInputs, timeoutMs, executionId);
      } catch (err) {
        stepStatus = err instanceof TimeoutError ? 'timed_out' : 'failed';
        error = err instanceof Error ? err.message : String(err);
        lastError = error;
      }

      if (stepStatus === 'succeeded') {
        ctx.setOutput(definition.id, output);
        const finishedAt = new Date();
        const result: StepResult = {
          stepId: definition.id,
          stepName: definition.name,
          status: 'succeeded',
          output,
          attempts,
          startedAt,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
        };
        this.emitter.emit('step.succeeded', executionId, { stepId: definition.id, output });
        return result;
      }

      if (stepStatus === 'timed_out') {
        const finishedAt = new Date();
        this.emitter.emit('step.timed_out', executionId, { stepId: definition.id });
        return {
          stepId: definition.id,
          stepName: definition.name,
          status: 'timed_out',
          error: lastError,
          attempts,
          startedAt,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
        };
      }
    }

    const finishedAt = new Date();
    this.emitter.emit('step.failed', executionId, { stepId: definition.id, error: lastError });
    return {
      stepId: definition.id,
      stepName: definition.name,
      status: 'failed',
      error: lastError,
      attempts,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  }

  // ---------------------------------------------------------------------------
  // Step dispatch
  // ---------------------------------------------------------------------------

  private async dispatchStep(
    step: { type?: string; tool?: string; provider?: string; params?: Record<string, unknown> },
    inputs: Record<string, unknown>,
    timeoutMs: number,
    executionId: string,
  ): Promise<unknown> {
    const stepType = step.type ?? (step.tool ? 'tool' : step.provider ? 'llm' : 'noop');

    switch (stepType) {
      case 'tool':
        return this.dispatchTool(step.tool!, inputs, timeoutMs, executionId);
      case 'llm':
        return this.dispatchLLM(step.provider!, inputs, timeoutMs, executionId);
      case 'noop':
        return inputs;
      default:
        throw new OrchestratorError(`Unknown step type: "${stepType}"`);
    }
  }

  private async dispatchTool(
    toolName: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    executionId: string,
  ): Promise<unknown> {
    this.emitter.emit('tool.invoked', executionId, { toolName, params });

    const result = await this.withTimeout(
      this.toolInvoker.invoke({ name: toolName, params }, timeoutMs),
      timeoutMs,
      `Tool "${toolName}"`,
    );

    this.emitter.emit('tool.result', executionId, { toolName, result });

    if (!result.success) {
      throw new OrchestratorError(result.error ?? `Tool "${toolName}" returned failure`);
    }
    return result.data;
  }

  private async dispatchLLM(
    providerId: string,
    inputs: Record<string, unknown>,
    timeoutMs: number,
    executionId: string,
  ): Promise<unknown> {
    const adapter = this.llmRegistry.get(providerId);
    if (!adapter) {
      throw new LLMProviderNotFoundError(providerId);
    }

    const messages = Array.isArray(inputs['messages'])
      ? (inputs['messages'] as LLMRequest['messages'])
      : [{ role: 'user' as const, content: JSON.stringify(inputs) }];

    const request: LLMRequest = {
      messages,
      model: typeof inputs['model'] === 'string' ? inputs['model'] : undefined,
      temperature: typeof inputs['temperature'] === 'number' ? inputs['temperature'] : undefined,
      maxTokens: typeof inputs['maxTokens'] === 'number' ? inputs['maxTokens'] : undefined,
    };

    this.emitter.emit('llm.request', executionId, { providerId, request });

    const response = await this.withTimeout(
      adapter.complete(request),
      timeoutMs,
      `LLM provider "${providerId}"`,
    );

    this.emitter.emit('llm.response', executionId, { providerId, response });
    return response;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new TimeoutError(`${label} timed out after ${ms}ms`));
      }, ms);
      timer.unref();

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private makeSkippedResult(resolved: ResolvedStep, reason: string): StepResult {
    const now = new Date();
    return {
      stepId: resolved.definition.id,
      stepName: resolved.definition.name,
      status: 'skipped',
      error: reason,
      attempts: 0,
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
    };
  }
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}
