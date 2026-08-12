/**
 * Public API surface for the lead-generation-runtime-typescript package.
 *
 * Import from this barrel instead of from deep paths to stay insulated
 * from internal refactors.
 */

// Types
export type {
  AgentDefinition,
  AgentDefinitionVersion,
  StepDefinition,
  RetryPolicy,
  ToolInput,
  ToolResult,
  LLMMessage,
  LLMRequest,
  LLMResponse,
  StepStatus,
  StepResult,
  ExecutionStatus,
  ExecutionResult,
  RuntimeEventType,
  RuntimeEvent,
} from './types';

// Loader
export { AgentDefinitionLoader, AgentDefinitionValidationError } from './loader';

// Context
export { ExecutionContext } from './context';

// MCP
export { ToolRegistry, ToolInvoker, ToolNotFoundError } from './mcp';
export type { ToolHandler, ToolInvokerOptions } from './mcp';

// LLM adapters
export {
  LLMAdapterRegistry,
  LLMProviderNotFoundError,
  StubClaudeAdapter,
  StubOpenAIAdapter,
} from './llm';
export type { LLMProviderAdapter } from './llm';

// Resolver
export { StepResolver } from './resolver';
export type { ResolvedStep } from './resolver';

// Observability
export { ObservabilityEmitter } from './observability';
export type { EventObserver } from './observability';

// Runtime (main entry-points)
export { AgentRuntime, Orchestrator, OrchestratorError } from './runtime';
export type { AgentRuntimeOptions, OrchestratorOptions } from './runtime';
