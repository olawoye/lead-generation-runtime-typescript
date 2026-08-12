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
}
