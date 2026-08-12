import { RuntimeEvent, RuntimeEventType } from '../types';

/** An observer that receives runtime events. */
export type EventObserver = (event: RuntimeEvent) => void;

/**
 * ObservabilityEmitter is a lightweight, synchronous pub/sub bus that the
 * Orchestrator uses to broadcast structured events.
 *
 * Consumers can subscribe to all events or filter by event type.
 * Events are emitted synchronously so observers are called in the order
 * they were added.
 */
export class ObservabilityEmitter {
  private readonly observers: EventObserver[] = [];

  /** Add an observer that will receive all events. */
  subscribe(observer: EventObserver): void {
    this.observers.push(observer);
  }

  /** Remove a previously subscribed observer. */
  unsubscribe(observer: EventObserver): void {
    const idx = this.observers.indexOf(observer);
    if (idx !== -1) {
      this.observers.splice(idx, 1);
    }
  }

  /**
   * Emit a runtime event to all subscribed observers.
   * Observer errors are caught and logged to stderr so they never block
   * the main execution path.
   */
  emit(
    type: RuntimeEventType,
    executionId: string,
    payload?: unknown,
  ): void {
    const event: RuntimeEvent = {
      type,
      executionId,
      timestamp: new Date(),
      payload,
    };
    for (const observer of this.observers) {
      try {
        observer(event);
      } catch (err) {
        process.stderr.write(
          `[ObservabilityEmitter] Observer threw for event "${type}": ${String(err)}\n`,
        );
      }
    }
  }
}
