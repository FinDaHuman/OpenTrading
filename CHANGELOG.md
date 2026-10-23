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
- Folder trust: a folder's own `.opentrading/skills` and `.opentrading/agents` load only after the
  user trusts the folder once (saved in `~/.opentrading/folder-trust.json`; home and drive roots
  only for the run). `.mcp.json` keeps its per-server approval.
- `/model` asks for the effort after a model with more than one level: `auto` and the model's
  levels, saved together with the model; esc goes back to the list. Enter on the highlighted
  row before moving keeps the saved level. `/config` → "Hỏi effort khi chọn model" (`ui.askEffort`) turns it off.
- Standalone binaries: `bun run build` (`--single` for this machine only) compiles
  `dist/opentrading-<os>-<arch>/bin/opentrading[.exe]` with Bun inside, for Windows, Linux and macOS
  (x64, arm64, x64 baseline). Bundled skills, agents, prompts and the market calendar are compiled
  in and written once per version to `~/.opentrading/bundled/`. A hidden `--self-check` verifies a
  build; CI builds and checks it on Ubuntu, Windows and macOS.
- Release workflow: pushing a tag `vX.Y.Z` builds every binary on Windows, Ubuntu and macOS runners,
  attaches `.zip`/`.tar.gz` archives and `SHA256SUMS` to a GitHub release (draft first, published when every
  channel has it), with notes from this file. Steps in `docs/release.md`.
- One-line installers: `install.ps1` (Windows, `irm … | iex`) and `install.sh` (macOS/Linux, `curl … | bash`)
  pick the build for the machine (arm64, no-AVX2 baseline, Rosetta), check it against `SHA256SUMS`, put
  `opentrading` and `ot` in `~/.opentrading/bin` and add it to PATH (Windows: the user PATH, kept unexpanded;
  Unix: one marked line in the shell's startup file). `--version`, `--binary`, `--no-modify-path`,
  `--uninstall`. CI installs from a local copy of a release on Ubuntu, Windows and macOS.
- `opentrading update` (alias `upgrade`; `--check`; `update 0.3.0` for a given version): downloads the
  build for this machine, checks `SHA256SUMS` and the new binary's `--version`, then swaps it in for
  `opentrading` and `ot` (Windows: the running files are renamed to `.old` and removed on the next start).
  npm installs get the `npm i -g` command instead; source checkouts get `git pull`. The TUI looks for a new
  release at most once a day and shows a toast; `/config` → "Báo bản mới" (`update.check`) or
  `OPENTRADING_DISABLE_UPDATE_CHECK=1` turns it off. `--version` mentions a newer release it already knows.

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
