# OpenTrading

OpenTrading is a local-first scaffold for building an LLM agent that helps users
research Vietnamese equities and derivatives. The intended agent retrieves evidence from
approved internal APIs, explains market information and machine-learning signals, and keeps
the user responsible for every investment decision.

This repository is deliberately a **scaffold**, not a working research agent. It provides
the boundaries, contracts, developer workflow, CLI/TUI shells, tests, and implementation
roadmap required to build the product without confusing specifications with implemented
capabilities.

The repository, Python distribution and module, CLI command, environment-variable prefix, and local
state directory consistently use the `OpenTrading` / `opentrading` brand.

## Current status

| Capability | Status |
| --- | --- |
| Domain and port contracts | Implemented scaffold |
| Configuration validation and local diagnostics | Implemented |
| CLI and TUI shells | Implemented |
| Fake provider adapter for development | Implemented |
| Fake market-data adapter | Specified, not implemented |
| LLM provider adapters | Specified, not implemented |
| Internal market-data API adapters | Specified, not implemented |
| Agent loop and durable sessions | Specified, not implemented |
| Trading or order execution | Out of scope |

Commands never contact a remote API unless their help text explicitly says so. `doctor`
performs local validation only.

## Quick start

Install [uv](https://docs.astral.sh/uv/), then run:

```shell
uv sync --extra dev
uv run opentrading --help
uv run opentrading doctor
uv run opentrading tui
uv run pytest
uv run python scripts/check_docs.py
uv run python scripts/check_secrets.py
uv build
uv run python scripts/smoke_wheel.py
```

The supported runtime is Python 3.12 or newer. Copy `.env.example` to `.env` only when you
begin a real integration; credentials must never enter Git, prompts, logs, or fixtures.

## Where to begin

- [Product boundaries](handbook/product/product-scope.md)
- [Architecture](handbook/architecture/architecture.md)
- [Harness inspirations and implementation traceability](handbook/research/harness-lessons.md)
- [Contracts](handbook/contracts/core-contracts.md)
- [Runtime policies](handbook/contracts/runtime-policies.md)
- [Integration inventory](handbook/integrations/internal-apis.md)
- [CLI and TUI contract](handbook/interfaces/cli-tui.md)
- [Implementation roadmap](handbook/roadmap/implementation-roadmap.md)
- [Contributing](CONTRIBUTING.md)

The source material under the parent workspace's `Docs` folder was used as research input
only. No file from that folder is included in this repository.
