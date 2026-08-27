import { ExecutionContext } from '../src/context';
import { StepResult } from '../src/types';

describe('ExecutionContext', () => {
  let ctx: ExecutionContext;

  beforeEach(() => {
    ctx = new ExecutionContext('exec-1', 'agent-1', { seed: 'initial' });
  });

  it('stores and retrieves step outputs', () => {
    ctx.setOutput('step1', { leads: ['A', 'B'] });
    expect(ctx.getOutput('step1')).toEqual({ leads: ['A', 'B'] });
  });

  it('returns undefined for unknown step output', () => {
    expect(ctx.getOutput('no-such-step')).toBeUndefined();
  });

  it('builds step inputs from initial, deps and static params', () => {
    ctx.setOutput('prev', { items: [1, 2] });
    const inputs = ctx.buildStepInputs({ extra: 'value' }, ['prev']);
    expect(inputs).toEqual({
      seed: 'initial',
      prev: { items: [1, 2] },
      extra: 'value',
    });
  });

  it('static params overwrite initialInputs with same key', () => {
    const inputs = ctx.buildStepInputs({ seed: 'override' });
    expect(inputs['seed']).toBe('override');
  });

  it('records results and exposes them read-only', () => {
    const result: StepResult = {
      stepId: 's1',
      stepName: 'Step One',
      status: 'succeeded',
      attempts: 1,
      startedAt: new Date(),
      finishedAt: new Date(),
      durationMs: 5,
    };
    ctx.recordResult(result);
    const results = ctx.getResults();
    expect(results).toHaveLength(1);
    expect(results[0].stepId).toBe('s1');
  });

  it('allSucceeded returns true when all listed steps succeeded', () => {
    const makeResult = (id: string): StepResult => ({
      stepId: id,
      stepName: id,
      status: 'succeeded',
      attempts: 1,
      startedAt: new Date(),
      finishedAt: new Date(),
      durationMs: 1,
    });
    ctx.recordResult(makeResult('a'));
    ctx.recordResult(makeResult('b'));
    expect(ctx.allSucceeded(['a', 'b'])).toBe(true);
  });

  it('allSucceeded returns false when a step has not succeeded', () => {
    const result: StepResult = {
      stepId: 'a',
      stepName: 'a',
      status: 'failed',
      attempts: 1,
      startedAt: new Date(),
      finishedAt: new Date(),
      durationMs: 1,
    };
    ctx.recordResult(result);
    expect(ctx.allSucceeded(['a'])).toBe(false);
  });

  it('supports optional step input mapping and a shared artifact bag', () => {
    ctx.setOutput('prev', { companyName: 'Widget Co' });
    ctx.addArtifact('candidateCompanies', [{ companyName: 'Widget Co' }]);
    ctx.addArtifact('domains', ['widget.co']);

    const inputs = ctx.buildStepInputs(
      { extra: 'value' },
      ['prev'],
      (base) => ({
        ...base,
        narrowedCompany: base.prev?.companyName,
        shortlist: ctx.getArtifacts().candidateCompanies,
      }),
    );

    expect(inputs).toMatchObject({
      seed: 'initial',
      prev: { companyName: 'Widget Co' },
      extra: 'value',
      narrowedCompany: 'Widget Co',
      shortlist: [{ companyName: 'Widget Co' }],
    });
    expect(ctx.getArtifacts()).toMatchObject({
      candidateCompanies: [{ companyName: 'Widget Co' }],
      domains: ['widget.co'],
    });
  });
});
