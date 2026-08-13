import { v4 as uuidv4 } from 'uuid';
import {
  AgentDefinition,
  ExecutionResult,
  ExecutionStatus,
  StepResult,
  StepStatus,
  LLMRequest,
  RunCheckpoint,
  RuntimeCallbacks,
  StepLifecycleEvent,
  RunInput,
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
  /** Stable execution ID supplied by the SaaS host for resume / persistence flows. */
  executionId?: string;
  /** Global default step timeout in ms. Overridden by definition/step values. */
  defaultTimeoutMs?: number;
  /** Initial inputs injected into every execution context. */
  inputs?: Record<string, unknown>;
  /** SaaS-owned run input payload for a single execution. */
  runInput?: RunInput;
  /** Resume from a previously persisted checkpoint. */
  resumeFromCheckpoint?: RunCheckpoint;
  /** Optional cancellation signal. */
  cancelSignal?: { aborted?: boolean; cancelled?: boolean } | (() => boolean);
  /** Stateless lifecycle callbacks so the app can persist event/checkpoint state. */
  callbacks?: RuntimeCallbacks;
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
    const executionId = options.executionId ?? uuidv4();
    const startedAt = new Date();
    const runInput = (options.runInput ?? options.inputs ?? {}) as Record<string, unknown>;
    const callbacks = options.callbacks ?? {};

    const ctx = new ExecutionContext(
      executionId,
      definition.id,
      runInput,
    );

    if (options.resumeFromCheckpoint) {
      for (const result of options.resumeFromCheckpoint.stepResults) {
        ctx.recordResult(result);
        if (result.output !== undefined) {
          ctx.setOutput(result.stepId, result.output);
        }
      }
    }

    this.emitter.emit('execution.started', executionId, {
      agentId: definition.id,
      agentName: definition.name,
      runInput,
    });
    callbacks.onRunStart?.({
      executionId,
      agentId: definition.id,
      runInput,
      startedAt,
    });

    const resolvedSteps = this.resolver.resolve(
      definition.steps,
      definition.defaultRetry,
      definition.defaultTimeoutMs ?? options.defaultTimeoutMs,
    );

    let executionStatus: ExecutionStatus = 'running';
    let executionError: string | undefined;

    for (const resolved of resolvedSteps) {
      if (options.resumeFromCheckpoint && options.resumeFromCheckpoint.completedStepIds.includes(resolved.definition.id)) {
        continue;
      }

      if (this.isCancelled(options.cancelSignal)) {
        executionStatus = 'cancelled';
        executionError = 'Execution cancelled by caller';
        break;
      }

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

      const result = await this.executeStep(resolved, ctx, executionId, runInput, callbacks);
      ctx.recordResult(result);

      if (result.status === 'failed' || result.status === 'timed_out') {
        executionStatus = 'failed';
        executionError = result.error;
      }

      const checkpoint = this.buildCheckpoint(
        executionId,
        definition.id,
        executionStatus === 'failed' ? 'failed' : 'running',
        startedAt,
        new Date(),
        runInput,
        [...ctx.getResults()],
        result,
        executionError,
      );

      callbacks.onCheckpoint?.(checkpoint);
      this.emitter.emit('execution.started', executionId, { checkpoint });
    }

    if (executionStatus === 'running') {
      executionStatus = 'succeeded';
    }

    const finishedAt = new Date();
    const finalResults = [...ctx.getResults()];
    const finalOutput = finalResults.length > 0 ? finalResults[finalResults.length - 1].output : undefined;
    const finalCheckpoint = this.buildCheckpoint(
      executionId,
      definition.id,
      executionStatus,
      startedAt,
      finishedAt,
      runInput,
      finalResults,
      undefined,
      executionError,
      finalOutput,
    );

    const executionResult: ExecutionResult = {
      executionId,
      agentId: definition.id,
      status: executionStatus,
      stepResults: finalResults,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      finalOutput,
      checkpoint: finalCheckpoint,
      error: executionError,
    };

    if (executionStatus === 'failed' || executionStatus === 'cancelled') {
      callbacks.onRunError?.({
        executionId,
        agentId: definition.id,
        status: executionStatus,
        error: executionError ?? 'Execution failed',
        checkpoint: finalCheckpoint,
      });
    }

    callbacks.onCheckpoint?.(finalCheckpoint);
    callbacks.onRunEnd?.(executionResult);

    this.emitter.emit(
      executionStatus === 'succeeded' ? 'execution.succeeded' : executionStatus === 'cancelled' ? 'execution.failed' : 'execution.failed',
      executionId,
      { agentId: definition.id, status: executionStatus, checkpoint: finalCheckpoint },
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
    runInput: RunInput,
    callbacks: RuntimeCallbacks,
  ): Promise<StepResult> {
    const { definition, retry, timeoutMs } = resolved;
    const stepInputs = ctx.buildStepInputs(
      definition.params,
      definition.dependsOn,
    );

    const stepStartEvent: StepLifecycleEvent = {
      executionId,
      agentId: definition.id,
      stepId: definition.id,
      stepName: definition.name,
      status: 'running',
      startedAt: new Date(),
      inputs: stepInputs,
    };

    callbacks.onStepStart?.(stepStartEvent);
    this.emitter.emit('step.started', executionId, { stepId: definition.id, stepName: definition.name, payload: stepStartEvent });

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
        const stepEvent: StepLifecycleEvent = {
          executionId,
          agentId: definition.id,
          stepId: definition.id,
          stepName: definition.name,
          status: 'succeeded',
          attempt: attempts,
          startedAt,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          output,
          inputs: stepInputs,
        };
        callbacks.onStepResult?.(stepEvent);
        this.emitter.emit('step.succeeded', executionId, { stepId: definition.id, output, payload: stepEvent });
        return result;
      }

      if (stepStatus === 'timed_out') {
        const finishedAt = new Date();
        const stepEvent: StepLifecycleEvent = {
          executionId,
          agentId: definition.id,
          stepId: definition.id,
          stepName: definition.name,
          status: 'timed_out',
          attempt: attempts,
          startedAt,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          error: lastError,
          inputs: stepInputs,
        };
        callbacks.onStepResult?.(stepEvent);
        this.emitter.emit('step.timed_out', executionId, { stepId: definition.id, payload: stepEvent });
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
    const stepEvent: StepLifecycleEvent = {
      executionId,
      agentId: definition.id,
      stepId: definition.id,
      stepName: definition.name,
      status: 'failed',
      attempt: attempts,
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      error: lastError,
      inputs: stepInputs,
    };
    callbacks.onStepResult?.(stepEvent);
    this.emitter.emit('step.failed', executionId, { stepId: definition.id, error: lastError, payload: stepEvent });
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

  private isCancelled(cancelSignal?: OrchestratorOptions['cancelSignal']): boolean {
    if (!cancelSignal) return false;
    if (typeof cancelSignal === 'function') return cancelSignal();
    if ('aborted' in cancelSignal && cancelSignal.aborted) return true;
    if ('cancelled' in cancelSignal && cancelSignal.cancelled) return true;
    return false;
  }

  private buildCheckpoint(
    executionId: string,
    agentId: string,
    status: ExecutionStatus,
    startedAt: Date,
    updatedAt: Date,
    runInput: RunInput,
    stepResults: StepResult[],
    lastStepResult?: StepResult,
    error?: string,
    finalOutput?: unknown,
  ): RunCheckpoint {
    return {
      executionId,
      agentId,
      status,
      createdAt: startedAt,
      updatedAt,
      runInput,
      completedStepIds: stepResults.map((result) => result.stepId),
      currentStepId: lastStepResult?.stepId,
      stepResults,
      finalOutput: finalOutput ?? lastStepResult?.output,
      error,
    };
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
