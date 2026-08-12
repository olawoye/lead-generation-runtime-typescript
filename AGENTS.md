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

---

## Validation

Run:

```bash
npm install
npm test
npm run typecheck
```
