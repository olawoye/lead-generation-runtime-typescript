import {
  AgentDefinition,
  AgentRuntime,
  ExecutionResult,
  RunCheckpoint,
  StepLifecycleEvent,
  createPersistenceCallbacks,
} from '../src';

export interface StoredRun {
  executionId: string;
  agentId: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  latestCheckpoint?: RunCheckpoint;
  stepEvents: StepLifecycleEvent[];
  finalOutput?: unknown;
  error?: string;
}

/**
 * Example host-side persistence layer.
 *
 * The runtime stays stateless. The SaaS app owns this durable state and decides
 * when to resume, cancel, retry, or audit a run.
 */
export class HostRunStore {
  private readonly runs = new Map<string, StoredRun>();

  async saveStepEvent(event: StepLifecycleEvent): Promise<void> {
    const existing = this.runs.get(event.executionId) ?? {
      executionId: event.executionId,
      agentId: event.agentId,
      status: 'running',
      stepEvents: [],
    };

    existing.stepEvents.push(event);
    if (existing.agentId !== event.agentId) {
      existing.agentId = event.agentId;
    }

    this.runs.set(event.executionId, existing);
  }

  async saveCheckpoint(checkpoint: RunCheckpoint): Promise<void> {
    const existing = this.runs.get(checkpoint.executionId) ?? {
      executionId: checkpoint.executionId,
      agentId: checkpoint.agentId,
      status: checkpoint.status,
      stepEvents: [],
    };

    existing.agentId = checkpoint.agentId;
    existing.status = checkpoint.status;
    existing.latestCheckpoint = checkpoint;
    this.runs.set(checkpoint.executionId, existing);
  }

  async saveRunResult(result: ExecutionResult): Promise<void> {
    const existing = this.runs.get(result.executionId) ?? {
      executionId: result.executionId,
      agentId: result.agentId,
      status: result.status,
      stepEvents: [],
    };

    existing.agentId = result.agentId;
    existing.status = result.status;
    existing.finalOutput = result.finalOutput;
    existing.error = result.error;
    existing.latestCheckpoint = result.checkpoint;
    this.runs.set(result.executionId, existing);
  }

  async loadCheckpoint(executionId: string): Promise<RunCheckpoint | undefined> {
    return this.runs.get(executionId)?.latestCheckpoint;
  }

  async getRun(executionId: string): Promise<StoredRun | undefined> {
    return this.runs.get(executionId);
  }
}

export async function runWithSaaSStore(
  runtime: AgentRuntime,
  definition: AgentDefinition,
  store: HostRunStore,
  options: {
    runInput?: Record<string, unknown>;
    resumeExecutionId?: string;
  } = {},
): Promise<ExecutionResult> {
  const resumeCheckpoint = options.resumeExecutionId
    ? await store.loadCheckpoint(options.resumeExecutionId)
    : undefined;

  const result = await runtime.run(definition, {
    runInput: options.runInput ?? {},
    resumeFromCheckpoint: resumeCheckpoint,
    callbacks: createPersistenceCallbacks({
      saveStepEvent: (event) => store.saveStepEvent(event),
      saveCheckpoint: (checkpoint) => store.saveCheckpoint(checkpoint),
      saveRunResult: (execution) => store.saveRunResult(execution),
    }),
  });

  return result;
}

/**
 * Example host worker loop:
 * - reads pending job
 * - loads prior checkpoint if resuming
 * - executes runtime
 * - persists final state
 */
export async function processLeadGenerationJob(
  runtime: AgentRuntime,
  store: HostRunStore,
  definition: AgentDefinition,
  job: { executionId?: string; runInput?: Record<string, unknown> },
): Promise<ExecutionResult> {
  const executionId = job.executionId ?? 'job-' + Date.now();
  const previous = await store.loadCheckpoint(executionId);

  const result = await runtime.run(definition, {
    runInput: job.runInput ?? {},
    resumeFromCheckpoint: previous,
    callbacks: createPersistenceCallbacks({
      saveStepEvent: (event) => store.saveStepEvent(event),
      saveCheckpoint: (checkpoint) => store.saveCheckpoint(checkpoint),
      saveRunResult: (execution) => store.saveRunResult(execution),
    }),
  });

  return result;
}
