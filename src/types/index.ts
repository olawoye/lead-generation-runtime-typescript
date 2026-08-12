/**
 * Core type definitions for the Agent Runtime.
 *
 * AgentDefinition is the source-of-truth contract: it describes what to
 * execute. The runtime owns *how* execution is orchestrated.
 */

// ---------------------------------------------------------------------------
// Agent Definition
// ---------------------------------------------------------------------------

/** Supported definition schema versions. */
export type AgentDefinitionVersion = '1.0';

/** A single declarative step inside an Agent Definition. */
export interface StepDefinition {
  /** Unique identifier for the step within this definition. */
  id: string;
  /** Human-readable label for observability / logging. */
  name: string;
  /**
   * Type of step:
   *  - "tool"  – invoke an MCP tool
   *  - "llm"   – call an LLM provider
   *  - "noop"  – pass-through (useful for branching / testing)
   */
  type?: 'tool' | 'llm' | 'noop';
  /** MCP tool name to invoke when type === "tool". */
  tool?: string;
  /** LLM provider identifier to use when type === "llm". */
  provider?: string;
  /** Static parameters merged with runtime context inputs. */
  params?: Record<string, unknown>;
  /** IDs of steps that must complete before this step runs. */
  dependsOn?: string[];
  /** Declarative tool IDs required by the step. */
  tools?: string[];
  /** Declarative step input names. */
  inputs?: string[] | Record<string, unknown>;
  /** Declarative step output names. */
  outputs?: string[] | Record<string, unknown>;
  /** Whether the step is currently enabled. */
  enabled?: boolean;
  /** Additional step-level configuration values. */
  configuration?: Record<string, unknown>;
  /** Explicit next-step routing instructions. */
  next_steps?: string[];
  /** Retry policy for this step. */
  retry?: RetryPolicy;
  /** Override the global timeout (ms) for this step. */
  timeoutMs?: number;
  /** Declarative description of what the step does. */
  description?: string;
}

/** Retry policy attached to a step or the whole definition. */
export interface RetryPolicy {
  /** Maximum number of attempts (including the initial attempt). */
  maxAttempts: number;
  /** Base delay between attempts in milliseconds. */
  backoffMs: number;
  /** Multiply backoff by this factor on each retry. */
  backoffMultiplier?: number;
}

/** Root Agent Definition document. */
export interface AgentDefinition {
  /** Schema version – enables forward-compat validation. */
  version: AgentDefinitionVersion;
  /** Machine-readable identifier for this agent. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Optional description. */
  description?: string;
  /** Ordered list of steps to execute. */
  steps: StepDefinition[];
  /** Default retry policy applied to all steps (can be overridden per-step). */
  defaultRetry?: RetryPolicy;
  /** Global step timeout in milliseconds (default: 30 000). */
  defaultTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// MCP Tool layer
// ---------------------------------------------------------------------------

/** Payload sent to an MCP tool. */
export interface ToolInput {
  name: string;
  params: Record<string, unknown>;
}

/** Response returned from an MCP tool. */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// LLM provider adapter
// ---------------------------------------------------------------------------

/** A single message in an LLM conversation. */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Request payload for an LLM provider. */
export interface LLMRequest {
  messages: LLMMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  params?: Record<string, unknown>;
}

/** Response from an LLM provider. */
export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ---------------------------------------------------------------------------
// Execution layer
// ---------------------------------------------------------------------------

/** Status of a single step execution. */
export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'timed_out';

/** Execution result for one step. */
export interface StepResult {
  stepId: string;
  stepName: string;
  status: StepStatus;
  output?: unknown;
  error?: string;
  attempts: number;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
}

/** Overall execution status. */
export type ExecutionStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

/** Final execution result for a complete agent run. */
export interface ExecutionResult {
  executionId: string;
  agentId: string;
  status: ExecutionStatus;
  stepResults: StepResult[];
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

/** Typed events emitted by the runtime. */
export type RuntimeEventType =
  | 'execution.started'
  | 'execution.succeeded'
  | 'execution.failed'
  | 'step.started'
  | 'step.succeeded'
  | 'step.failed'
  | 'step.retry'
  | 'step.timed_out'
  | 'tool.invoked'
  | 'tool.result'
  | 'llm.request'
  | 'llm.response';

export interface RuntimeEvent {
  type: RuntimeEventType;
  executionId: string;
  timestamp: Date;
  payload?: unknown;
}
