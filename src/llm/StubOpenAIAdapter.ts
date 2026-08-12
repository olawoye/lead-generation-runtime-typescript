import { LLMRequest, LLMResponse } from '../types';
import { LLMProviderAdapter } from './LLMProviderAdapter';

/**
 * StubOpenAIAdapter is a no-network, deterministic stand-in for the
 * OpenAI / Codex API.  Replace with a real implementation backed by the
 * openai SDK when connecting to the live API.
 */
export class StubOpenAIAdapter implements LLMProviderAdapter {
  readonly id = 'openai';
  readonly displayName = 'OpenAI / Codex (stub)';

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const lastUserMessage = [...request.messages]
      .reverse()
      .find((m) => m.role === 'user');

    const content = lastUserMessage
      ? `[OpenAI stub] You said: "${lastUserMessage.content}"`
      : '[OpenAI stub] No user message provided.';

    return {
      content,
      model: request.model ?? 'gpt-4o',
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      },
    };
  }
}
