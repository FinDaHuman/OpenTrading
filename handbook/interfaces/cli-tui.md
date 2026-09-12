# CLI and TUI contract

Interfaces are thin clients of the same application services. They do not construct data/provider
adapters directly and do not interpret financial data.

## Commands

| Command | Current behavior | Planned stable behavior |
| --- | --- | --- |
| `opentrading --version` | Prints package version | Same |
| `opentrading doctor` | Local validation; no network | Add explicit `--remote` probes later |
| `opentrading status` | Prints capability status | Add adapter and migration status |
| `opentrading research QUESTION` | Exit 3; unimplemented | Stream shared run events |
| `opentrading tui` | Opens/exits shell | Start the shared research application |

Standard output contains user-facing results; diagnostics and machine errors use standard error.
Exit codes are 0 success, 1 run/setup failure, 2 invalid configuration/input, and 3 unavailable
capability. Future `--json` mode emits versioned JSON lines and never mixes presentation text.

## Planned TUI layout

```text
┌ Sessions ─────┬ Research conversation ──────────────────────────────┐
│ active/new    │ user question                                       │
│ saved runs    │ assistant progress and final claims                 │
│               │                                                     │
├───────────────┼ Evidence / tool activity ───────────────────────────┤
│ status        │ source, observation time, freshness, tool state     │
└───────────────┴─────────────────────────────────────────────────────┘
```

Keyboard actions route to application commands. Cancel requests run cancellation. Closing waits for
terminal persistence. Evidence views show source, timestamps, units, availability, and referencing
claims. Credentials and raw provider payloads are never rendered.
