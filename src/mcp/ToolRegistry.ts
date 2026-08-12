import { readFileSync } from 'node:fs';
import { ToolInput, ToolResult } from '../types';

// ---------------------------------------------------------------------------
// Tool handler contract
// ---------------------------------------------------------------------------

/**
 * A ToolHandler is any callable that accepts a ToolInput and returns
 * a Promise<ToolResult>.  Implementations live in the MCP adapter layer
 * and are registered with the ToolRegistry.
 */
export type ToolHandler = (input: ToolInput) => Promise<ToolResult>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ToolNotFoundError extends Error {
  constructor(toolName: string) {
    super(`MCP tool "${toolName}" is not registered`);
    this.name = 'ToolNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * ToolRegistry is the single in-process catalogue of available MCP tools.
 *
 * Tools are registered by name and invoked through ToolInvoker, which adds
 * timeout, error-handling, and observability concerns on top of this registry.
 */
export interface ToolCatalogEntry {
  name: string;
  server: string;
  capabilities?: string[];
  description?: string;
  category?: string;
  status?: string;
}

export interface ToolSelection {
  tools: ToolCatalogEntry[];
  servers: string[];
}

export function loadToolkitCatalogFromFile(filePath: string): ToolCatalogEntry[] {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as { tools?: ToolCatalogEntry[] };
  return Array.isArray(parsed.tools) ? parsed.tools : [];
}

export class ToolRegistry {
  private readonly handlers = new Map<string, ToolHandler>();

  /** Register (or replace) a tool handler. */
  register(name: string, handler: ToolHandler): void {
    this.handlers.set(name, handler);
  }

  /** Retrieve a handler by name. */
  get(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }

  /** Returns all registered tool names. */
  listTools(): string[] {
    return Array.from(this.handlers.keys());
  }

  /** Returns true if the named tool is registered. */
  has(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Select tools from a toolkit catalog using the runtime’s required tool IDs.
   * This allows a runtime to load only the required server(s) and not a monolithic
   * tool bundle for every capability.
   */
  selectByCatalog(
    catalog: ToolCatalogEntry[],
    requiredToolNames: string[],
  ): ToolSelection {
    const required = new Set(requiredToolNames);
    const selectedTools = catalog.filter((tool) => required.has(tool.name));
    const servers = Array.from(new Set(selectedTools.map((tool) => tool.server))).sort();

    return {
      tools: selectedTools,
      servers,
    };
  }
}
