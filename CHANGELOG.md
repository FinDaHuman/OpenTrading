# Changelog

All notable changes will be documented here. The project follows Keep a Changelog and will
adopt Semantic Versioning when it exposes a stable public API.

## [Unreleased]

### Added

- OpenRouter provider pinning: `openrouter.routing` in `config.json` maps a model id (or `"*"`) to OpenRouter's `provider` block (`order`, `allow_fallbacks`, `quantizations`…), sent on every request to that model: main agent, subagents, compaction, title, web side calls and the auto-mode reviewer. Eval runs pin with `--or-provider`, `--or-no-fallback` and `--or-quant`, and the trace records `served_by`, the upstream provider that answered each step. OpenRouter's "no provider" error now reads as one Vietnamese line. See `docs/openrouter.md`.
- OpenCode Go/Zen: every request to `opencode.ai` sends OT's own `User-Agent` (`opentrading/<version> (<os> <arch>)`) and `x-opencode-session`, as Go's docs ask: the session id for the main agent and side calls, `<session>/<agent id>` for a subagent, one id per question in eval runs. Native web search clients now use the same fetch, so their requests also count toward the request tally and the eval ledger. See `docs/opencode-go.md`.
- `shell`: a command that only does arithmetic runs without a prompt in every permission mode, `ot -p` and evals
  (no ▸▸ classifier request); deny and ask rules still apply. Windows: bare PowerShell expressions with
  `[math]::` functions, printed in the invariant culture; macOS/Linux: `awk 'BEGIN{printf …}'` in the C locale.
  Anything else (a variable, a file, a pipe, `1..3`, a comma outside a call) asks as before. `docs/permissions.md`.
- Read-only subagents (`@chi-doc`) and ultradesk agents get `shell` for arithmetic only; any other command is refused
  at once, never put to the user. `/agents` lists it as "shell (chỉ tính toán)".

### Changed

- `prompts/tools.md`: computed figures (ratios, %, CAGR, P/E, unit changes) come from one arithmetic-only `shell`
  command per step, large amounts scaled to tỷ đồng inside the expression; the answer states the formula and inputs.
  A command that still fails after one fix may be computed by hand, labelled "tự tính" with formula and inputs.
- `shell` is always declared (no longer deferred): arithmetic needs no `tool_search` request first.
- Skills that used `compute` (valuation history, sector RS, ranking after troughs, sector KPIs) work from start/end
  values (RS fetches 64 bars: the table cap always keeps the first and last row) and the periods `financial_ratios`
  returns, computed in one `shell` command.
- `/memory` has three tabs, like Claude Code's settings: **Gợi ý** (the suggestion cards still waiting: Enter
  opens the form filled in, `x` dismisses), **Sổ ghi nhớ** (the notebook as before) and **Cài đặt** (memory
  on or off and the card switch, also still in `/config › Memory`). It opens on Gợi ý while a card waits, else
  on Sổ ghi nhớ; ←/→ and tab/shift+tab switch tabs, never while an entry is open or a delete is being
  confirmed. A form opened from `/memory` goes back there when it is saved or closed.
- `/goiy` is removed: cards no longer take the keys in the transcript; they say "/memory để lưu hoặc bỏ qua".

### Removed

- The `calculate` and `compute` tools. In the v4.6u benchmark the loop guard stopped `calculate` 31 times in 16 trials
  (13 requests per trial against 3.8, 6 of 15 failed trials); here their description and schema took 3.6k
  characters each.
  Native tool descriptions and schemas shrink from 39.9k to 32.7k characters; always-declared ones by 1.9k.
  `financial-source.ts` and `finance-policy.ts` (benchmark path) stay; `calculate/units.ts` moved to `tools/units.ts`.

### Fixed

