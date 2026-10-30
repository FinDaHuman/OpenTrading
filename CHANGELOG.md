# Changelog

All notable changes will be documented here. The project follows Keep a Changelog and will
adopt Semantic Versioning when it exposes a stable public API.

## [Unreleased]

## [0.3.0] — 2026-10-31

Auto mode (▸▸) reviewed end to end, turns that always end with an answer, a per-session temp
folder for the agent, and fixes from real-key testing. Update with `ot update` (npm:
`npm i -g @findahuman/opentrading@latest`).

### Added

- Session temp folder (scratchpad): `<system temp>/opentrading/<folder>/<session>/scratchpad`
  (`OPENTRADING_TMPDIR` moves the base) for scripts, intermediate results and exports that do
  not belong in the user's project. In ▸ and ▸▸ the agent writes there without asking (no
  classifier request); ‖ read-only still asks; deny/ask rules and secret files are checked first,
  and links inside cannot lead writes out. Shell commands are still reviewed as usual.
  `/config` → "Thư mục tạm của phiên" turns it off. Details in `docs/permissions.md`.
- Scratchpad size and cleanup: a `▲` line under an answer when the project's temp folders pass
  1 GB (`scratchpad.warnMB`; measured in the background at most every 30 minutes, once per step);
  session folders untouched for 30 days are deleted at startup (`scratchpad.keepDays`);
  `/scratch` shows the folder and sizes, `/scratch clear [all]` deletes other sessions' (and
  this one's) folders.
- Auto mode: read-only shell commands (`dir`, `git status`, `git log`, …) skip the classifier;
  the classifier sees the workspace's git branch, uncommitted changes and push remotes (pushing
  to the repo's own remote is no longer treated as external), `INVESTOR.md`, and an "Obfuscated
  Command" rule.
- Auto mode: when a sub-agent finishes, the classifier checks what it changed and puts a safety
  warning in front of its result when something looks wrong; web and MCP results are marked as
  outside data.
- Auto mode blocks: one transcript line with the rule and reason (`ctrl+o` for the rest), a
  toast, and `/permissions` to let the call be retried. The model is told not to reach the same
  effect another way and to stop and explain; the classifier sees what was refused since the
  user's last message.
- Todo lists by phase, with their status shown to the model on the next tool round; a list left
  open when the answer ends is retired.

### Changed

- Stop gate: a turn never ends without an answer. An empty final step, a copied todo status
  line, or a short "I'll fetch…" promise without a tool call is sent back to the model once.
- A past turn's answer is sent after its tool results, so Gemini no longer answers a new question
  with a fragment that continues its old answer.
- Side requests (session title, the `web_fetch` reader) use the least reasoning a model allows and
  leave room for it, so reasoning models no longer return an empty title.
- `web_fetch`: the side model has its own time limit, and the model gets the page itself when the
  side model fails instead of an error.
- Web sources are dated in Vietnam time; Gemini search grounding that the key's plan lacks pauses
  until the quota day resets instead of retrying every 10 minutes.
- `/compact` sources a figure that only an earlier answer gave as "câu trả lời trước", not a tool.
- MCP: `retry_after` on 429/503 is honoured; `quota_exceeded` is not retried.
- Auto-mode classifier: one retry on a transient error (never on 429), output room for reasoning
  models, a bounded transcript; untrusted MCP servers' read-only hints go to the classifier.
- OpenTUI 0.6.6 and dependency updates.

### Fixed

- Provider errors: a 404 keeps the provider's reason (for example a model closed to new users and
  its suggested replacement); timeouts read in Vietnamese.

### Security

- zod 4.6.6 (GHSA-mrhx-c7xc-m3w5): a hostile MCP server could exhaust memory with a huge invalid
  array. MCP list responses are also capped in size.

## [0.2.1] — 2026-10-23

First public release, and the first one you can install without Bun or a checkout (0.2.0 was
never published: npm refused the unscoped package name as too close to `opentracing`, so the npm
package is `@findahuman/opentrading`):

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://raw.githubusercontent.com/FinDaHuman/OpenTrading/main/install.ps1 | iex"
```

```bash
curl -fsSL https://raw.githubusercontent.com/FinDaHuman/OpenTrading/main/install.sh | bash
npm i -g @findahuman/opentrading
```

Then open a new terminal and run `ot`. Later versions: `ot update`. Not investment advice.

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
- npm: `npm i -g @findahuman/opentrading`. One package per platform (`opentrading-<os>-<arch>[-baseline]`, chosen by
  npm's `os`/`cpu`) holds the binary; `opentrading` depends on them optionally and its `opentrading`/`ot`
  commands are a small Node launcher (no install script: npm 12 blocks them by default). The release
  workflow publishes them before the GitHub release leaves draft; CI installs the packed files on all
  three systems.
- README: install per OS, update/uninstall and usage come right after the introduction and a screenshot of
  the TUI; full English version in `README.en.md`.

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
