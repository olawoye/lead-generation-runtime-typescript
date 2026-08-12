import { LLMRequest, LLMResponse } from '../types';

/**
 * LLMProviderAdapter is the interface every LLM adapter must implement.
 *
 * The runtime orchestration engine (Orchestrator) depends only on this
 * interface – it never imports Claude, OpenAI, or any other concrete adapter.
 * Swapping providers therefore requires zero changes to the core engine.
 */
export interface LLMProviderAdapter {
  /** Unique identifier used in AgentDefinition step.provider fields. */
  readonly id: string;

  /** Human-readable display name. */
  readonly displayName: string;

  /**
   * Send a request to the LLM and return its response.
   * Implementations should NOT swallow errors – let them propagate so the
   * Orchestrator can apply retry / timeout logic.
   */
  complete(request: LLMRequest): Promise<LLMResponse>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class LLMProviderNotFoundError extends Error {
  constructor(providerId: string) {
    super(`LLM provider "${providerId}" is not registered`);
    this.name = 'LLMProviderNotFoundError';
  }
}

/**
 * LLMAdapterRegistry holds all registered LLM provider adapters.
 *
 * Adapters are keyed by their `id` field and looked up by the Orchestrator
 * when a step of type "llm" is executed.
 */
export class LLMAdapterRegistry {
  private readonly adapters = new Map<string, LLMProviderAdapter>();

  /** Register (or replace) an adapter. */
  register(adapter: LLMProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  /** Retrieve an adapter by its provider id. */
  get(providerId: string): LLMProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }

  /** Returns true if the provider is registered. */
  has(providerId: string): boolean {
    return this.adapters.has(providerId);
  }

  /** All registered provider ids. */
  listProviders(): string[] {
    return Array.from(this.adapters.keys());
  }
}
