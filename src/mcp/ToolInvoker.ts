import { ToolInput, ToolResult } from '../types';
import { ToolRegistry, ToolNotFoundError } from './ToolRegistry';

/** Configuration for ToolInvoker. */
export interface ToolInvokerOptions {
  /** Default timeout (ms) for every tool call. Default: 10 000. */
  defaultTimeoutMs?: number;
}

/**
 * ToolInvoker wraps ToolRegistry with timeout enforcement and structured
 * error handling.  It is the only component allowed to call MCP tools –
 * the Orchestrator goes through ToolInvoker, never directly to the registry.
 */
export class ToolInvoker {
  private readonly defaultTimeoutMs: number;

  constructor(
    private readonly registry: ToolRegistry,
    options: ToolInvokerOptions = {},
  ) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 10_000;
  }

  /**
   * Invoke a registered MCP tool.
   *
   * @param input     - Tool name and params.
   * @param timeoutMs - Per-call timeout override.
   * @returns Resolved ToolResult (never throws – errors are encapsulated).
   */
  async invoke(input: ToolInput, timeoutMs?: number): Promise<ToolResult> {
    const handler = this.registry.get(input.name);
    if (!handler) {
      return {
        success: false,
        error: new ToolNotFoundError(input.name).message,
      };
    }

    const limit = timeoutMs ?? this.defaultTimeoutMs;

    try {
      const result = await Promise.race([
        handler(input),
        this.timeoutPromise(limit, input.name),
      ]);
      return result;
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private timeoutPromise(ms: number, toolName: string): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve) => {
      const timer = setTimeout(() => {
        resolve({
          success: false,
          error: `Tool "${toolName}" timed out after ${ms}ms`,
        });
      }, ms);
      timer.unref();
    });
  }
}
