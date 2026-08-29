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
export interface ExtractionContract {
  target?: 'company' | 'person' | 'lead' | 'event' | 'signal';
  fields?: string[];
  mode?: 'llm' | 'schema' | 'regex' | 'hybrid';
  requiredFields?: string[];
  outputKey?: string;
}

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
  /** Optional hint list for narrowing the inputs passed to this step. */
  inputHints?: string[];
  /** Optional hint list for what shape of outputs this step is expected to emit. */
  outputHints?: string[];
  /** Optional guidance for generating a query tailored to this step." */
  queryStrategy?: string;
  /** Optional extraction prompt used by a website/file extraction tool to tell the LLM what to pull from the target page. */
  extractionQuery?: string;
  /** Optional query templates the runtime can use to rewrite the source brief for this step. */
  queryTemplates?: string[];
  /** Optional exclusions / low-signal terms to block from a step query. */
  negativeTerms?: string[];
  /** Preferred target entity type for this step, e.g. company, person, lead, event. */
  entityFocus?: 'company' | 'person' | 'lead' | 'event' | 'signal';
  /** Optional extraction contract describing the canonical shape for downstream lead normalization. */
  extractionContract?: ExtractionContract;
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

/** Runtime-native agent definition shape used by orchestration code. */
export interface RuntimeAgentDefinition {
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

/** Declarative agent.definition/v1 metadata block. */
export interface AgentDefinitionMetadata {
  name: string;
  displayName?: string;
  description?: string;
  version?: string;
}

/** Declarative step definition used in the agent.definition/v1 YAML/JSON schema. */
export interface DeclarativeStepDefinition {
  id: string;
  name?: string;
  type?: 'tool' | 'llm' | 'noop';
  objective?: unknown;
  tools?: string[];
  inputs?: unknown;
  outputs?: unknown;
  inputHints?: string[];
  outputHints?: string[];
  queryStrategy?: string;
  extractionQuery?: string;
  queryTemplates?: string[];
  negativeTerms?: string[];
  entityFocus?: 'company' | 'person' | 'lead' | 'event' | 'signal';
  extractionContract?: ExtractionContract;
  dependsOn?: string[];
  configuration?: Record<string, unknown>;
  policy?: Record<string, unknown>;
  retry_policy?: Record<string, unknown>;
  next_steps?: string[];
  quality_rules?: unknown;
  enabled?: boolean;
}

/** Declarative agent.definition/v1 document shape used by the definition package. */
export interface AgentDefinitionV1 {
  apiVersion: 'agent.definition/v1';
  kind: 'AgentDefinition';
  metadata: AgentDefinitionMetadata;
  spec: {
    objective?: unknown;
    orar?: unknown;
    state?: unknown;
    options?: Record<string, unknown>;
    policies?: Record<string, unknown>;
    tools?: string[];
    steps?: DeclarativeStepDefinition[];
  };
}

/** Root Agent Definition document.
 *
 * This is intentionally compatible with both the runtime-native shape and the
 * declarative agent.definition/v1 shape used by the definition repo.
 */
export interface AgentDefinition extends RuntimeAgentDefinition {
  /** Declarative agent.definition/v1 metadata when present. */
  apiVersion?: 'agent.definition/v1';
  /** Declarative agent kind marker when present. */
  kind?: 'AgentDefinition';
  /** Declarative metadata block when present. */
  metadata?: AgentDefinitionMetadata;
  /** Declarative spec block when present. */
  spec?: AgentDefinitionV1['spec'];
}

/** Runtime input provided by the SaaS host for a single run. */
export type RunInput = Record<string, unknown>;

/** Normalized, deterministic step lifecycle event produced by the runtime. */
export interface StepLifecycleEvent {
  executionId: string;
  agentId: string;
  stepId: string;
  stepName: string;
  status: StepStatus | 'cancelled';
  attempt?: number;
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
  output?: unknown;
  error?: string;
  inputs?: Record<string, unknown>;
}

/** Durable checkpoint payload generated by the runtime for SaaS-side persistence. */
export interface RunCheckpoint {
  executionId: string;
  agentId: string;
  status: ExecutionStatus;
  createdAt: Date;
  updatedAt: Date;
  runInput: RunInput;
  completedStepIds: string[];
  currentStepId?: string;
  stepResults: StepResult[];
  finalOutput?: unknown;
  error?: string;
}

/** App-facing lifecycle payload emitted when a run begins. */
export interface RunStartedEvent {
  executionId: string;
  agentId: string;
  runInput: RunInput;
  startedAt: Date;
}

/** App-facing lifecycle payload emitted when a run fails or is cancelled. */
export interface RunErrorEvent {
  executionId: string;
  agentId: string;
  status: ExecutionStatus;
  error: string;
  checkpoint?: RunCheckpoint;
}

/** Callback hooks invoked by a stateless runtime so the SaaS app can persist state. */
export interface RuntimeCallbacks {
  onRunStart?: (event: RunStartedEvent) => void;
  onStepStart?: (event: StepLifecycleEvent) => void;
  onStepResult?: (event: StepLifecycleEvent) => void;
  onCheckpoint?: (checkpoint: RunCheckpoint) => void;
  onRunError?: (event: RunErrorEvent) => void;
  onRunEnd?: (result: ExecutionResult) => void;
  onCandidateSurface?: (event: {
    executionId: string;
    stepId: string;
    stepName: string;
    candidateSurface: {
      id?: string;
      title?: string | null;
      url?: string | null;
      classification?: CandidateSurfaceClassification;
    };
  }) => void;
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
export interface CandidateSurfaceClassification {
  kind: 'direct-lead' | 'needs-extraction' | 'skip';
  reason?: string;
  targetTool?: string;
  targetField?: string;
  instruction?: string;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  candidateSurfaces?: Array<{
    id?: string;
    title?: string | null;
    url?: string | null;
    classification?: CandidateSurfaceClassification;
  }>;
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
  finalOutput?: unknown;
  checkpoint?: RunCheckpoint;
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
