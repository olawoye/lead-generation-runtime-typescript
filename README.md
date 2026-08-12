# lead-generation-runtime-typescript

AI-powered lead generation runtime for TypeScript SaaS applications.

This package provides the execution engine for declarative agent definitions. It is designed to be consumed by a host application, such as a multi-tenant CRM or ERP product, without embedding workflow logic directly into the app.

## Install

```bash
npm install @your-org/lead-generation-runtime
```

## Quick example

```ts
import { AgentRuntime } from '@your-org/lead-generation-runtime';

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

## What this package provides

- Agent definition validation and loading
- Declarative step execution
- Tool plan resolution from a catalog or manifest
- LLM adapter registration
- Execution observability and retry handling
- Separation between product logic and agent orchestration

## Intended usage

This runtime is intended to be integrated into a SaaS app that owns tenant state, job queues, CRM data, and user workflows. The app loads the agent definition, starts background execution via the runtime, and persists the returned results into its own domain models.
