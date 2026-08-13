import { ExecutionResult, RunCheckpoint, StepLifecycleEvent } from '../types';
import { ExecutionStore, ExecutionRecord } from './ExecutionStore';

export interface ExecutionRepository extends ExecutionStore {
  findByTenant(tenantId: string): Promise<Array<{ executionId: string; status: string }>>;
  markCancelled(executionId: string): Promise<void>;
}

export class InMemoryExecutionRepository implements ExecutionRepository {
  private readonly rows = new Map<string, ExecutionRecord & { tenantId: string }>();

  constructor(private readonly tenantId: string) {}

  async saveStepEvent(event: StepLifecycleEvent): Promise<void> {
    const row = this.rows.get(event.executionId) ?? {
      executionId: event.executionId,
      agentId: event.agentId,
      status: 'running',
      stepEvents: [],
      tenantId: this.tenantId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    row.agentId = event.agentId;
    row.status = 'running';
    row.stepEvents.push(event);
    row.updatedAt = new Date();
    this.rows.set(event.executionId, row);
  }

  async saveCheckpoint(checkpoint: RunCheckpoint): Promise<void> {
    const row = this.rows.get(checkpoint.executionId) ?? {
      executionId: checkpoint.executionId,
      agentId: checkpoint.agentId,
      status: checkpoint.status,
      stepEvents: [],
      tenantId: this.tenantId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    row.agentId = checkpoint.agentId;
    row.status = checkpoint.status;
    row.latestCheckpoint = checkpoint;
    row.updatedAt = new Date();
    this.rows.set(checkpoint.executionId, row);
  }

  async saveRunResult(result: ExecutionResult): Promise<void> {
    const row = this.rows.get(result.executionId) ?? {
      executionId: result.executionId,
      agentId: result.agentId,
      status: result.status,
      stepEvents: [],
      tenantId: this.tenantId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    row.agentId = result.agentId;
    row.status = result.status;
    row.latestCheckpoint = result.checkpoint;
    row.result = result;
    row.updatedAt = new Date();
    this.rows.set(result.executionId, row);
  }

  async loadLatestCheckpoint(executionId: string): Promise<RunCheckpoint | undefined> {
    return this.rows.get(executionId)?.latestCheckpoint;
  }

  async loadExecution(executionId: string): Promise<ExecutionRecord | undefined> {
    const row = this.rows.get(executionId);
    if (!row) return undefined;

    return {
      executionId: row.executionId,
      agentId: row.agentId,
      status: row.status,
      latestCheckpoint: row.latestCheckpoint,
      stepEvents: row.stepEvents,
      result: row.result,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
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
    if (row.latestCheckpoint) {
      row.latestCheckpoint.status = 'cancelled';
    }
    this.rows.set(executionId, row);
  }
}
