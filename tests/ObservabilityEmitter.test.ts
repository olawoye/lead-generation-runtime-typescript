import { ObservabilityEmitter } from '../src/observability';
import { RuntimeEvent } from '../src/types';

describe('ObservabilityEmitter', () => {
  let emitter: ObservabilityEmitter;
  const collected: RuntimeEvent[] = [];

  beforeEach(() => {
    emitter = new ObservabilityEmitter();
    collected.length = 0;
  });

  it('delivers events to subscribers', () => {
    const observer = (e: RuntimeEvent) => collected.push(e);
    emitter.subscribe(observer);
    emitter.emit('execution.started', 'exec-1', { agentId: 'a' });
    expect(collected).toHaveLength(1);
    expect(collected[0].type).toBe('execution.started');
    expect(collected[0].executionId).toBe('exec-1');
  });

  it('delivers to multiple subscribers', () => {
    const a: RuntimeEvent[] = [];
    const b: RuntimeEvent[] = [];
    emitter.subscribe((e) => a.push(e));
    emitter.subscribe((e) => b.push(e));
    emitter.emit('step.started', 'exec-2');
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('stops delivering after unsubscribe', () => {
    const observer = (e: RuntimeEvent) => collected.push(e);
    emitter.subscribe(observer);
    emitter.emit('step.started', 'exec-3');
    emitter.unsubscribe(observer);
    emitter.emit('step.succeeded', 'exec-3');
    expect(collected).toHaveLength(1);
  });

  it('does not throw when a subscriber throws', () => {
    const bad = () => { throw new Error('observer error'); };
    emitter.subscribe(bad);
    expect(() => emitter.emit('execution.failed', 'exec-4')).not.toThrow();
  });

  it('includes a timestamp on emitted events', () => {
    const observer = (e: RuntimeEvent) => collected.push(e);
    emitter.subscribe(observer);
    emitter.emit('execution.succeeded', 'exec-5');
    expect(collected[0].timestamp).toBeInstanceOf(Date);
  });
});
