import { ExecutionResult, RunCheckpoint, RuntimeCallbacks, StepLifecycleEvent } from '../types';

export interface PersistenceCallbacksOptions {
  saveStepEvent?: (event: StepLifecycleEvent) => void | Promise<void>;
  saveCheckpoint?: (checkpoint: RunCheckpoint) => void | Promise<void>;
  saveRunResult?: (result: ExecutionResult) => void | Promise<void>;
  onError?: (error: unknown, phase: 'step-start' | 'step-result' | 'checkpoint' | 'run-end') => void;
}

/**
 * Factory for SaaS-owned persistence hooks.
 *
 * The runtime remains stateless and emits deterministic lifecycle events and
 * checkpoint payloads. The host app decides how to store them in its own
 * database, queue, or telemetry system.
 */
export function createPersistenceCallbacks(
  options: PersistenceCallbacksOptions = {},
): RuntimeCallbacks {
  return {
    onStepStart: async (event) => {
      try {
        await options.saveStepEvent?.(event);
      } catch (error) {
        options.onError?.(error, 'step-start');
      }
    },
    onStepResult: async (event) => {
      try {
        await options.saveStepEvent?.(event);
      } catch (error) {
        options.onError?.(error, 'step-result');
      }
    },
    onCheckpoint: async (checkpoint) => {
      try {
        await options.saveCheckpoint?.(checkpoint);
      } catch (error) {
        options.onError?.(error, 'checkpoint');
      }
    },
    onRunEnd: async (result) => {
      try {
        await options.saveRunResult?.(result);
      } catch (error) {
        options.onError?.(error, 'run-end');
      }
    },
  };
}
