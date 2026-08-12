import { AgentDefinition, ExecutionResult } from '../types';
import { AgentDefinitionLoader } from '../loader/AgentDefinitionLoader';
import { ToolRegistry } from '../mcp/ToolRegistry';
import { ToolInvoker, ToolInvokerOptions } from '../mcp/ToolInvoker';
import { LLMAdapterRegistry } from '../llm/LLMProviderAdapter';
import { LLMProviderAdapter } from '../llm/LLMProviderAdapter';
import { ObservabilityEmitter, EventObserver } from '../observability/ObservabilityEmitter';
import { Orchestrator, OrchestratorOptions } from './Orchestrator';
import { ToolHandler } from '../mcp/ToolRegistry';

// ---------------------------------------------------------------------------
// AgentRuntime – the public entry-point for embedders / service consumers
// ---------------------------------------------------------------------------

export interface AgentRuntimeOptions {
  toolInvokerOptions?: ToolInvokerOptions;
  orchestratorOptions?: OrchestratorOptions;
}

/**
 * AgentRuntime is the single public facade for embedding or running the
 * agent execution engine.
 *
 * Usage:
 * ```typescript
 * const runtime = new AgentRuntime();
 * runtime.registerTool('search_web', mySearchHandler);
 * runtime.registerLLMAdapter(new StubClaudeAdapter());
 * runtime.subscribe(event => console.log(event));
 *
 * const result = await runtime.run(myAgentDefinition, { inputs: { query: 'SaaS leads' } });
 * ```
 *
 * The runtime can be:
 *  - Embedded in a monorepo app (import and call directly)
 *  - Used as a standalone service (wrap in an HTTP/worker entrypoint)
 *  - Used as a library (publish and require as a dependency)
 */
export class AgentRuntime {
  private readonly loader: AgentDefinitionLoader;
  readonly toolRegistry: ToolRegistry;
  readonly llmRegistry: LLMAdapterRegistry;
  readonly emitter: ObservabilityEmitter;
  private readonly toolInvoker: ToolInvoker;
  private readonly orchestrator: Orchestrator;

  constructor(options: AgentRuntimeOptions = {}) {
    this.loader = new AgentDefinitionLoader();
    this.toolRegistry = new ToolRegistry();
    this.llmRegistry = new LLMAdapterRegistry();
    this.emitter = new ObservabilityEmitter();
    this.toolInvoker = new ToolInvoker(this.toolRegistry, options.toolInvokerOptions);
    this.orchestrator = new Orchestrator(this.toolInvoker, this.llmRegistry, this.emitter);
  }

  // ---------------------------------------------------------------------------
  // Registration helpers
  // ---------------------------------------------------------------------------

  /** Register an MCP tool handler. */
  registerTool(name: string, handler: ToolHandler): this {
    this.toolRegistry.register(name, handler);
    return this;
  }

  /** Register an LLM provider adapter. */
  registerLLMAdapter(adapter: LLMProviderAdapter): this {
    this.llmRegistry.register(adapter);
    return this;
  }

  /** Subscribe to runtime observability events. */
  subscribe(observer: EventObserver): this {
    this.emitter.subscribe(observer);
    return this;
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  /**
   * Execute a raw (unvalidated) agent definition object.
   * Validates + loads the definition before execution.
   */
  async runRaw(
    raw: unknown,
    options: OrchestratorOptions = {},
  ): Promise<ExecutionResult> {
    const definition = this.loader.load(raw);
    return this.orchestrator.execute(definition, options);
  }

  /**
   * Execute a pre-validated AgentDefinition.
   * Use this when the caller already holds a typed definition.
   */
  async run(
    definition: AgentDefinition,
    options: OrchestratorOptions = {},
  ): Promise<ExecutionResult> {
    return this.orchestrator.execute(definition, options);
  }
}
