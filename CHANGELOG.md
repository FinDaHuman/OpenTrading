# Changelog

All notable changes will be documented here. The project follows Keep a Changelog and will
adopt Semantic Versioning when it exposes a stable public API.

## [Unreleased]

### Added

- Memory v5.1 store (`src/core/memory/store/`), not wired into the app yet: one SQLite file opened
  from an explicit path; schema version 1 with step-by-step migrations; a store from a newer build,
  another program's file or a damaged file is refused and left untouched. Versioned constraints and
  presentation style, subjects with internal ids and alias history, thesis versions that are never
  renumbered, lessons, and an append-only decision log tied to the thesis version the user saw.
  Every change checks the version it was read from; ids are never reused; deleting removes the
  content and keeps ids and version numbers. Texts are length-checked (never cut), and text shaped
  like an API key is refused.
- Memory policy table (`src/core/memory/policy.ts`) and the one policy-checked read path over the
  store: sub-agents get constraints only, and no model-facing read ever returns a decision.
- Memory v5.1 read path, the "Sổ ghi nhớ" (notebook) choice in `/config` next to "Tắt" and the legacy
  file memory (`src/core/memory/notebook/`). Constraints and presentation style go into the system
  part of every main-agent request, word for word with id and version, never cut. The notebook's
  index (subjects with a thesis, lesson titles) goes into the context part. When the user names a
  subject that has a thesis (aliases, any case or diacritics, whole words, the user's typed words
  only), its labelled block is injected once per session; a newer version replaces it with a "thay
  cho bản N" label, and a change, state change or deletion of something already sent is noted once.
  Everything stays under the smallest tier's memory budget, so the core never cuts a block; a block
  that does not fit gets a one-line pointer instead. `memory_read` is the model's only memory tool and
  only reads (a subject's thesis, a lesson by number, lessons by keyword); decisions never reach the
  model. Stored text is escaped and never starts a line. A store that fails to open says why at
  startup, in `/config` and `/memory`, and in the system part; chat keeps working. `/memory` shows the
  five groups and deletes the version on screen after asking. The store is closed when switching
  away and on exit. Known limits of this minimal version: what was sent is tracked in RAM per session
  (compaction, a resumed session after a restart, or switching memory off and on can repeat or miss a
  block), deleting does not mask old blocks in the history yet, and sub-agents do not get constraints
  yet.
- Memory v5.1 write path: `/nho` (a constraint or a presentation style, no section chosen by
  default), `/luandiem <code>` (a new thesis version; a code not in the notebook creates the subject),
  `/baihoc` and `/quyetdinh <code>` open forms that run on this machine only, with no model call and
  no chat turn. Nothing is written until the user confirms. The prompt history keeps only the command
  name (on send, Esc Esc and Ctrl+C), so a pasted key or a private thesis never lands there. Forms show
  each field's length against its limit and refuse to save over it (nothing is cut); warn, without
  blocking, on a hard rule saved as a lesson (with a way to save it as a constraint instead), on a
  price or forecast, and on a duplicate; show the field-by-field changes before an edit is saved; and,
  when another window saved first, show what differs and let the user keep theirs as the next
  version, take the other one, or keep editing. A decision rests on the thesis version the form
  showed; a newer one saved meanwhile is asked about, never attached silently. Ctrl+C on a changed
  form asks like Esc. `/memory` adds edit, a thesis state change, and a Markdown export to the app's
  exports folder, decisions left out unless asked for on that export.
- The user's constraints reach every agent, whatever memory is set to in `/config`: the host reads
  them from `memory.db` at the start of every turn of the main agent and of every sub-agent (new
  task, continued task, ultradesk) and sends them word for word with id and version, exactly once,
  never cut. With the notebook off the store is opened read-only (never created, never migrated, no
  connection kept); `/config` and the notebook-off message say how many constraints still apply. A
  model too small for them is not sent the turn.
- A turn is held, before anything is sent and before any hook runs, when `INVESTOR.md` or the
  constraint store exists but cannot be read (reads have a deadline and retry passing locks for
  under a second). The TUI shows a card: retry, run this turn without the failed source (the model
  is told what is missing; a source that read is still sent; sub-agents started in that turn, and
  every agent of an ultradesk run started in it, follow the same choice), or cancel (the question goes
  back to the box, before anything typed meanwhile; stopping the turn while it reads does the same).
  `/context` says which source could not be read and that the next turn will be held.
  A store from a newer build, another file or damaged data gets a way out in the message; the app
  never deletes or repairs it. The provider check from the command line prints the reason and exits
  with code 1. Compaction and `/context` leave a failed source out instead of holding.

### Fixed

- Saving a session recovers from a failed write instead of repeating the first error forever. The
  failed turn stays queued and is written, in order and once, with the next one; the session's
  first line is written by the first write that succeeds, so a session whose first turn failed
  still shows in `/sessions`. A write cut halfway is cut back, and a torn last line no longer
  swallows the first line of the next turn. The TUI says which turns are not saved yet and when
  they are caught up.
- Switching sessions (`/new`, `/clear`, resume), `/save`, `/export` and exit wait up to 2 s for the
  session's writes; a session left while still writing finishes in the background, and resuming it
  reuses the same writer.
- Local watchlist file lock: the holder refreshes the lock, so a slow but live holder is never taken
  over; taking over and releasing check the owner's token; the holder checks it still owns the lock
  right before each rename attempt; creating the lock waits through Windows' delete-pending errors.
- `writeJson` removes its temp file on every failure (for `auth.json` it holds the key).
- `desk-eval.ts` can read pages again: its approval responder never ran, so every `web_fetch` to
  a new domain was refused. Expect more requests than its estimate, because `web_fetch` calls a
  side model.
- The `co-ban` agent prompt no longer carries a real HPG divestment figure, which could leak
  into answers. `skill-routing-live-eval.ts` calls a model only with `--yes`.
- Stop gate: an answer that claims fetched data (a tool name, `Nguồn:`, "đã lấy dữ liệu") with
  figures the conversation does not hold, in a turn where no data tool ran, is sent back once
  with tools on. If the retry does the same, the answer stays and the user is told its figures
  are unverified.

### Changed

- Subagents no longer get the session history tools (`session_list`, `session_get`); the main agent
  keeps them and quotes what a task needs.
- `/profile` writes a template whose examples are comments. What goes to the model from
  `INVESTOR.md` leaves out comments, lines equal to an example of the old template (an edited one is
  kept) and empty sections, and is escaped so no text can close its block. A profile that is only
  headings and comments sends nothing.
- The notebook no longer lists the constraints in its own system part (they have their own block);
  the `/nho` form no longer says sub-agents do not get them.

## [0.3.1] — 2026-11-03

Fixes for the QA reports of 23, 25 and 27 October 2026, and run keys that no longer land in a
list's filter (`/desk`, `/permissions`). Update with `ot update` (npm:
`npm i -g @findahuman/opentrading@latest`).

