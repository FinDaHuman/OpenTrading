# Harness research and decision matrix

This document records what was inspected, the design lesson, and where it applies. It is an original
synthesis. Files from the parent `Harness/Docs` directory are deliberately excluded. Proprietary or
unverified behavior is labelled as study material rather than source fact.

## Evidence snapshot

| System | Snapshot and evidence inspected | Observed mechanism | Decision in this repo |
| --- | --- | --- | --- |
| Codex | Local `codex-rust-v0.153.4`; `codex-rs/protocol/src/protocol.rs`; `codex-rs/core`; [upstream](https://github.com/openai/codex) | Typed operations/events, shared core for interfaces, explicit abort/error lifecycle | Typed shared contracts, UI-independent runtime, terminal outcomes |
| OpenCode | Commit `830d5eb5354874105cc31599635a80c1662609e8`; `packages/opencode/src/permission`; [upstream](https://github.com/anomalyco/opencode) | Permission service and provider-neutral server/runtime boundary | Code policy before tools; provider ports independent of SDKs |
| DeepSeek Harness | Commit `5dda764ed3aa172535a7967b06ff95d9cbfe536a`; core session and agent-loop packages; [upstream](https://github.com/deepseek-ai/deepseek-harness) | Ordered session facts, owned lifecycle, bounded parallel calls and exclusive barriers | Session-scoped event order and a specified bounded scheduler |
| Claude Code snapshot | Local commit `7c4c781c602f732b0a2a96bbf2d1e14a18b4826b`; origin unavailable; `src/query.ts` | Context/output budgets and layered compaction in the inspected snapshot | Budgets are runtime state; summaries retain source references |
| Cursor study | Parent-workspace research only; proprietary runtime unavailable for source verification | Described context retrieval and workflow-specific modes | Retrieve minimal relevant context; modes must change runtime behavior |

Snapshot identities describe planning evidence. They are not dependency pins or claims about current
upstream production releases. Re-run the study before adopting a new mechanism.

## Selection criteria

An idea enters the scaffold only when it strengthens an explicit invariant, has an owner, can be
tested, and fits a local financial-research product. Evaluate architecture by grounding quality,
latency, cost, recovery, security boundaries, and maintenance effort.

## Adopted decisions

- One shared runtime contract supports CLI, TUI, and a future local web interface.
- Provider wire formats and data-source payloads remain behind typed adapters.
- Policy authorizes tools; prompt, skills, memory, and model output cannot grant permissions.
- Session events are ordered and replayable; accepted facts persist before later steps use them.
- Safe reads may overlap within a bound; exclusive work is an ordering barrier.
- Context, result size, steps, tokens, calls, and wall time are explicit budgets.
- Financial reports preserve evidence identity and distinguish claims from calculations.

## Implementation traceability

The mechanisms below are adaptations of the inspected snapshots, not bundled dependencies or claims
that OpenTrading reproduces the complete upstream runtime. `Implemented contract` means executable
types and validation exist; it does not mean the runtime behavior has been implemented.

| Inspiration | OpenTrading adaptation and location | Current status and next verification |
| --- | --- | --- |
| Codex typed operations and lifecycle | [Session/run/event contracts](../../src/opentrading/contracts/events.py), [session ADR](../architecture/adr/0004-session-event-model.md) | Implemented contracts and validation; durable append, terminal transitions, and crash recovery need storage integration tests |
| Codex shared core across interfaces | [Architecture](../architecture/architecture.md), [CLI/TUI contract](../interfaces/cli-tui.md) | CLI/TUI shells implemented; shared research application and runtime specified |
| OpenCode permission boundary | [Tool specifications and policy port](../../src/opentrading/ports/tools.py), [read-only ADR](../architecture/adr/0003-read-only-tools.md) | Permission and concurrency declarations implemented; policy enforcement and dispatch specified |
| OpenCode provider separation | [Provider port and conversation models](../../src/opentrading/ports/provider.py) | Typed tool-call history and fake provider implemented; real wire-format adapters and stream conformance tests pending |
| DeepSeek Harness ordered session facts | [Session store port](../../src/opentrading/ports/session.py), [event contracts](../../src/opentrading/contracts/events.py) | Sequence/CAS and resume contracts exist; SQLite transaction and replay behavior specified |
| DeepSeek Harness bounded parallel execution | [Runtime policies](../contracts/runtime-policies.md), [tool concurrency declaration](../../src/opentrading/ports/tools.py) | Parallel/exclusive metadata implemented; scheduler, cancellation and ordering barriers specified |
| Claude Code snapshot context management | [Run budgets and summary payload](../../src/opentrading/contracts/events.py), [runtime policies](../contracts/runtime-policies.md) | Budget fields and summary references implemented; token accounting, context selection and compaction execution specified |
| Cursor study on relevant context | [Agent runtime specification](../architecture/agent-runtime.md) | Design guidance only; proprietary implementation unverified; retrieval must be evaluated on research tasks |

## General engineering foundations and financial adaptations

Modular monolith, Ports and Adapters, dependency inversion, strict boundary validation, ADRs, CI and
contract testing are general software-engineering patterns. They are not attributed as inventions of
an individual harness. See the [architecture](../architecture/architecture.md) and
[engineering workflow](../engineering/developer-workflow.md).

OpenTrading adds financial-domain contracts for evidence identity, claim-to-evidence references,
calculation identity, data availability, aware timestamps, price units and futures identity. These
are purpose-built adaptations for the product, captured in the [domain models](../../src/opentrading/domain/market.py)
and [evidence ADR](../architecture/adr/0002-evidence-first-reports.md). Traceability alone does not
prove that evidence supports a claim; the future evaluation suite must assess that separately.

## Internal data-project references

The [internal API inventory](../integrations/internal-apis.md) records Trading_Agents and
DongAnhCapital source snapshots, candidate endpoints, mapping rules and verification gates. The
local source locations inspected were `D:\VsCode\Trading_Agents` and `D:\VsCode\DongAnhCapital`.
The originally supplied `D:\VsCode\Trading\_Agents` path was not present at inspection.

These projects inform data adapters, not the LLM runtime architecture. No upstream source or database
is embedded. Live API adapters remain unimplemented; deployed authentication, payloads, units,
freshness and limits must be verified before integration. This document and its linked inventory
stand alone for developers; they do not require the parent workspace's `Docs` files.

## Deliberately deferred mechanisms

An everything-is-a-plugin runtime, peer agent teams, coding sandboxes, arbitrary shell tools, semantic
auto-approval, IDE indexing, and generated workflows add cost and failure modes without proving value
for the first research flow. Each requires a measured problem, threat analysis, and ADR.
