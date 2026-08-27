import { StepResult } from '../types';

/**
 * ExecutionContext holds mutable state for a single agent run.
 *
 * It is the single source of truth for:
 *   - the outputs produced by each step
 *   - the list of completed/failed step results
 *
 * Step outputs are stored keyed by stepId so downstream steps can reference
 * them via context.getOutput(stepId).
 */
export class ExecutionContext {
  private readonly outputs = new Map<string, unknown>();
  private readonly results: StepResult[] = [];
  private readonly artifacts: Record<string, unknown> = {};

  constructor(
    public readonly executionId: string,
    public readonly agentId: string,
    /** Initial inputs provided by the caller (injected into the first step). */
    public readonly initialInputs: Record<string, unknown> = {},
  ) {}

  /**
   * Store the output produced by a step.
   */
  setOutput(stepId: string, output: unknown): void {
    this.outputs.set(stepId, output);
  }

  /**
   * Retrieve the output of a completed step, or undefined if not yet set.
   */
  getOutput(stepId: string): unknown {
    return this.outputs.get(stepId);
  }

  /**
   * Build the merged input for the next step:
   *   - static params from the step definition
   *   - outputs of declared dependency steps
   *   - initial inputs (lowest priority)
   */
  buildStepInputs(
    staticParams: Record<string, unknown> = {},
    dependsOn: string[] = [],
    stepInputMapper?: (baseInputs: Record<string, unknown>) => Record<string, unknown>,
  ): Record<string, unknown> {
    const depOutputs: Record<string, unknown> = {};
    for (const depId of dependsOn) {
      depOutputs[depId] = this.getOutput(depId);
    }

    const baseInputs = {
      ...this.initialInputs,
      ...depOutputs,
      ...staticParams,
    };

    if (typeof stepInputMapper === 'function') {
      return stepInputMapper(baseInputs);
    }

    return baseInputs;
  }

  addArtifact(key: string, value: unknown): void {
    this.artifacts[key] = value;
  }

  getArtifacts(): Record<string, unknown> {
    return { ...this.artifacts };
  }

  /** Record the result of a completed step. */
  recordResult(result: StepResult): void {
    this.results.push(result);
  }

  /** Return a read-only snapshot of all step results so far. */
  getResults(): readonly StepResult[] {
    return this.results;
  }

  /** Check whether all listed step IDs have succeeded. */
  allSucceeded(stepIds: string[]): boolean {
    const succeeded = new Set(
      this.results.filter((r) => r.status === 'succeeded').map((r) => r.stepId),
    );
    return stepIds.every((id) => succeeded.has(id));
  }
}
