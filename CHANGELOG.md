# Changelog

All notable changes will be documented here. The project follows Keep a Changelog and will
adopt Semantic Versioning when it exposes a stable public API.

## [Unreleased]

### Added

- SQLite memory provider replacing the reference `FileMemory`: user profiles, dated notes per instrument, and
  lessons proposed from feedback that wait for approval in `/memory`. Memory content reaches the model only through
  the per-request context channel; sessions store references. Chat commands (`Ghi nhớ:`, `Ghi chú <MÃ>:`,
  `Xác nhận …`, `Góp ý:`, `Đánh giá:`, `Focus:`) with a deterministic classifier that refuses prices, figures,
  forecasts, holdings and secrets. Business rules in `rules/*.md` with four activation modes. Read-only
  `search_memory` and `load_rule` tools. Versions, logical purge, fingerprints, auto-disable of harmful lessons.
- The agent loop passes each model tier's memory budget (`MemoryContext.maxChars`) to the provider.
- Compaction, summary validator and prune modules for long sessions (not yet wired into the agent loop).

### Removed

- The reference `FileMemory` provider and its `propose_memory` write tool. `memory.provider: "file"` now selects
  the SQLite memory; notes saved by `FileMemory` in `~/.opentrading/memory/` are not imported.

- Initial architecture, contracts, developer handbook, CLI/TUI shell, and test scaffold.
- Enforced provider/tool result variants, session event ordering, report evidence references, and
  market-data availability invariants.
- Added safe configuration diagnostics, secret scanning, and clean wheel-install verification.
- Added complete assistant tool-call history, typed event payload validation, explicit summary and
  resume contracts, and unique calculation identities.
- Adopted OpenTrading as the repository, package, CLI, configuration, and local-state brand.
