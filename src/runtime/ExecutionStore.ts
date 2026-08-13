import { ExecutionResult, RunCheckpoint, StepLifecycleEvent } from '../types';

export interface ExecutionRecord {
  executionId: string;
  agentId: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  runInput?: Record<string, unknown>;
  latestCheckpoint?: RunCheckpoint;
  stepEvents: StepLifecycleEvent[];
  result?: ExecutionResult;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExecutionStore {
  saveStepEvent(event: StepLifecycleEvent): Promise<void>;
  saveCheckpoint(checkpoint: RunCheckpoint): Promise<void>;
  saveRunResult(result: ExecutionResult): Promise<void>;
  loadLatestCheckpoint(executionId: string): Promise<RunCheckpoint | undefined>;
  loadExecution(executionId: string): Promise<ExecutionRecord | undefined>;
  createOrUpdateExecution?(execution: ExecutionRecord): Promise<void>;
}

export class InMemoryExecutionStore implements ExecutionStore {
  private readonly records = new Map<string, ExecutionRecord>();

  async saveStepEvent(event: StepLifecycleEvent): Promise<void> {
    const record = this.records.get(event.executionId) ?? {
      executionId: event.executionId,
      agentId: event.agentId,
      status: 'running',
      stepEvents: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    record.agentId = event.agentId;
    record.status = 'running';
    record.stepEvents.push(event);
    record.updatedAt = new Date();
    this.records.set(record.executionId, record);
  }

  async saveCheckpoint(checkpoint: RunCheckpoint): Promise<void> {
    const record = this.records.get(checkpoint.executionId) ?? {
      executionId: checkpoint.executionId,
      agentId: checkpoint.agentId,
      status: checkpoint.status,
      stepEvents: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    record.agentId = checkpoint.agentId;
    record.status = checkpoint.status;
    record.runInput = checkpoint.runInput;
    record.latestCheckpoint = checkpoint;
    record.updatedAt = new Date();
    this.records.set(record.executionId, record);
  }

  async saveRunResult(result: ExecutionResult): Promise<void> {
    const record = this.records.get(result.executionId) ?? {
      executionId: result.executionId,
      agentId: result.agentId,
      status: result.status,
      stepEvents: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    record.agentId = result.agentId;
    record.status = result.status;
    record.latestCheckpoint = result.checkpoint;
    record.result = result;
    record.updatedAt = new Date();
    this.records.set(record.executionId, record);
  }

  async loadLatestCheckpoint(executionId: string): Promise<RunCheckpoint | undefined> {
    return this.records.get(executionId)?.latestCheckpoint;
  }

  async loadExecution(executionId: string): Promise<ExecutionRecord | undefined> {
    return this.records.get(executionId);
  }
}
