import { AgentRuntime } from '../src/runtime';
import { AgentDefinition, ExecutionResult, RuntimeEvent } from '../src/types';
import { StubClaudeAdapter } from '../src/llm';

const noopDef: AgentDefinition = {
  version: '1.0',
  id: 'test-agent',
  name: 'Test Agent',
  steps: [{ id: 'step1', name: 'Noop Step', type: 'noop' }],
};

const toolDef: AgentDefinition = {
  version: '1.0',
  id: 'tool-agent',
  name: 'Tool Agent',
  steps: [
    {
      id: 'search',
      name: 'Search',
      type: 'tool',
      tool: 'search_web',
      params: { query: 'SaaS' },
    },
  ],
};

const llmDef: AgentDefinition = {
  version: '1.0',
  id: 'llm-agent',
  name: 'LLM Agent',
  steps: [
    {
      id: 'generate',
      name: 'Generate',
      type: 'llm',
      provider: 'claude',
    },
  ],
};

describe('AgentRuntime – full integration', () => {
  it('executes a noop step and reports success', async () => {
    const runtime = new AgentRuntime();
    const result = await runtime.run(noopDef, { inputs: { key: 'value' } });
    expect(result.status).toBe('succeeded');
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0].status).toBe('succeeded');
  });

  it('executes a tool step via registered handler', async () => {
    const runtime = new AgentRuntime();
    runtime.registerTool('search_web', async () => ({
      success: true,
      data: { leads: ['Alpha Corp'] },
    }));
    const result = await runtime.run(toolDef);
    expect(result.status).toBe('succeeded');
    expect(result.stepResults[0].output).toEqual({ leads: ['Alpha Corp'] });
  });

  it('fails execution when tool step fails', async () => {
    const runtime = new AgentRuntime();
    runtime.registerTool('search_web', async () => ({
      success: false,
      error: 'downstream error',
    }));
    const result = await runtime.run(toolDef);
    expect(result.status).toBe('failed');
    expect(result.stepResults[0].status).toBe('failed');
  });

  it('executes an llm step via registered adapter', async () => {
    const runtime = new AgentRuntime();
    runtime.registerLLMAdapter(new StubClaudeAdapter());
    const result = await runtime.run(llmDef);
    expect(result.status).toBe('succeeded');
    expect((result.stepResults[0].output as { content: string }).content).toBeTruthy();
  });

  it('fails when llm provider is not registered', async () => {
    const runtime = new AgentRuntime();
    const result = await runtime.run(llmDef);
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/claude/);
  });

  it('emits execution.started and execution.succeeded events', async () => {
    const runtime = new AgentRuntime();
    const events: RuntimeEvent[] = [];
    runtime.subscribe((e) => events.push(e));
    await runtime.run(noopDef);
    const types = events.map((e) => e.type);
    expect(types).toContain('execution.started');
    expect(types).toContain('execution.succeeded');
    expect(types).toContain('step.started');
    expect(types).toContain('step.succeeded');
  });

  it('runs raw definition through loader validation', async () => {
    const runtime = new AgentRuntime();
    const result = await runtime.runRaw(noopDef);
    expect(result.status).toBe('succeeded');
  });

  it('rejects invalid raw definition', async () => {
    const runtime = new AgentRuntime();
    await expect(runtime.runRaw({ id: 'bad', steps: [] })).rejects.toThrow();
  });

  it('skips a step whose dependencies failed', async () => {
    const runtime = new AgentRuntime();
    runtime.registerTool('failing_tool', async () => ({ success: false, error: 'boom' }));
    const def: AgentDefinition = {
      version: '1.0',
      id: 'dep-agent',
      name: 'Dep Agent',
      steps: [
        { id: 'first', name: 'First', type: 'tool', tool: 'failing_tool' },
        { id: 'second', name: 'Second', type: 'noop', dependsOn: ['first'] },
      ],
    };
    const result = await runtime.run(def);
    expect(result.status).toBe('failed');
    const secondStep = result.stepResults.find((r) => r.stepId === 'second');
    expect(secondStep?.status).toBe('skipped');
  });

  it('retries a failing step the configured number of times', async () => {
    const runtime = new AgentRuntime();
    let calls = 0;
    runtime.registerTool('flaky_tool', async () => {
      calls++;
      if (calls < 3) return { success: false, error: 'transient' };
      return { success: true, data: 'ok' };
    });
    const def: AgentDefinition = {
      version: '1.0',
      id: 'retry-agent',
      name: 'Retry Agent',
      steps: [
        {
          id: 'flaky',
          name: 'Flaky',
          type: 'tool',
          tool: 'flaky_tool',
          retry: { maxAttempts: 3, backoffMs: 0 },
        },
      ],
    };
    const result = await runtime.run(def);
    expect(result.status).toBe('succeeded');
    expect(calls).toBe(3);
  });

  it('populates executionId and agentId on result', async () => {
    const runtime = new AgentRuntime();
    const result = await runtime.run(noopDef);
    expect(result.executionId).toBeTruthy();
    expect(result.agentId).toBe('test-agent');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
