import { StepDefinition, RetryPolicy } from '../types';

// ---------------------------------------------------------------------------
// Resolved step
// ---------------------------------------------------------------------------

/**
 * A ResolvedStep is a StepDefinition enriched with its concrete retry policy
 * and timeout, calculated by merging step-level and definition-level defaults.
 */
export interface ResolvedStep {
  definition: StepDefinition;
  retry: RetryPolicy;
  timeoutMs: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_RETRY: Readonly<RetryPolicy> = {
  maxAttempts: 1,
  backoffMs: 0,
};

const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * StepResolver converts the raw declarative StepDefinitions from an
 * AgentDefinition into ResolvedSteps ready for the Orchestrator to execute.
 *
 * It handles:
 *   - merging definition-level defaults with step-level overrides
 *   - computing the effective retry policy and timeout per step
 */
export class StepResolver {
  /**
   * Resolve all steps from an agent definition.
   *
   * @param steps           - Raw step definitions from the AgentDefinition.
   * @param defaultRetry    - Definition-level default retry policy.
   * @param defaultTimeoutMs - Definition-level default timeout in ms.
   */
  resolve(
    steps: StepDefinition[],
    defaultRetry?: RetryPolicy,
    defaultTimeoutMs?: number,
  ): ResolvedStep[] {
    return steps.map((step) => this.resolveOne(step, defaultRetry, defaultTimeoutMs));
  }

  private resolveOne(
    step: StepDefinition,
    defaultRetry?: RetryPolicy,
    defaultTimeoutMs?: number,
  ): ResolvedStep {
    const retry: RetryPolicy = {
      ...DEFAULT_RETRY,
      ...defaultRetry,
      ...step.retry,
    };

    const timeoutMs = step.timeoutMs ?? defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

    return { definition: step, retry, timeoutMs };
  }
}
