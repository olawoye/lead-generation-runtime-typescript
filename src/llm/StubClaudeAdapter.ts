import { LLMRequest, LLMResponse } from '../types';
import { LLMProviderAdapter } from './LLMProviderAdapter';

/**
 * StubClaudeAdapter is a no-network, deterministic stand-in for the
 * Anthropic Claude API.  It is intended for tests and local development.
 *
 * Replace with a real implementation that calls the Anthropic SDK when
 * you are ready to connect to the live API.
 */
export class StubClaudeAdapter implements LLMProviderAdapter {
  readonly id = 'claude';
  readonly displayName = 'Anthropic Claude (stub)';

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const lastUserMessage = [...request.messages]
      .reverse()
      .find((m) => m.role === 'user');

    const content = lastUserMessage
      ? `[Claude stub] You said: "${lastUserMessage.content}"`
      : '[Claude stub] No user message provided.';

    return {
      content,
      model: request.model ?? 'claude-3-opus-20240229',
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      },
    };
  }
}
