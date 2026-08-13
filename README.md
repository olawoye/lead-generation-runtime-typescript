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

## What this package provides

- Agent definition validation and loading
- Declarative step execution
- Tool plan resolution from a catalog or manifest
- LLM adapter registration
- Execution observability and retry handling
- Stateless runtime contract for SaaS-side persistence
- Resume-aware checkpoint lifecycle support
- Clear separation between orchestration and product ownership
