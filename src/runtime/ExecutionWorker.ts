import { AgentRuntime } from './AgentRuntime';
import { AgentDefinition, ExecutionResult, RunCheckpoint } from '../types';
import { ExecutionStore } from './ExecutionStore';
import { createPersistenceCallbacks } from './persistence';

export interface ExecutionWorkerOptions {
  executionId?: string;
  runInput?: Record<string, unknown>;
  cancelSignal?: { aborted?: boolean; cancelled?: boolean } | (() => boolean);
}

/**
 * SaaS worker layer that owns persistence and resume semantics.
 *
 * The runtime stays stateless, while the worker is responsible for durable
 * execution state and scheduling policy.
 */
export class ExecutionWorker {
  constructor(
    private readonly runtime: AgentRuntime,
    private readonly store: ExecutionStore,
  ) {}

  async run(
    definition: AgentDefinition,
    options: ExecutionWorkerOptions = {},
  ): Promise<ExecutionResult> {
    const executionId = options.executionId ?? cryptoId();
    const resumeCheckpoint = options.executionId
      ? await this.store.loadLatestCheckpoint(executionId)
      : undefined;

    const result = await this.runtime.run(definition, {
      executionId,
      runInput: options.runInput ?? {},
      resumeFromCheckpoint: resumeCheckpoint,
      cancelSignal: options.cancelSignal,
      callbacks: createPersistenceCallbacks({
        saveStepEvent: async (event) => this.store.saveStepEvent(event),
        saveCheckpoint: async (checkpoint) => this.store.saveCheckpoint(checkpoint),
        saveRunResult: async (execution) => this.store.saveRunResult(execution),
      }),
    });

    return result;
  }

  async cancel(executionId: string): Promise<void> {
    const checkpoint = await this.store.loadLatestCheckpoint(executionId);
    if (checkpoint) {
      checkpoint.status = 'cancelled';
      await this.store.saveCheckpoint(checkpoint);
    }
  }

  async loadCheckpoint(executionId: string): Promise<RunCheckpoint | undefined> {
    return this.store.loadLatestCheckpoint(executionId);
  }
}

function cryptoId(): string {
  return `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