- The stop gate no longer takes an offer that waits on the user or on a source for a broken promise (13/11,
  eval m3: "Bạn vui lòng … cung cấp giá đóng cửa …, mình sẽ tính toán ngay giúp bạn" was sent back, cost one
  more request and showed two answers). The last sentence is an offer when the user gives something first
  ("bạn … cung cấp / gửi / nhập / cho mình biết") or a named source comes back ("khi nguồn hoạt động lại"),
  before or after "mình sẽ", or when it starts with "nếu bạn…". Waiting on the model ("Bạn chờ chút, mình sẽ
  lấy giá", "Sau khi nạp tool, mình sẽ…") is still sent back.
- Every source failed and the model answered empty (13/11, eval m3/m6): the stop gate no longer asks it to
  "answer from the tool results" when none brought data. It names the failed sources and asks for an answer
  about what is missing, tools off then on; the answer-only rescue runs only when some tool returned data. Out
  of recoveries, the harness writes the answer itself: the sources it lacked and no figure (`unanswered` stays
  true; `done.fallback`, eval `fallback: true`), instead of "(không có câu trả lời)".
- Harness markup in the answer: a model that copies `<nhac_nho>` (or another harness tag), writes a tool call as
  text (`<todo_write>{…}</todo_write>`, `<tool_call>`, `<function=…>`) or wraps notes in `<thought>` no longer
  shows it. It leaves the stream, `ot -p`, evals and the history (`src/core/loop/markup.ts`); a step made only
  of it counts as empty, so the stop gate sends the model back. Code and a tag named in prose stay. Seen 05/11,
  08/11 and 13/11 with gemini-3.1-flash-lite (13/11: the whole answer was a self-made todo list in `<nhac_nho>`).
- `/luandiem` or `/quyetdinh` without a code: typing the code and Enter now opens that subject's form (the
  request was merged into the open one and the form never changed).

## [0.4.0] — 2026-11-08

The `--yolo` bypass mode and the headless `ot -p` for benchmarks, the unit-checked `calculate` tool, the notebook
memory (v5.1), every MCP result kept per session, and dependency updates. Update with `ot update` (npm:
`npm i -g @findahuman/opentrading@latest`).

### Added

- `calculate`, a core built-in tool (never deferred): a calculator with units.
  - It evaluates an expression (`+ - * / ^`, brackets, `sqrt abs min max sum avg ln log10 exp`) over named values.
  - Each value carries a unit (`nghìn đồng/cổ phiếu`, `tỷ đồng`, `cổ phiếu`, `%`, `lần`…) or is read straight from a ref, with the unit the data server publishes.
  - Adding across dimensions, or converting into a unit of another dimension, is an error rather than a wrong number. Magnitudes (nghìn, triệu, tỷ, nghìn tỷ) convert.
  - The expression is parsed by hand, never run as code. The result gets a ref like a data result.
  - Data figures typed into the expression get a warning.
- `prompts/tools.md`: no mental arithmetic. Every computed figure comes from `calculate` (or `compute` for whole series by ref), with a unit for each value.

- `ot --yolo` (alias `--dangerously-skip-permissions`): the `▸▸▸ bỏ qua quyền` mode.
  - Nothing asks and no classifier request is sent.
  - Deny rules, ask rules, blocked calls and the user-only scopes (key files, `.git`/`.opentrading`/`.ssh`, network paths, outside the workspace, the loop guard) still stop or ask. With no UI attached, those calls are refused.
  - Every launch shows a red warning first; its default answer is "Không, thoát". The answer is never saved.
  - Only the flag turns the mode on: config and resume cannot. With the flag, Shift+Tab includes `▸▸▸`.
- `ot -p "câu hỏi"` (or the question on stdin): one turn through the TUI's agent loop with no UI, saved as a session.
  - `--model provider/model` picks the model; `--output-format json` prints one result object; `--yolo` runs in bypass.
  - Calls that would ask are refused. A folder's own skills/agents load only if the folder is already trusted.
  - Exit code is 0 with an answer, 1 otherwise.
- `scripts/eval/run.ts --memory notebook|none` (required): `notebook` gives each question an empty notebook (guide in the prompt, `memory_read`), and the trace header records `memory`.
- `scripts/eval/run.ts --yolo` runs the eval in bypass instead of the narrow unattended list; the trace header records `permission_mode`.

- Suggestion cards: the model may end an answer with a `<the_goi_y>` block proposing a constraint, a
  presentation style or a lesson. The block never reaches history or the screen (hidden while it streams);
  a valid one becomes a card under the answer. A constraint or style card must quote the user's own words
  of that turn. Enter opens the spec-003 form filled in, `x` dismisses, `/goiy` picks a pending card again.
  Nothing is stored until the user confirms the form (source "card"). Cards are `card` lines in the
  session file and come back on resume; the next turn tells the model what became of each. Switch:
  "Cho phép thẻ gợi ý" in `/config`; never for tier C models, sub-agents or the headless CLI.
- The notebook guide tells the model to answer without saved memory when the user asks to ignore it.

