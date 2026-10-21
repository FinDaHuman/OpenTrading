# ADR 0006: Multi-agent playbooks, adopted only on measured gain

Status: proposed — becomes accepted when the eval below meets its thresholds on the user's own
models; until then ultradesk ships opt-in only and phase 2 (model-written scripts) is not built.

## Context

ADR 0005 keeps the single-agent runtime as the baseline "until measurements justify another
topology", and roadmap Milestone 4 asks for multi-agent work only where a task decomposition
improves measured quality enough to pay for its cost. `resources/workflows/README.md` requires
workflow definitions to be typed, budgeted and versioned, and rules out arbitrary generated code.

Ultradesk (docs/desk.md) is such a topology, modelled on Claude Code's dynamic workflows: a
playbook's code fans research out to many subagents, verifies across them and synthesizes, while
the main agent only receives the result. Anthropic reports large gains from this shape on research
(orchestrator–workers beat a single agent by 90.2% on their internal eval) at about 15× the tokens
of chat, and warns it does not pay off for tightly coupled or low-value tasks. Users on free tiers
pay per request per day, so the cost side weighs more here than for Claude Code.

## Decision

1. **Phase 1 (built).** Four bundled playbooks — `sang-loc`, `kiem-chung`, `tranh-bien`, `nganh`
   — written in TypeScript in the repository. Each declares typed arguments (zod), the agent types
   it may start, its phases, a version, and a per-size estimate of agents and requests; runs end
   in done, partial (resumable) or failed. This is the format `resources/workflows/README.md`
   asked for.
2. **Subordinate to policy (ADR 0005).** Desk agents get read-only tools only, whatever their
   agent type allows; they share the session's permission gate and cannot widen it. `desk_run`
   is never offered to subagents (no nesting) and is visible to the model only on a request the
   user opted into (the `ultradesk` keyword, `/desk on`, `/<playbook>`). Without an opt-in an
   approval card is always shown.
3. **Budgets are code.** Per-run caps on agents, concurrent agents and model requests; a daily
   quota or repeated rate limits cut the run as partial and resumable, and work that could not
   run is reported as unverified, never as refuted.
4. **Measurement decides.** `scripts/dev/desk-eval.ts` answers 20 real questions
   (`test/fixtures/desk-eval/cases.json`, five per playbook) with the single agent and with the
   playbook, and an LLM judge scores both blind (accuracy, citations, completeness, grounding,
   0–1 each; A/B position alternates). This ADR becomes accepted when, on the user's models:
   - the desk's mean score exceeds the single agent's by at least 0.10, and
   - the desk wins at least 60% of the judged cases,
   reported per playbook together with the request cost of each arm. A playbook that misses
   the bar on its own cases is reworked or removed even if the total passes.
5. **Phase 2 waits on step 4.** Model-written playbooks (JavaScript in a real sandbox, approved
   before running) are built only after this ADR is accepted, and only with a sandbox that passes
   an escape test suite. A naive `node:vm` context was shown to leak `process` through host
   functions under Bun.

## Consequences

- Multi-agent runs exist but stay opt-in; the single agent remains the default answer path.
- The eval costs the user real quota (over 500 requests for the full set at the small size), so
  it is run in parts (`--playbook`, `--only`) and never by the tests; the script refuses to
  call a model without `--yes`.
- LLM-judge scores are a proxy: a human spot-check of a few cases per playbook goes with any
  decision to accept. Thresholds are heuristics written down so the decision is not made by eye.
- If the thresholds are not met, ultradesk stays as an opt-in tool (the user asked for it) and
  the effort goes into the playbooks that underperform, not into phase 2.
