# Changelog

All notable changes will be documented here. The project follows Keep a Changelog and will
adopt Semantic Versioning when it exposes a stable public API.

## [Unreleased]

### Added

- First public release under the Apache License 2.0, with `NOTICE` and `THIRD_PARTY_NOTICES.md`.
- `opentrading` / `ot` command: `bun run install:global` writes launchers to `~/.local/bin`; the TUI
  opens with the current folder (or `opentrading <folder>`) as its workspace. `--help`, `--version`,
  unknown options are errors. The Home screen shows the workspace.
- Sessions belong to the folder they were opened in: `--continue` reopens this folder's newest
  session, `/sessions` lists this folder's sessions (`tab` for every folder).

## [0.1.0] — 2026-10-22 (pre-release, private)

The TypeScript/Bun rewrite of the original Python scaffold (now in `legacy-python/` history only).

### Added

- Terminal UI (OpenTUI + SolidJS) with a Claude Code–style transcript, prompt input, docked panes,
  notifications and terminal attention signals.
- 200+ LLM providers from models.dev (`/connect`, `/model`), reasoning effort levels.
- Agent loop with tool search over deferred tools, retries by failure kind, context-window
  compaction (`/compact`) and recovery from context overflow.
- MCP client: stdio, HTTP and SSE transports, OAuth, per-provider schemas, `/mcp`, approvals.
- Skills (`SKILL.md`), investor profile, memory, sessions (`/sessions`, `--resume`, `/export`).
- Subagents (parallel, background, agent types) and Ultradesk multi-agent playbooks (`/desk`).
- File and shell tools with three permission modes, `/undo`, and an auto mode classifier.
- Local tools: charts, watchlist, web search and fetch.