- Memory blocks are tracked and masked through the session history (`src/core/memory/notebook/history-blocks.ts`,
  `src/core/memory/redaction/`). The notebook decides what to inject from the history each turn is sent with
  (`MemoryContext.history`), not from RAM, so a restart, a resumed session or a dropped turn never repeats or
  misses a block. Deleting a thesis or lesson masks its blocks in the open conversation, on resume, in
  `/export` and in `session_get`, and appends a `redact` line to the session file; no saved line is changed.
  A line is written only when `memory.db` is readable and confirms the item deleted; a missing or unreadable
  store, or a block whose content differs from the store, is masked in what is sent only, with a notice.
  `turn_end` lines carry the turn number, and resume counts on from the file. `memory_read` answers with one
  sentence pointing at the block's label when that version is in view (`ToolContext.messages`). Delete
  notices say "deleted from the app" and that the copy sent to the provider cannot be recalled.

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

- Every MCP result, from any server, is kept in full in `<session>/evidence/results.jsonl`, up to
  64 MiB per session and for as long as the session is. A `[ref rN]` now outlives a restart and
  the 40 most recent results.
- `read_result` reads a saved result as it was fetched. Compaction now points old data results to
  it instead of telling the model to fetch them again, which could return other numbers.
- `compute` does fixed arithmetic on fetched results by ref (returns, means, TTM, relative
  strength, ranks), so the model stops doing it by hand. Its result has a ref of its own.

### Changed

- Compaction never sees memory content: every memory block in the part summarized is cut down to its label,
  and the summary request carries no memory guide, notebook index or constraint block (they are sent again
  with every request). Both summary templates keep "Ràng buộc và sở thích" and say to cite memory by label.
  The first turn after each compaction tells the model, and the index is rendered afresh.
- The legacy memory ("Memory cũ": `FileMemory`, the `propose_memory` tool, the "Ghi nhớ: …" hook) is
  removed. A config naming it is read as the notebook; the TUI writes it back and says so once; the old
  `memory/` folder is left untouched. `MemoryProvider` drops `pending`, `approve`, `reject`, `list`, `remove`.

- Each turn with tools records figures that no result held, in the session and the eval trace.
  Nothing is sent back to the model yet: the check first has to prove its precision.
- A long MCP table is cut by rows, not characters: it stays valid JSON with every key and its
  first and latest rows, and says how many rows went and where to read them.
- The source line after a data server's result names the provider and, when the server gives it,
  how far the data goes, so an answer can cite them.

- Subagents no longer get the session history tools (`session_list`, `session_get`); the main agent
  keeps them and quotes what a task needs.
- `/profile` writes a template whose examples are comments. What goes to the model from
  `INVESTOR.md` leaves out comments, lines equal to an example of the old template (an edited one is
  kept) and empty sections, and is escaped so no text can close its block. A profile that is only
  headings and comments sends nothing.
- The notebook no longer lists the constraints in its own system part (they have their own block);
  the `/nho` form no longer says sub-agents do not get them.

### Fixed

- A memory block is masked for good (a `redact` line) only when `memory.db` still holds the item's or version's
  row marked deleted. A store that does not know the item (re-created empty, a session folder copied to another
  machine, an old backup restored) only masks it in what is sent, so restoring the store brings it back.
- The notebook sizes its injected blocks and its index to the tier of the model the turn goes to
  (`MemoryContext.tier`), not to the smallest tier for every model. The thesis form warns when a thesis is too
  long to be injected. An index over its budget drops the oldest entries first, so the newest stay in view.
- The index is pinned per session: saving, editing or changing the state of an entry no longer changes the
  context part of every request (no cache miss); a new entry is announced once in that turn's reminder. It is
  rendered again only when one of its entries is deleted or the model tier changes.
- After a restart or a resumed session, the subjects in focus are rebuilt from the user's typed turns in the
  history, so a follow-up question keeps the subjects of the turns before it.
- The "Dùng N memory" notice names items shortly ("HPG bản 3, bài học #7 bản 2", `MemoryItem.title`).
- "Mở lại phiên … · N lượt" counts the session file's turns, as `/save` and `/export` do.

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

- Stop gate: a figure in a compact JSON array counts as known, and "tính từ đầu năm" no longer
  reads as the model's own arithmetic.
- `desk-eval.ts` can read pages again: its approval responder never ran, so every `web_fetch` to
  a new domain was refused. Expect more requests than its estimate, because `web_fetch` calls a
  side model.
- The `co-ban` agent prompt no longer carries a real HPG divestment figure, which could leak
  into answers. `skill-routing-live-eval.ts` calls a model only with `--yes`.
- Stop gate: an answer that claims fetched data (a tool name, `Nguồn:`, "đã lấy dữ liệu") with
  figures the conversation does not hold, in a turn where no data tool ran, is sent back once
  with tools on. If the retry does the same, the answer stays and the user is told its figures
  are unverified.

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
