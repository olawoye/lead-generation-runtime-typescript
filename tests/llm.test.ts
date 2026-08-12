import { StubClaudeAdapter, StubOpenAIAdapter, LLMAdapterRegistry, LLMProviderNotFoundError } from '../src/llm';

describe('StubClaudeAdapter', () => {
  const adapter = new StubClaudeAdapter();

  it('has id "claude"', () => {
    expect(adapter.id).toBe('claude');
  });

  it('returns a response mentioning the user message', async () => {
    const resp = await adapter.complete({
      messages: [{ role: 'user', content: 'Hello Claude' }],
    });
    expect(resp.content).toContain('Hello Claude');
    expect(resp.model).toBeTruthy();
    expect(resp.usage?.totalTokens).toBeGreaterThan(0);
  });

  it('returns a fallback response when no user message', async () => {
    const resp = await adapter.complete({ messages: [] });
    expect(resp.content).toContain('No user message');
  });
});

describe('StubOpenAIAdapter', () => {
  const adapter = new StubOpenAIAdapter();

  it('has id "openai"', () => {
    expect(adapter.id).toBe('openai');
  });

  it('returns a response mentioning the user message', async () => {
    const resp = await adapter.complete({
      messages: [{ role: 'user', content: 'Hello OpenAI' }],
    });
    expect(resp.content).toContain('Hello OpenAI');
  });
});

describe('LLMAdapterRegistry', () => {
  it('registers and retrieves an adapter', () => {
    const registry = new LLMAdapterRegistry();
    registry.register(new StubClaudeAdapter());
    expect(registry.has('claude')).toBe(true);
    expect(registry.get('claude')?.id).toBe('claude');
  });

  it('lists all registered providers', () => {
    const registry = new LLMAdapterRegistry();
    registry.register(new StubClaudeAdapter());
    registry.register(new StubOpenAIAdapter());
    expect(registry.listProviders().sort()).toEqual(['claude', 'openai']);
  });

  it('LLMProviderNotFoundError has correct message', () => {
    const err = new LLMProviderNotFoundError('gpt-5');
    expect(err.name).toBe('LLMProviderNotFoundError');
    expect(err.message).toMatch(/gpt-5/);
  });
});