### Changed

- Ultradesk: a run with no usable data now ends `failed` instead of `done`. Playbooks get
  `agent(…, { accept })` to reject an answer before it is kept, and `DeskNoData` to end a run as
  `failed` (`sang-loc`, `nganh` and `tranh-bien` use both).
- Ultradesk: the retry after a 429 counts as one more agent against `desk.maxAgents`.
- `/desk`: pause, stop and resume are `ctrl+p`, `ctrl+x` (one press) and `ctrl+r`, as in `/tasks` and
  `/agents`. A plain `p`, `x` or `r` typed in the run or agent list now only filters it; before, it
  both acted on the run and landed in the filter.
- `/permissions`: an auto-mode block is let through once with `ctrl+r` (was `r`). The retry
  puts the list back at once, and a plain `r` landed in its filter. Same convention as `/desk`,
  `/tasks` and `/agents`.

### Fixed

- Update: startup cleanup removes only the `opentrading.exe`/`ot.exe` `.old` files the updater (and
  `install.ps1`) moved aside, never the user's own `*.old` files in the install folder.
- Ultradesk: `desk.maxAgents` holds when a run starts more agents at once than the cap (for example
  `maxAgents: 2`, `maxConcurrent: 3`): agents waiting for a slot, the stagger or a pause no longer
  all start.
- `read_file` on Word: paragraphs inside one table cell stay apart (`100<br>200`, not `100200`).
- `read_file` on Excel: a sheet named like a number ("2026") is found by its name first; files
  written with a namespace prefix (`x:sheet`) are read; a cell in the last Excel row no longer
  overflows the stack.
- `grep_files` searches files up to 20 MiB (read_file's limit, was 2 MiB) and lists the files it
  skipped instead of answering a bare "not found".
- Ultradesk: pause also holds agents already queued; a 429 on the retry cuts the run; two
  resumes of one run share one launch; an effort inherited from `desk.effort` follows the config
  on resume; a journal line cut by a crash no longer swallows the next result.
- Ultradesk: `sang-loc`/`nganh` reject a scorecard about another ticker instead of relabelling it;
  a run with no usable data ends `failed` (resumable with `ctrl+r`), not `done`; `ctrl+r` works in the detail
  view of a run from an earlier sitting.
- Config: concurrent saves no longer lose each other's changes (in-process queue + lock file).
- `web_search`: `recency_days` is applied after every backend (DuckDuckGo and Parallel get it
  too); a provider search whose sources were all blocked falls back, and its summary is dropped
  whenever a source was filtered out.
- MCP: tool/prompt/resource lists stop at their caps (a cut server is marked in `/mcp`); a
  shortened tool name never collides with another tool's name.
- Sessions: a malformed index line or message is skipped instead of breaking `/sessions` or
  resume; `/export` without `--force` never overwrites a file created meanwhile.
- Memory: a memory file edited by hand without dates no longer silently disables every memory;
  `/desk`: a damaged `meta.json` no longer breaks the list of the session's runs.
- `/config`, `/effort` and other settings dialogs no longer overwrite a nested setting saved
  meanwhile (for example a playbook approved with "không hỏi lại").
- `ot update` on Windows: a work folder still locked for a moment after the swap no longer
  reports a finished update as failed.
- `/watchlist <a name that is no list>`: `r` is typed into the lists' filter again (it was
  swallowed as "refresh"), and one esc closes the dialog.
- `docs/mcp.md`: logging out of a server is the **Đăng xuất** row of its menu; there is no `x` key.


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
