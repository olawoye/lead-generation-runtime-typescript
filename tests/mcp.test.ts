import { ToolRegistry, ToolInvoker, ToolNotFoundError } from '../src/mcp';
import { ToolResult } from '../src/types';

describe('ToolRegistry', () => {
  it('registers and retrieves a handler', () => {
    const registry = new ToolRegistry();
    const handler = jest.fn().mockResolvedValue({ success: true, data: 42 });
    registry.register('my_tool', handler);
    expect(registry.has('my_tool')).toBe(true);
    expect(registry.get('my_tool')).toBe(handler);
  });

  it('lists all registered tool names', () => {
    const registry = new ToolRegistry();
    registry.register('tool_a', jest.fn());
    registry.register('tool_b', jest.fn());
    expect(registry.listTools().sort()).toEqual(['tool_a', 'tool_b']);
  });

  it('returns undefined for unknown tools', () => {
    const registry = new ToolRegistry();
    expect(registry.get('unknown')).toBeUndefined();
  });
});

describe('ToolInvoker', () => {
  it('invokes a registered tool and returns its result', async () => {
    const registry = new ToolRegistry();
    registry.register('search_web', async () => ({
      success: true,
      data: ['lead1'],
    }));
    const invoker = new ToolInvoker(registry);
    const result = await invoker.invoke({ name: 'search_web', params: { q: 'foo' } });
    expect(result.success).toBe(true);
    expect(result.data).toEqual(['lead1']);
  });

  it('returns failure result for unknown tool', async () => {
    const registry = new ToolRegistry();
    const invoker = new ToolInvoker(registry);
    const result = await invoker.invoke({ name: 'no_tool', params: {} });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not registered/);
  });

  it('returns failure result when tool throws', async () => {
    const registry = new ToolRegistry();
    registry.register('bad_tool', async () => {
      throw new Error('network error');
    });
    const invoker = new ToolInvoker(registry);
    const result = await invoker.invoke({ name: 'bad_tool', params: {} });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/network error/);
  });

  it('times out when tool exceeds the timeout', async () => {
    const registry = new ToolRegistry();
    registry.register('slow_tool', () => new Promise<ToolResult>(() => { /* never resolves */ }));
    const invoker = new ToolInvoker(registry, { defaultTimeoutMs: 50 });
    const result = await invoker.invoke({ name: 'slow_tool', params: {} });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out/);
  });
});

describe('ToolNotFoundError', () => {
  it('has the correct message and name', () => {
    const err = new ToolNotFoundError('my_tool');
    expect(err.name).toBe('ToolNotFoundError');
    expect(err.message).toMatch(/my_tool/);
  });
});

describe('Capability-based tool planning', () => {
  it('selects only the required servers and tools for a run', () => {
    const manifest = {
      version: '0.1.0',
      tools: [
        { name: 'web_search', server: 'web-search', capabilities: ['web-search'] },
        { name: 'web_news_search', server: 'web-search', capabilities: ['news-search'] },
        { name: 'maps_search_places', server: 'maps', capabilities: ['maps-search'] },
        { name: 'detect_technologies', server: 'technology-detection', capabilities: ['technology-detection'] },
      ],
    };

    const registry = new ToolRegistry();
    registry.register('web_search', jest.fn());
    registry.register('maps_search_places', jest.fn());

    const selected = registry.selectByCatalog(manifest.tools, ['web_search', 'maps_search_places']);

    expect(selected.tools.map((tool) => tool.name).sort()).toEqual(['maps_search_places', 'web_search']);
    expect(selected.servers.sort()).toEqual(['maps', 'web-search']);
  });
});
