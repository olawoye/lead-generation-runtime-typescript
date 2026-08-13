import * as path from 'path';
import { AgentRuntime, createPersistenceCallbacks, InMemoryExecutionStore, InMemoryExecutionRepository, ExecutionWorker } from '../src/runtime';
import { AgentDefinition, ExecutionResult, RuntimeEvent } from '../src/types';
import { StubClaudeAdapter } from '../src/llm';
import { loadToolkitCatalogFromFile, CANONICAL_TOOL_MAP } from '../src/mcp';

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

  it('emits deterministic checkpoint payloads and callbacks for stateless runs', async () => {
    const runtime = new AgentRuntime();
    const stepStarts: Array<{ executionId: string; stepId: string }> = [];
    const stepResults: Array<{ executionId: string; stepId: string; status: string }> = [];
    const checkpoints: Array<{ executionId: string; status: string; stepResults: unknown[] }> = [];

    const result = await runtime.run(noopDef, {
      runInput: { campaignId: 'campaign-123' },
      callbacks: {
        onStepStart: (event) => stepStarts.push(event),
        onStepResult: (event) => stepResults.push(event),
        onCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
        onRunEnd: (payload) => {
          expect(payload.status).toBe('succeeded');
        },
      },
    });

    expect(stepStarts).toHaveLength(1);
    expect(stepStarts[0].stepId).toBe('step1');
    expect(stepResults).toHaveLength(1);
    expect(stepResults[0].status).toBe('succeeded');
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);
    expect(checkpoints[0].executionId).toBe(result.executionId);
    expect(result.checkpoint).toEqual(checkpoints[checkpoints.length - 1]);
  });

  it('persists lifecycle events and checkpoints through a SaaS-owned adapter', async () => {
    const runtime = new AgentRuntime();
    const stepEvents: Array<{ executionId: string; stepId: string; status: string }> = [];
    const checkpoints: Array<{ executionId: string; status: string }> = [];
    const runResults: ExecutionResult[] = [];

    const result = await runtime.run(noopDef, {
      runInput: { campaignId: 'campaign-456' },
      callbacks: createPersistenceCallbacks({
        saveStepEvent: (event) => {
          void stepEvents.push({
            executionId: event.executionId,
            stepId: event.stepId,
            status: event.status,
          });
        },
        saveCheckpoint: (checkpoint) => {
          void checkpoints.push({
            executionId: checkpoint.executionId,
            status: checkpoint.status,
          });
        },
        saveRunResult: (execution) => {
          void runResults.push(execution);
        },
      }),
    });

    expect(stepEvents).toHaveLength(2);
    expect(stepEvents[0].stepId).toBe('step1');
    expect(stepEvents[0].status).toBe('running');
    expect(stepEvents[1].status).toBe('succeeded');
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);
    expect(checkpoints[checkpoints.length - 1].executionId).toBe(result.executionId);
    expect(runResults).toHaveLength(1);
    expect(runResults[0].status).toBe('succeeded');
  });

  it('supports the declarative agent.definition/v1 shape and explicit run lifecycle hooks', async () => {
    const runtime = new AgentRuntime();
    const started: Array<{ executionId: string; agentId: string }> = [];
    const errors: Array<{ executionId: string; status: string }> = [];

    const declarativeDefinition = {
      apiVersion: 'agent.definition/v1',
      kind: 'AgentDefinition',
      metadata: {
        name: 'declarative-agent',
        displayName: 'Declarative Agent',
        description: 'A declarative definition',
      },
      spec: {
        objective: 'Test declarative loading',
        steps: [{ id: 's1', name: 'noop', type: 'noop' }],
      },
    } as const;

    const result = await runtime.runRaw(declarativeDefinition, {
      runInput: { campaignId: 'campaign-abc' },
      callbacks: {
        onRunStart: (event) => {
          started.push({ executionId: event.executionId, agentId: event.agentId });
        },
        onRunError: (event) => {
          errors.push({ executionId: event.executionId, status: event.status });
        },
      },
    });

    expect(result.status).toBe('succeeded');
    expect(started).toHaveLength(1);
    expect(started[0].agentId).toBe('declarative-agent');
    expect(errors).toHaveLength(0);
  });

  it('supports a repository-style worker that persists and resumes from a checkpoint store', async () => {
    const runtime = new AgentRuntime();
    const store = new InMemoryExecutionStore();
    const worker = new ExecutionWorker(runtime, store);

    const initial = await worker.run(noopDef, { runInput: { campaignId: 'campaign-789' } });
    expect(initial.status).toBe('succeeded');

    const resumed = await worker.run(noopDef, {
      runInput: { campaignId: 'campaign-789' },
      executionId: initial.executionId,
    });

    expect(resumed.executionId).toBe(initial.executionId);
    expect(resumed.status).toBe('succeeded');
    expect(await store.loadLatestCheckpoint(initial.executionId)).toBeTruthy();
  });

  it('supports a tenant-scoped execution repository for app-owned persistence', async () => {
    const runtime = new AgentRuntime();
    const repo = new InMemoryExecutionRepository('tenant-1');
    const worker = new ExecutionWorker(runtime, repo);

    const result = await worker.run(noopDef, {
      executionId: 'repo-run-1',
      runInput: { campaignId: 'campaign-tenant' },
    });

    expect(result.status).toBe('succeeded');
    expect((await repo.findByTenant('tenant-1')).length).toBeGreaterThan(0);
    await repo.markCancelled('repo-run-1');
    expect((await repo.loadExecution('repo-run-1'))?.status).toBe('cancelled');
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

  it('selects only the servers and tools needed from a toolkit manifest', () => {
    const runtime = new AgentRuntime();
    const def: AgentDefinition = {
      version: '1.0',
      id: 'tool-plan-agent',
      name: 'Tool Plan Agent',
      steps: [
        {
          id: 'search_step',
          name: 'Search',
          tools: ['web_search', 'maps_search_places'],
          inputs: ['brief'],
          outputs: ['results'],
        },
      ],
    } as AgentDefinition;

    const catalog = [
      { name: 'web_search', server: 'web-search', capabilities: ['web-search'] },
      { name: 'web_news_search', server: 'web-search', capabilities: ['news-search'] },
      { name: 'maps_search_places', server: 'maps', capabilities: ['maps-search'] },
      { name: 'detect_technologies', server: 'technology-detection', capabilities: ['technology-detection'] },
    ];

    const plan = runtime.resolveToolPlan(def, catalog);
    expect(plan.servers.sort()).toEqual(['maps', 'web-search']);
    expect(plan.tools.map((tool) => tool.name).sort()).toEqual(['maps_search_places', 'web_search']);

    const loadOnlyRequired = runtime.registerToolPlan(def, catalog, (toolName) => {
      if (toolName === 'web_search') return async () => ({ success: true, data: 'search ok' });
      if (toolName === 'maps_search_places') return async () => ({ success: true, data: 'place ok' });
      return undefined;
    });

    expect(loadOnlyRequired.servers.sort()).toEqual(['maps', 'web-search']);
    expect(runtime.toolRegistry.listTools().sort()).toEqual(['maps_search_places', 'web_search']);
  });

  it('exposes a canonical tool map that matches the toolkit registry vocabulary', () => {
    expect(CANONICAL_TOOL_MAP.google_search).toBe('web_search');
    expect(CANONICAL_TOOL_MAP.maps).toBe('maps_search_places');
    expect(CANONICAL_TOOL_MAP.business_directory_search).toBe('company_directory_search');
    expect(CANONICAL_TOOL_MAP.website_research).toBe('website_content_research');
    expect(CANONICAL_TOOL_MAP.lead_scoring).toBe('lead_scoring');
  });

  it('resolves declarative logical tool ids into the concrete toolkit tool names through a canonical capability map', () => {
    const runtime = new AgentRuntime();
    const catalog = [
      { name: 'web_search', server: 'web-search', capabilities: ['web-search'] },
      { name: 'maps_search_places', server: 'maps', capabilities: ['maps-search'] },
      { name: 'company_directory_search', server: 'business-directories', capabilities: ['business-directory', 'company-discovery'] },
      { name: 'website_technology_scan', server: 'website-research', capabilities: ['website-analysis', 'technology-detection'] },
    ];

    const def: AgentDefinition = {
      version: '1.0',
      id: 'logical-tool-id-agent',
      name: 'Logical Tool Id Agent',
      steps: [
        {
          id: 'research_step',
          name: 'Research',
          tools: ['google_search', 'maps', 'business_directory_search', 'website_research'],
          inputs: ['brief'],
          outputs: ['results'],
        },
      ],
    };

    const plan = runtime.resolveToolPlan(def, catalog);
    expect(plan.tools.map((tool) => tool.name).sort()).toEqual([
      'company_directory_search',
      'maps_search_places',
      'web_search',
      'website_technology_scan',
    ]);
  });

  it('loads the real toolkit manifest from disk and resolves the required multi-server set', () => {
    const runtime = new AgentRuntime();
    const manifestPath = path.resolve(__dirname, '../../mcp-toolkit/registry/tools.json');
    const catalog = loadToolkitCatalogFromFile(manifestPath);

    const def: AgentDefinition = {
      version: '1.0',
      id: 'manifest-agent',
      name: 'Manifest Agent',
      steps: [
        {
          id: 'research_step',
          name: 'Research',
          tools: ['web_search', 'maps_search_places', 'company_directory_search', 'website_technology_scan'],
          inputs: ['brief'],
          outputs: ['results'],
        },
      ],
    } as AgentDefinition;

    const plan = runtime.resolveToolPlan(def, catalog);
    expect(plan.servers.sort()).toEqual(['business-directories', 'maps', 'web-search', 'website-research']);
    expect(plan.tools.map((tool) => tool.name).sort()).toEqual([
      'company_directory_search',
      'maps_search_places',
      'web_search',
      'website_technology_scan',
    ]);
  });

  it('resolves the remaining public-data and event-driven discovery capabilities from the manifest', () => {
    const runtime = new AgentRuntime();
    const manifestPath = path.resolve(__dirname, '../../mcp-toolkit/registry/tools.json');
    const catalog = loadToolkitCatalogFromFile(manifestPath);

    const def: AgentDefinition = {
      version: '1.0',
      id: 'manifest-agent-final',
      name: 'Manifest Agent Final',
      steps: [
        {
          id: 'late_stage_search',
          name: 'Late Stage Search',
          tools: ['public_records_search', 'events_search', 'signal_monitoring'],
          inputs: ['brief'],
          outputs: ['results'],
        },
      ],
    } as AgentDefinition;

    const plan = runtime.resolveToolPlan(def, catalog);
    expect(plan.servers.sort()).toEqual(['events', 'public-data']);
    expect(plan.tools.map((tool) => tool.name).sort()).toEqual([
      'events_search',
      'public_records_search',
      'signal_monitoring',
    ]);
  });

  it('loads the selected tools directly from a manifest file path', () => {
    const runtime = new AgentRuntime();
    const manifestPath = path.resolve(__dirname, '../../mcp-toolkit/registry/tools.json');

    const def: AgentDefinition = {
      version: '1.0',
      id: 'manifest-loader-agent',
      name: 'Manifest Loader Agent',
      steps: [
        {
          id: 'lookup_step',
          name: 'Lookup',
          tools: ['web_search', 'company_directory_search'],
          inputs: ['brief'],
          outputs: ['results'],
        },
      ],
    } as AgentDefinition;

    const plan = runtime.resolveToolPlanFromManifest(def, manifestPath);
    expect(plan.servers.sort()).toEqual(['business-directories', 'web-search']);
    expect(plan.tools.map((tool) => tool.name).sort()).toEqual(['company_directory_search', 'web_search']);

    runtime.registerToolPlanFromManifest(def, manifestPath, (toolName) => {
      if (toolName === 'web_search') return async () => ({ success: true, data: 'search ok' });
      if (toolName === 'company_directory_search') return async () => ({ success: true, data: 'directory ok' });
      return undefined;
    });

    expect(runtime.toolRegistry.listTools().sort()).toEqual(['company_directory_search', 'web_search']);
  });
});
