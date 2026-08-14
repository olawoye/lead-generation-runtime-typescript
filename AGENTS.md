# AGENTS.md

## Repository purpose

This repository is the TypeScript Runtime project.

It is responsible for consuming agent definitions from the separate Agent Definition package, resolving execution order, validating runtime config, mapping abstract tool identifiers to concrete tool implementations, and orchestrating the execution of declarative steps.

This repository is not the source of truth for the business workflow logic itself. The workflow must remain in the Agent Definition repo.

---

## Architecture boundary

This repo is the "how" layer.

- Agent Definition repo: defines the workflow, strategy, and declarative step contract
- MCP Toolkit repo: offers shared capabilities and tool implementations
- SaaS app: owns product operations, users, tenancy, jobs, persistence, and UI

---

## Rules for AI agents working here

- Keep runtime orchestration logic here.
- Do not hard-code the 10-step agent methodology into runtime code.
- Read the definition and resolve step dependencies dynamically.
- Resolve abstract tool IDs to concrete runtime capabilities without embedding them into the definition itself.
- Prefer configuration-driven behavior over hard-coded workflow assumptions.
- Keep the runtime stateless: no durable execution state, tenant state, billing, or run history inside this repo.
- The runtime should emit lifecycle callbacks and checkpoints; the SaaS app decides where to persist them.

---

## SaaS handoff contract

The SaaS app is responsible for assembling the real runtime configuration from the three sources below:

1. The declarative workflow definition in the Agent Definition repo.
2. The capability registry and server contracts in the MCP Toolkit repo.
3. The tenant-specific runtime environment and secret values supplied by the SaaS app itself.

The runtime should not own persistence, tenant secrets, or provider credential resolution.

### Manifest and credential usage

The SaaS app should:
- load the agent definition to know the workflow and step graph
- load the sample manifest or a tenant-specific copy from the Agent Definition repo as a deployment hint
- map workflow tools to actual MCP server/tool names
- resolve `credentialRef` values from tenant secrets or environment variables
- pass environment variables such as `MT_PROVIDER_SERP_KEY`, `MT_PROVIDER_APOLLO_KEY`, `MT_CUSTOM_CRM_API_URL`, etc. to the appropriate server runtime

The manifest is a deployment-time contract, not a runtime state store.

---

## Validation

Run:

```bash
npm install
npm test
npm run typecheck
```
