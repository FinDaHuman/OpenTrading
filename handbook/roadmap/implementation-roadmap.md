# Implementation roadmap

## Milestone 0 — scaffold (this repository state)

Deliver contracts, module boundaries, local diagnostics, honest CLI/TUI shells, fixtures, handbook,
CI, and package build. No remote dependency is required.

## Milestone 1 — one vertical research slice

Implement one provider adapter and one verified read-only market-data capability. Add a bounded
single-agent loop and stream one evidence-backed stock research report through CLI. Acceptance:
contract tests cover all adapter failure states; claims link to evidence; budget and cancellation work.

## Milestone 2 — durable local product

Implement SQLite sessions/events, resume, replay, context selection, compaction, credential storage,
and the TUI research experience. Acceptance: crash recovery marks interrupted work accurately; replay
has no network calls; users can export/delete sessions and inspect tool evidence.

## Milestone 3 — market breadth and quality

Add reviewed capabilities for market overview, news/macro, VN30 futures, and internal ML signals.
Run evals for freshness, conflicts, signal semantics, grounding, and prompt injection. Acceptance:
quality/cost/latency baselines are versioned and every upstream capability has an owner and runbook.

## Milestone 4 — extension surfaces

Add versioned skills and standard MCP only where concrete workflows require them. Consider multi-agent
work only after the single-agent baseline identifies a task decomposition that improves measured
quality enough to justify added cost and failure modes. A local web UI reuses application services.

## Separate future programme — execution

Broker/order support is not part of these milestones. It starts with API and legal verification,
threat modeling, immutable order intent, user approval bound to exact order terms, pre-submit recheck,
idempotency, reconciliation, audit, kill switch, and independent release approval.
