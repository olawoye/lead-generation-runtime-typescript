import { AgentDefinition, ExecutionResult } from '../types';
import { AgentDefinitionLoader } from '../loader/AgentDefinitionLoader';
import { ToolCatalogEntry, ToolRegistry, ToolSelection, ToolHandler, loadToolkitCatalogFromFile } from '../mcp/ToolRegistry';
import { ToolInvoker, ToolInvokerOptions } from '../mcp/ToolInvoker';
import { LLMAdapterRegistry } from '../llm/LLMProviderAdapter';
import { LLMProviderAdapter } from '../llm/LLMProviderAdapter';
import { ObservabilityEmitter, EventObserver } from '../observability/ObservabilityEmitter';
import { Orchestrator, OrchestratorOptions } from './Orchestrator';

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

  /**
   * Determine which tool IDs are required by the definition.
   * Supports both the legacy runtime step shape and the newer declarative shape.
   */
  resolveRequiredToolNames(definition: AgentDefinition): string[] {
    const names = new Set<string>();

    for (const step of definition.steps) {
      const legacyTool = 'tool' in step && typeof step.tool === 'string' ? step.tool : undefined;
      if (legacyTool) names.add(legacyTool);

      const declarativeTools = 'tools' in step && Array.isArray(step.tools) ? step.tools : [];
      for (const toolName of declarativeTools) {
        if (typeof toolName === 'string') names.add(toolName);
      }
    }

    return Array.from(names);
  }

  /** Select the server/tool subset needed for a given definition from a tool catalog. */
  resolveToolPlan(
    definition: AgentDefinition,
    catalog: readonly ToolCatalogEntry[],
  ): ToolSelection {
    return this.toolRegistry.selectByCatalog(catalog as ToolCatalogEntry[], this.resolveRequiredToolNames(definition));
  }

  /** Resolve the tool plan directly from a toolkit manifest file on disk. */
  resolveToolPlanFromManifest(
    definition: AgentDefinition,
    manifestPath: string,
  ): ToolSelection {
    const catalog = loadToolkitCatalogFromFile(manifestPath);
    return this.resolveToolPlan(definition, catalog);
  }

  /**
   * Register only the handlers needed for this definition using a catalog-driven lookup.
   * Any tool the catalog contains but which is not required is left unloaded.
   */
  registerToolPlan(
    definition: AgentDefinition,
    catalog: readonly ToolCatalogEntry[],
    lookup: (toolName: string, tool: ToolCatalogEntry) => ToolHandler | undefined,
  ): ToolSelection {
    const plan = this.resolveToolPlan(definition, catalog);

    for (const tool of plan.tools) {
      const handler = lookup(tool.name, tool);
      if (handler) {
        this.registerTool(tool.name, handler);
      }
    }

    return plan;
  }

  /** Register only the handlers needed for this definition from a toolkit manifest file on disk. */
  registerToolPlanFromManifest(
    definition: AgentDefinition,
    manifestPath: string,
    lookup: (toolName: string, tool: ToolCatalogEntry) => ToolHandler | undefined,
  ): ToolSelection {
    const catalog = loadToolkitCatalogFromFile(manifestPath);
    return this.registerToolPlan(definition, catalog, lookup);
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
