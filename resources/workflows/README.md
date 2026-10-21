# Workflow resources

Deterministic workflow definitions. Each definition declares typed inputs, permitted tools, budgets,
terminal states, and version. Arbitrary generated code is not a workflow format.

The first workflows are the ultradesk playbooks in `src/core/desk/playbooks/` (docs/desk.md):

- typed inputs: a zod `args` schema per playbook;
- permitted tools: the agent types a playbook may start, always narrowed to read-only tools;
- budgets: a per-size estimate of agents and requests, plus per-run caps (`desk.maxAgents`,
  `desk.maxConcurrent`, `desk.maxRequests`) enforced by the engine;
- terminal states: done, partial (cut by quota, a cap or a stop; resumable from the run's journal)
  and failed;
- version: bumped when prompts or the flow change, so resumed runs never reuse stale answers.

Model-written workflows (JavaScript run in a sandbox and approved before running) are a later phase,
gated by the measurement in `handbook/architecture/adr/0006-measured-multi-agent-playbooks.md`.
