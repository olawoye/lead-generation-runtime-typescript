import { AgentDefinition, AgentRuntime, ExecutionResult, RunCheckpoint, StepLifecycleEvent } from '../src';
import { ExecutionStore } from '../src/runtime';

/**
 * Example app-facing repository contract for a real SaaS worker.
 *
 * This is intentionally host-owned and persistence-backed. The runtime remains
 * stateless; the service layer decides how to store and resume work.
 */
export interface ExecutionRepository extends ExecutionStore {
  findByTenant(tenantId: string): Promise<Array<{ executionId: string; status: string }>>;
  markCancelled(executionId: string): Promise<void>;
}

export class PostgresExecutionRepository implements ExecutionRepository {
  private readonly rows = new Map<string, { executionId: string; tenantId: string; checkpoint?: RunCheckpoint; events: StepLifecycleEvent[]; result?: ExecutionResult; status: string }>();

  constructor(private readonly tenantId: string) {}

  async saveStepEvent(event: StepLifecycleEvent): Promise<void> {
    const row = this.rows.get(event.executionId) ?? {
      executionId: event.executionId,
      tenantId: this.tenantId,
      events: [],
      status: 'running',
    };

    row.events.push(event);
    row.status = 'running';
    this.rows.set(event.executionId, row);
  }

  async saveCheckpoint(checkpoint: RunCheckpoint): Promise<void> {
    const row = this.rows.get(checkpoint.executionId) ?? {
      executionId: checkpoint.executionId,
      tenantId: this.tenantId,
      events: [],
      status: checkpoint.status,
    };

    row.checkpoint = checkpoint;
    row.status = checkpoint.status;
    this.rows.set(checkpoint.executionId, row);
  }

  async saveRunResult(result: ExecutionResult): Promise<void> {
    const row = this.rows.get(result.executionId) ?? {
      executionId: result.executionId,
      tenantId: this.tenantId,
      events: [],
      status: result.status,
    };

    row.result = result;
    row.checkpoint = result.checkpoint;
    row.status = result.status;
    this.rows.set(result.executionId, row);
  }

  async loadLatestCheckpoint(executionId: string): Promise<RunCheckpoint | undefined> {
    return this.rows.get(executionId)?.checkpoint;
  }

  async loadExecution(executionId: string): Promise<{ executionId: string; agentId: string; status: 'running' | 'succeeded' | 'failed' | 'cancelled'; runInput?: Record<string, unknown>; latestCheckpoint?: RunCheckpoint; stepEvents: StepLifecycleEvent[]; result?: ExecutionResult; createdAt: Date; updatedAt: Date } | undefined> {
    const row = this.rows.get(executionId);
    if (!row) return undefined;

    return {
      executionId: row.executionId,
      agentId: row.checkpoint?.agentId ?? 'unknown-agent',
      status: row.status as 'running' | 'succeeded' | 'failed' | 'cancelled',
      latestCheckpoint: row.checkpoint,
      stepEvents: row.events,
      result: row.result,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async findByTenant(tenantId: string): Promise<Array<{ executionId: string; status: string }>> {
    return Array.from(this.rows.values())
      .filter((row) => row.tenantId === tenantId)
      .map((row) => ({ executionId: row.executionId, status: row.status }));
  }

  async markCancelled(executionId: string): Promise<void> {
    const row = this.rows.get(executionId);
    if (!row) return;
    row.status = 'cancelled';
    if (row.checkpoint) {
      row.checkpoint.status = 'cancelled';
    }
    this.rows.set(executionId, row);
  }
}

export async function runJobWithRepository(
  runtime: AgentRuntime,
  repository: ExecutionRepository,
  definition: AgentDefinition,
  options: { executionId?: string; runInput?: Record<string, unknown> } = {},
): Promise<ExecutionResult> {
  const executionId = options.executionId ?? `run-${Date.now()}`;
  const checkpoint = await repository.loadLatestCheckpoint(executionId);

  const result = await runtime.run(definition, {
    executionId,
    runInput: options.runInput ?? {},
    resumeFromCheckpoint: checkpoint,
    callbacks: {
      onStepStart: (event) => repository.saveStepEvent(event),
      onStepResult: (event) => repository.saveStepEvent(event),
      onCheckpoint: (nextCheckpoint) => repository.saveCheckpoint(nextCheckpoint),
      onRunEnd: (finalResult) => repository.saveRunResult(finalResult),
    },
  });

  return result;
}
