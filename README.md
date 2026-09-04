# lead-generation-runtime-typescript

AI-powered lead generation runtime for TypeScript SaaS applications.

This package provides the execution engine for declarative agent definitions. It is designed to be consumed by a host application, such as a multi-tenant CRM or ERP product, without embedding workflow logic directly into the app.

## Install

```bash
npm install @olawoye/lead-generation-runtime-typescript
```

## Quick example

```ts
import { AgentRuntime } from '@olawoye/lead-generation-runtime-typescript';

const runtime = new AgentRuntime();

const definition = {
  version: '1.0',
  id: 'lead-agent',
  name: 'Lead Agent',
  steps: [{ id: 'step-1', name: 'noop', type: 'noop' }],
};

const result = await runtime.run(definition);
console.log(result.status);
```

## Architecture

This package is the stateless execution layer. It is responsible for:

- validating and loading agent definitions
- resolving execution order and dependencies
- invoking tool handlers and LLM adapters
- emitting lifecycle events and deterministic checkpoint payloads
- returning a complete execution result to the host

This runtime relies on the shared MCP toolkit as the source of truth for tool definitions, server names, and capability tags. In practice, it reads and resolves entries from the toolkit registry in [../mcp-toolkit/registry/tools.json](../mcp-toolkit/registry/tools.json) and then maps logical runtime tool IDs to the concrete toolkit tool names before execution.

The SaaS app owns the durable state. It decides how to:

- persist checkpoints
- store step lifecycle events
- resume work from a prior checkpoint
- handle retries, cancellations, tenancy, auditing, and billing

## Persistence contract

```ts
import { AgentRuntime, createPersistenceCallbacks } from '@olawoye/lead-generation-runtime-typescript';

const runtime = new AgentRuntime();

const result = await runtime.run(definition, {
  runInput: { campaignId: 'campaign-123' },
  callbacks: createPersistenceCallbacks({
    saveStepEvent: async (event) => {
      await myStore.saveStepEvent(event);
    },
    saveCheckpoint: async (checkpoint) => {
      await myStore.saveCheckpoint(checkpoint);
    },
    saveRunResult: async (execution) => {
      await myStore.saveRun(execution);
    },
  }),
});
```

## Host-side worker pattern

```ts
import { AgentRuntime, InMemoryExecutionStore, ExecutionWorker } from '@olawoye/lead-generation-runtime-typescript';

const runtime = new AgentRuntime();
const store = new InMemoryExecutionStore();
const worker = new ExecutionWorker(runtime, store);

const result = await worker.run(definition, {
  runInput: { campaignId: 'campaign-123' },
});
```

## Context bridge: parse output and pass downstream inputs

This runtime supports an optional `contextBridge` contract for step-to-step and tool-to-tool handoff. It is intentionally additive and does not change legacy behavior for existing agents.

### Contract shape

```json
{
  "contextBridge": {
    "parse": [
      {
        "from": "output",
        "path": "$.company.location",
        "as": "location",
        "transform": "string",
        "required": false
      },
      {
        "from": "output",
        "path": "$.company.website_url",
        "as": "website",
        "transform": "string",
        "required": false
      }
    ],
    "pass": [
      { "from": "location", "to": "tool.params.location" },
      { "from": "website", "to": "tool.params.website" }
    ],
    "fallback": "preserve-existing-inputs"
  }
}
```

### Runtime behavior

- Keep the raw output unchanged.
- Extract only the declared values from the output.
- Store them in an execution context so later steps can access them.
- Use `pass` rules to map values into downstream tool params or LLM inputs.
- If parsing fails, use the `fallback` policy: `preserve-existing-inputs`, `skip-mapping`, or `fail`.

### Example lead flow

```json
{
  "version": "1.0",
  "id": "lead-discovery-v1",
  "name": "Lead Discovery Agent",
  "steps": [
    {
      "id": "search_candidates",
      "name": "Search candidate companies",
      "type": "tool",
      "tool": "web_search",
      "params": {
        "query": "${industry} ${city} software company"
      },
      "outputHints": ["company_candidates", "urls", "titles"],
      "contextBridge": {
        "parse": [
          { "from": "output", "path": "$.results[0].location", "as": "location" },
          { "from": "output", "path": "$.results[0].industry", "as": "industry" }
        ],
        "pass": [
          { "from": "location", "to": "tool.params.location" },
          { "from": "industry", "to": "tool.params.industry" }
        ],
        "fallback": "preserve-existing-inputs"
      }
    },
    {
      "id": "extract_company_profile",
      "name": "Extract company profile",
      "type": "llm",
      "provider": "claude",
      "dependsOn": ["search_candidates"],
      "inputHints": ["location", "industry", "company_candidates"],
      "outputHints": ["company_name", "website", "location", "industry"],
      "extractionContract": {
        "target": "company",
        "fields": ["company_name", "website_url", "location", "industry"],
        "mode": "hybrid",
        "requiredFields": ["company_name"]
      },
      "contextBridge": {
        "parse": [
          { "from": "output", "path": "$.company.location", "as": "location" },
          { "from": "output", "path": "$.company.website_url", "as": "website" },
          { "from": "output", "path": "$.company.company_name", "as": "company_name" }
        ],
        "pass": [
          { "from": "location", "to": "tool.params.location" },
          { "from": "website", "to": "tool.params.website" },
          { "from": "company_name", "to": "tool.params.companyName" }
        ],
        "fallback": "preserve-existing-inputs"
      }
    },
    {
      "id": "local_enrichment",
      "name": "Local enrichment",
      "type": "tool",
      "tool": "company_enrichment",
      "dependsOn": ["extract_company_profile"],
      "params": {
        "companyName": "${company_name}"
      },
      "contextBridge": {
        "parse": [
          { "from": "output", "path": "$.company.phone", "as": "phone" },
          { "from": "output", "path": "$.company.domains[0]", "as": "domain" }
        ],
        "pass": [
          { "from": "phone", "to": "tool.params.phone" },
          { "from": "domain", "to": "tool.params.domain" }
        ],
        "fallback": "preserve-existing-inputs"
      }
    }
  ]
}
```

### SaaS helper guidance

The SaaS app should do the following in strict order:

1. Read the raw step output.
2. Apply only the rule set from `contextBridge.parse`.
3. Keep a normalized context object with only the declared keys.
4. Resolve nested targets such as `tool.params.location` or `tool.params.companyName` explicitly.
5. Inject the values into the next tool call or LLM prompt.
6. Keep raw output untouched for auditing and fallback behavior.

This keeps the LLM parser strict and deterministic while preserving the runtime’s existing behavior when no context bridge is present.

## What this package provides

- Agent definition validation and loading
- Declarative step execution
- Tool plan resolution from a catalog or manifest
- LLM adapter registration
- Execution observability and retry handling
- Stateless runtime contract for SaaS-side persistence
- Resume-aware checkpoint lifecycle support
- Clear separation between orchestration and product ownership
- Optional context-aware parsing and downstream input bridge for LLM-assisted inference
