import { StepResolver } from '../src/resolver';
import { StepDefinition } from '../src/types';

const makeStep = (overrides: Partial<StepDefinition> = {}): StepDefinition => ({
  id: 'step1',
  name: 'Step One',
  type: 'noop',
  ...overrides,
});

describe('StepResolver', () => {
  const resolver = new StepResolver();

  it('applies global defaults when step has no overrides', () => {
    const steps = [makeStep()];
    const resolved = resolver.resolve(steps, { maxAttempts: 3, backoffMs: 200 }, 60000);
    expect(resolved[0].retry.maxAttempts).toBe(3);
    expect(resolved[0].retry.backoffMs).toBe(200);
    expect(resolved[0].timeoutMs).toBe(60000);
  });

  it('step-level retry overrides definition defaults', () => {
    const steps = [makeStep({ retry: { maxAttempts: 5, backoffMs: 500 } })];
    const resolved = resolver.resolve(steps, { maxAttempts: 2, backoffMs: 100 });
    expect(resolved[0].retry.maxAttempts).toBe(5);
    expect(resolved[0].retry.backoffMs).toBe(500);
  });

  it('step-level timeoutMs overrides definition default', () => {
    const steps = [makeStep({ timeoutMs: 1000 })];
    const resolved = resolver.resolve(steps, undefined, 30000);
    expect(resolved[0].timeoutMs).toBe(1000);
  });

  it('falls back to 30 000 ms timeout when nothing is provided', () => {
    const steps = [makeStep()];
    const resolved = resolver.resolve(steps);
    expect(resolved[0].timeoutMs).toBe(30_000);
  });

  it('preserves step definition reference', () => {
    const step = makeStep({ id: 'my-step' });
    const resolved = resolver.resolve([step]);
    expect(resolved[0].definition).toBe(step);
  });
});
