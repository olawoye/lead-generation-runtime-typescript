import { AgentDefinitionLoader, AgentDefinitionValidationError } from '../src/loader';
import { AgentDefinition } from '../src/types';

const validDefinition: AgentDefinition = {
  version: '1.0',
  id: 'lead-discovery-v1',
  name: 'Lead Discovery Agent',
  description: 'Finds potential leads',
  steps: [
    {
      id: 'search',
      name: 'Search the web',
      type: 'tool',
      tool: 'search_web',
      params: { query: 'SaaS leads' },
    },
    {
      id: 'enrich',
      name: 'Enrich results',
      type: 'llm',
      provider: 'claude',
      dependsOn: ['search'],
    },
  ],
  defaultRetry: { maxAttempts: 2, backoffMs: 100 },
  defaultTimeoutMs: 5000,
};

describe('AgentDefinitionLoader', () => {
  let loader: AgentDefinitionLoader;

  beforeEach(() => {
    loader = new AgentDefinitionLoader();
  });

  it('loads a valid definition without error', () => {
    expect(() => loader.load(validDefinition)).not.toThrow();
    const def = loader.load(validDefinition);
    expect(def.id).toBe('lead-discovery-v1');
    expect(def.steps).toHaveLength(2);
  });

  it('throws when version is missing', () => {
    const raw = { ...validDefinition, version: undefined };
    expect(() => loader.load(raw)).toThrow(AgentDefinitionValidationError);
  });

  it('throws when version is unsupported', () => {
    const raw = { ...validDefinition, version: '2.0' };
    expect(() => loader.load(raw)).toThrow(AgentDefinitionValidationError);
  });

  it('throws when steps array is empty', () => {
    const raw = { ...validDefinition, steps: [] };
    expect(() => loader.load(raw)).toThrow(AgentDefinitionValidationError);
  });

  it('throws on duplicate step ids', () => {
    const raw: AgentDefinition = {
      ...validDefinition,
      steps: [
        { id: 'dupe', name: 'A', type: 'noop' },
        { id: 'dupe', name: 'B', type: 'noop' },
      ],
    };
    expect(() => loader.load(raw)).toThrow(/Duplicate step id/);
  });

  it('throws when dependsOn references unknown step', () => {
    const raw: AgentDefinition = {
      ...validDefinition,
      steps: [{ id: 'step1', name: 'A', type: 'noop', dependsOn: ['nonexistent'] }],
    };
    expect(() => loader.load(raw)).toThrow(/unknown step/);
  });

  it('throws when tool step has no tool field', () => {
    const raw: AgentDefinition = {
      ...validDefinition,
      steps: [{ id: 'step1', name: 'A', type: 'tool' }],
    };
    expect(() => loader.load(raw)).toThrow(/no "tool" field/);
  });

  it('throws when llm step has no provider field', () => {
    const raw: AgentDefinition = {
      ...validDefinition,
      steps: [{ id: 'step1', name: 'A', type: 'llm' }],
    };
    expect(() => loader.load(raw)).toThrow(/no "provider" field/);
  });

  it('accepts noop step with no extra fields', () => {
    const raw: AgentDefinition = {
      ...validDefinition,
      steps: [{ id: 'noop-step', name: 'Pass Through', type: 'noop' }],
    };
    expect(() => loader.load(raw)).not.toThrow();
  });

  it('accepts a declarative agent definition from the provider-neutral schema', () => {
    const raw = {
      apiVersion: 'agent.definition/v1',
      kind: 'AgentDefinition',
      metadata: {
        name: 'outbound-lead-discovery',
        version: '1.0.0',
        displayName: 'Outbound Lead Discovery',
      },
      spec: {
        objective: {
          summary: 'Discover and qualify outbound leads',
          successCriteria: ['Return qualified leads'],
        },
        orar: {
          objective: 'Build a target list',
          resources: ['Company databases'],
          actions: ['Search', 'Enrich'],
          results: ['Qualified leads'],
        },
        tools: [{ id: 'search_web', description: 'Search the web', capabilities: ['web-search'] }],
        state: {
          dedupeKeys: ['domain'],
          leadRecord: {
            type: 'object',
            properties: {
              company: {
                type: 'object',
                description: 'Company details',
              },
            },
          },
        },
        steps: [
          {
            id: 'search_engine_prospecting',
            name: 'Search Engine Prospecting',
            description: 'Search for relevant companies',
            enabled: true,
            dependsOn: [],
            tools: ['search_web'],
            inputs: ['brief'],
            outputs: ['results'],
            configuration: { query: 'Toronto startup attorneys' },
          },
          {
            id: 'lead_enrichment_qualification',
            name: 'Lead Enrichment & Qualification',
            description: 'Qualify the discovered leads',
            enabled: true,
            dependsOn: ['search_engine_prospecting'],
            tools: ['search_web'],
            inputs: ['results'],
            outputs: ['qualified_leads'],
          },
        ],
      },
    };

    expect(() => loader.load(raw)).not.toThrow();
    const def = loader.load(raw);
    expect(def.id).toBe('outbound-lead-discovery');
    expect(def.steps).toHaveLength(2);
    expect(def.steps[0].id).toBe('search_engine_prospecting');
  });
});
