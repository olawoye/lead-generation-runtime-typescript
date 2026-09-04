import { ContextBridge, StepResult } from '../types';

/**
 * ExecutionContext holds mutable state for a single agent run.
 *
 * It is the single source of truth for:
 *  - the outputs produced by each step
 *  - the parsed contextual values produced by contextBridge rules
 *  - the list of completed/failed step results
 *
 * Step outputs are stored keyed by stepId so downstream steps can reference
 * them via context.getOutput(stepId).
 */
export class ExecutionContext {
  private readonly outputs = new Map<string, unknown>();
  private readonly results: StepResult[] = [];
  private readonly artifacts: Record<string, unknown> = {};
  private readonly context: Record<string, unknown> = {};

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
      ...this.context,
      ...staticParams,
    };

    if (typeof stepInputMapper === 'function') {
      return stepInputMapper(baseInputs);
    }

    return baseInputs;
  }

  setContextValue(key: string, value: unknown): void {
    this.context[key] = value;
  }

  getContext(): Record<string, unknown> {
    return { ...this.context };
  }

  applyContextBridge(output: unknown, bridge?: ContextBridge): Record<string, unknown> {
    if (!bridge) {
      return {};
    }

    const directValues: Record<string, unknown> = {};
    const parsedKeys: string[] = [];

    for (const rule of bridge.parse ?? []) {
      const candidate = this.resolveValueFromSource(output, rule.from ?? 'output', rule.path ?? '');
      const normalized = this.normalizeValue(candidate, rule.transform);
      if (normalized === undefined) {
        if (rule.required && bridge.fallback === 'fail') {
          throw new Error(`ContextBridge parse required value missing at path: ${rule.path ?? '<unknown>'}`);
        }
        continue;
      }

      const key = rule.as ?? rule.path ?? '';
      if (key) {
        this.context[key] = normalized;
        parsedKeys.push(key);
        directValues[key] = normalized;
      }
    }

    for (const rule of bridge.pass ?? []) {
      const value = this.getContextValue(rule.from);
      if (value === undefined) {
        if (rule.required && bridge.fallback === 'fail') {
          throw new Error(`ContextBridge pass required value missing for source: ${rule.from}`);
        }
        continue;
      }

      if (rule.to.includes('.')) {
        Object.assign(directValues, ExecutionContext.resolveNestedTarget({}, rule.to, value));
      } else {
        directValues[rule.to] = value;
      }
    }

    for (const key of parsedKeys) {
      if (key.includes('.')) {
        const flatKey = key.split('.').join('.');
        this.context[flatKey] = this.context[key];
      }
    }

    return directValues;
  }

  private getContextValue(path: string): unknown {
    if (path in this.context) {
      return this.context[path];
    }
    return this.resolveValueFromSource(this.context, 'context', path);
  }

  private resolveValueFromSource(source: unknown, from: 'output' | 'context' | 'input', path: string): unknown {
    if (!path) {
      return from === 'output' ? source : source;
    }

    const sourceValue = from === 'output' ? source : from === 'context' ? this.context : this.initialInputs;

    const normalizedPath = path.replace(/^\$\./, '').replace(/^\./, '');
    if (!normalizedPath) {
      return sourceValue;
    }

    return this.readPath(sourceValue, normalizedPath);
  }

  private readPath(source: unknown, path: string): unknown {
    if (source === null || source === undefined) {
      return undefined;
    }

    const segments = path
      .split('.')
      .flatMap((part) => part.split('[').map((segment) => segment.replace(/\]$/, '')))
      .filter(Boolean);

    let current: unknown = source;
    for (const segment of segments) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current === 'object' && current !== null && segment in current) {
        current = (current as Record<string, unknown>)[segment];
        continue;
      }
      if (Array.isArray(current) && /^\d+$/.test(segment)) {
        const index = Number(segment);
        current = current[index];
        continue;
      }
      return undefined;
    }

    return current;
  }

  private normalizeValue(value: unknown, transform?: 'string' | 'number' | 'boolean' | 'json'): unknown {
    if (value === undefined) {
      return undefined;
    }

    switch (transform) {
      case 'string':
        return String(value);
      case 'number':
        if (value === '') return undefined;
        const numberValue = Number(value);
        return Number.isFinite(numberValue) ? numberValue : undefined;
      case 'boolean':
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
          const lowercase = value.toLowerCase();
          if (lowercase === 'true') return true;
          if (lowercase === 'false') return false;
        }
        return undefined;
      case 'json':
        return typeof value === 'string' ? JSON.parse(value) : value;
      default:
        return value;
    }
  }

  static resolveNestedTarget(target: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
    const segments = path.split('.').filter(Boolean);
    if (segments.length === 0) {
      return target;
    }

    let cursor: Record<string, unknown> = target;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      if (typeof cursor[segment] !== 'object' || cursor[segment] === null || Array.isArray(cursor[segment])) {
        cursor[segment] = {};
      }
      cursor = cursor[segment] as Record<string, unknown>;
    }

    cursor[segments[segments.length - 1]] = value;
    return target;
  }

  static applyStrictParseRules(
    rawOutput: Record<string, unknown>,
    parsedValues: Record<string, unknown>,
    allowedKeys: string[],
  ): Record<string, unknown> {
    const allowed = new Set(allowedKeys);
    const strict: Record<string, unknown> = {};

    for (const key of allowed) {
      if (key in parsedValues) {
        strict[key] = parsedValues[key];
      } else if (key in rawOutput) {
        strict[key] = rawOutput[key];
      }
    }

    return strict;
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
