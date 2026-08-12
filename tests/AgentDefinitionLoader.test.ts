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
});
