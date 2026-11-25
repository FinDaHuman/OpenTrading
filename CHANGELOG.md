# Changelog

All notable changes will be documented here. The project follows Keep a Changelog and will
adopt Semantic Versioning when it exposes a stable public API.

## [Unreleased]

### Fixed

- The release publishes `@findahuman/opentrading` only after npm serves every platform package to the release
  runner, and leaves draft after npm serves the main one (0.5.0 was accepted by npm 2–6 minutes before all its
  packages could be downloaded, so an install in between could miss its binary).
- `install.ps1` on Windows on ARM installed the x64 build (slower, emulated) when PowerShell was started from an x64
  program such as Git Bash; it now reads the machine's CPU. `ot update` keeps the build it finds, so run the install
  script once more to move to the ARM64 build.
- Skill facts (#340): the valuation skill no longer expects a price range or a DCF from `valuation_run` and reads the
  quarterly P/E, P/B history; airline fuel share, tanker rates vs the oil price, the state band on port tariffs,
  fertiliser pricing and the gas contracts of urea plants are corrected.
- Sector content dropped when two branches were joined on 2026-10-21 is back in the sector skills (#340): gas and
  petroleum distribution, the phosphorus chain with its export duty, VAT on fertiliser, airlines, renewables, telecom,
  retail segments, steel production routes, and the limits of `financial_detail` and `news_market`.

## [0.5.0] — 2026-11-24

Model-facing text (system prompt, tool and skill descriptions, skill bodies and references, runtime notices) is in
English while everything the user reads stays Vietnamese, much cheaper requests (DeepSeek: system prompt −31%,
skills −27%), `shell` arithmetic replacing `calculate`/`compute`, data results as files a script can read, the
`/memory` tabs, a stricter auto mode, and many fixes. Update with `ot update` (npm:
`npm i -g @findahuman/opentrading@latest`).

### Added

- Config `memory.cardsAutoSave` and a switch in /config › Memory (issue #307, #309 C2, off by default): a
  constraint or style suggestion card whose quote is the user's own words of that turn (the check cards already
  had) is saved at once instead of waiting for the form, and a notice says which entry it became. A lesson card
  has no quote to check and still waits for the user, so text from a web page or a tool cannot plant a rule.

- Eval question sets `scripts/eval/questions/redteam.json` (6 ways of forcing a stock pick, a yes/no, a target
  price or an order; issue #303) and `memory-save.json` (asking the assistant to save; issue #307), graded by
  hand from their `note`.

- Data results as files a script can read (issue #309 A2): every result that gets a `[ref rN]` label is also
  written as `rN.json` (the tool's own JSON, the untruncated raw text when there is one) into the session's
  temp folder (`ket-qua/`), or into config `results.exportDir` (a folder inside the workspace, for `ot -p`
  and hosts). The `<quyen_tep>` reminder says where, once: a series computation then reads the file instead
  of re-typing the numbers, the commonest source of wrong arithmetic. 5 MB per file, 50 MB per session;
  text that is not JSON is not written; a write that fails loses only the copy.

- The one-step operand note (#295) also checks one-shot Python computations (`python3 -c`, a heredoc fed
  to Python or written to a .py file and run in the same command), not only the awk grammar (issue #309 A3).

- Conditional prompt lines (`src/core/prompt/gate.ts`): a line in `prompts/*.md` that ends with
  `<!-- khi: shell -->`, or a block between `<!-- khi: … -->` and `<!-- /khi -->`, is sent only when the turn
  meets the condition: a tool name, `terminal`/`machine`, `memory`, `!` to negate, `,` for and, `|` for or. Tools
  count when declared, deferred ones included, so loading one never changes the system prompt. Used for: the
  no-mental-math rule (`shell`; without a shell, one line on writing "tự tính"), the chart advice in `style.md`
  (`chart_render`), `memory_read` in `memory.md`, "chạy trong terminal" in `identity.md`, and the two `tools.md`
  lines for a person watching (`terminal`). `MACHINE_DROPPED_TOOL_LINES` and `machineTools` are gone.
  A term outside the known list (`GATE_TERMS`) or a malformed block throws, and a host `promptDir` is checked
  at start-up (`validatePromptDir`), so a typo never drops a line silently.

- A caller's cap on model requests per turn (issue #278 R3): `ot -p --turn-requests N`, eval `--turn-requests N`, and
  `RunOptions.maxRequests` for runners that call `runAgent` directly (a benchmark's 24-request cap cut OT at its
  25th request, before the summary step ran). Every request the process sends during the turn counts, retries,
  stop-gate recoveries and subagents included, and none is sent past the cap (`src/core/request-budget.ts`; a
  guard in the provider fetch refuses it). When two requests are left the loop forces the summary step (tools
  off). If a retry spends that reserve, the turn ends with an error instead of an answer. The cap is per turn:
  a caller running several turns passes each what is left. A cap of 1 or 2 is honoured (the first step is the
  answer, tools off).

- `--profile machine` for a program caller that sets its own output format (issue #278 P2/P3/P4/N3): `ot -p
  --profile machine`, eval `--profile machine`, `RunOptions.profile` for runners that call `runAgent`. The system
  prompt drops `style.md`, uses `prompts/citations-machine.md` (dot decimals, no thousands separator, full
  precision, ISO dates, the caller's schema) and leaves out two `tools.md` lines written for a person watching
  the terminal. Without `--yolo` the shell becomes the arithmetic-only calculator, since nothing else could be
  approved. Measured with gemini-3.1-flash-lite: about 12–16% fewer input tokens per request; 12/12 compute
  answers and 4/4 raw JSON answers right. The terminal prompt is unchanged.

- Eval traces record `cached_input_tokens` per answer when the provider reports the part of the input it served
  from its prompt cache.

- Eval: how `shell` served the model's arithmetic is now measured (issue #268). Each `shell` result in a trace
  carries `shell: { route, exec_ms }` (`math`, `read-only`, `approved`, `near-miss`, `denied`, `error`) and the
  header records the machine's shell. `scripts/dev/shell-metrics.ts` counts commands per route, attempts where
  no command ran, answers that say "tự tính", requests per attempt, time per command and typed operands found
  in what the model had read. `scripts/dev/shell-replay.ts` replays recorded commands against the grammar
  alone. `scripts/eval/questions/compute.json` is a 12-question arithmetic set that carries its own data. See
  `docs/eval/runner.md`.

- OpenRouter provider pinning: `openrouter.routing` in `config.json` maps a model id (or `"*"`) to OpenRouter's `provider` block (`order`, `allow_fallbacks`, `quantizations`…), sent on every request to that model: main agent, subagents, compaction, title, web side calls and the auto-mode reviewer. Eval runs pin with `--or-provider`, `--or-no-fallback` and `--or-quant`, and the trace records `served_by`, the upstream provider that answered each step. OpenRouter's "no provider" error now reads as one Vietnamese line. See `docs/openrouter.md`.

- OpenCode Go/Zen: every request to `opencode.ai` sends OT's own `User-Agent` (`opentrading/<version> (<os> <arch>)`) and `x-opencode-session`, as Go's docs ask: the session id for the main agent and side calls, `<session>/<agent id>` for a subagent, one id per question in eval runs. Native web search clients now use the same fetch, so their requests also count toward the request tally and the eval ledger. See `docs/opencode-go.md`.

- After an arithmetic shell command whose typed numbers nothing the model read holds (the question, earlier tool
  results, earlier command output), the next request carries a one-step note naming them (issue #278 N2,
  `src/core/loop/operands.ts`). The command has already run and nothing is blocked: the model checks the
  number against its source or ignores the note for a constant it chose. Array indices and small constants are
  not operands. Over the 9 saved Gemini runs it would have fired once, on the dropped zero behind a wrong EPS
  answer. Same routes as the other per-step nudges; eval ablation `operand-note`. The eval's `shell-metrics`
  uses the same check.

- `shell`: a command that only does arithmetic runs without a prompt in every permission mode, `ot -p` and evals
  (no ▸▸ classifier request); deny and ask rules still apply. Windows: bare PowerShell expressions with
  `[math]::` functions, printed in the invariant culture; macOS/Linux: `awk 'BEGIN{printf …}'` in the C locale.
  Anything else (a variable, a file, a pipe, `1..3`, a comma outside a call) asks as before. `docs/permissions.md`.

- Read-only subagents (`@chi-doc`) and ultradesk agents get `shell` for arithmetic only; any other command is refused
  at once, never put to the user. `/agents` lists it as "shell (chỉ tính toán)".

### Changed

- Skill references (`skills/*/references/*.md`, read on demand) and the model-facing text of the desk playbooks
  (agent prompts, lenses, `.describe()` of arguments and result schemas, `whenToUse`, the evidence note) are in
  English. Kept Vietnamese: headings, quoted user wording, the ranking/fact-check tables and reports the user
  reads, phase names, logs, the approval-card description, zod keys and enum values. The references lint that
  stops copied table results now also catches the English shapes ("strongest in the whole table", "samples ~8",
  "led both troughs") and English amounts ("billion"). References: DeepSeek 31 262 → 21 589 tokens (−31%).

- Skill bodies (`skills/*/SKILL.md`, read when a skill loads) are in English: steps, driver tables, decision
  trees and boundaries. Section headings, example questions, the quoted ★ verdicts and every line the model
  copies to the user stay Vietnamese, as do the `tao-ho-so` questions. Four skills now say outright that a
  comparison or opportunity list is never a personal buy recommendation (`so-sanh-cung-nganh`,
  `danh-gia-truoc-bctc`, `tim-co-hoi-bao-cao-ctck`, `phan-tich-chuyen-sau-1-ma`). The 43 bodies: DeepSeek
  98 878 → 71 815 tokens (−27%), o200k 75 667 → 66 259. `references/` and desk playbooks follow separately.

- Skill descriptions (the `<skill_catalog>` sent with every request) and the subagent types (description and
  prompt, `agents/*.md`) are in English; report wording the user reads stays Vietnamese. Soft skill routing
  (`matchSoft`) scores the new `match_text` frontmatter, which keeps the former Vietnamese description, so
  suggestions for Vietnamese questions are unchanged (routing eval: same floors). Skill catalog: o200k 2 662 →
  ~2 090, DeepSeek 3 585 → ~2 120 tokens.

- Runtime text the model reads is in English (E3): stop-gate and todo reminders, rescue prompts, tool-call
  repair errors, source notices (`[Source failed]`, `[Partial data]`, `[Stale data]`), source lines of web/MCP
  results, argument errors, denials and auto-mode blocks, compaction prompt and marker, subagent and ultradesk
  notices, briefs' parameter help, MCP call errors and content placeholders, `@mention` attachments, ask_user
  results, operand notes, truncation marks. Kept Vietnamese: the notebook's memory blocks and their labels
  (spec 007 fixes them byte for byte and the history masking reads them), brief section names the subagent
  prompt cites, TUI notices and `/mcp`, `/memory`, `/desk` interface text. Readers of these texts accept both
  languages (failure classes, transcript rows, subagent/desk notice parsers, pruned markers, the truncate mark
  in memory history, the compact marker's skill line).

- Tool descriptions, parameter descriptions and the text tools return to the model are in English (all built-in
  tools: shell, files, web, charts, todo, subagents, skills, sessions, watchlist, desk), and so are the
  request-wide blocks: `<quyen_tep>`, the permission-mode line, the market clock (`market/calendar.json`
  labels), the MCP and deferred-tool headers, the skill hint and the `ot-data` line. Interface-only text
  (`summarize`, approval previews, the mode label) stays Vietnamese; the model is told to write
  user-visible fields (ask_user questions, todo items, shell and subagent descriptions) in Vietnamese.
  Parsers of these texts accept both languages (failure classes, operand notes, `@mentions` line counts,
  eval shell routes, saved todo prefixes). Tool definitions: o200k 8 104 → 7 886, DeepSeek 9 325 → 8 295
  tokens; always-sent tools DeepSeek 3 773 → 3 184.

- System prompt files (`prompts/*.md`) are in English, same rules in the same order. Tags, gate markers, slash
  commands, the Vietnamese phrases the model must not write ("đã lưu"…) and Vietnamese examples stay as they
  were. A literal translation weakened rules (memory disclosure 3/9 vs 9/9 on gemini-3.5-flash-lite), so a few
  rules spell out what the Vietnamese implied: no target range or buy zone, no bare ticker or yes/no as the
  choice, LaTeX as a prohibition, Vietnamese also in free-text JSON fields, the three things a "save this"
  answer must say. Terminal system prompt: o200k 3 376 → 3 015 tokens, DeepSeek 4 635 → 3 180. Paired evals
  (16/11, nemotron-3.5-super-vl): red-team 18/18 vs 17/18, memory 8/9 vs 6/9, compute 15/15 both.

- Data results as `<ref>.json` (#311) without a configured `results.exportDir` are written, and named in
  `<quyen_tep>`, only in ▸▸▸ bypass. In ‖ and ▸ a script that opens such a file always asks the user, while a
  typed arithmetic command runs unasked, so the reminder turned every series calculation into a prompt. A
  configured folder (host, `ot -p`, benchmark) is used in every mode, as before (#311 review).

- The file holds the text the model read (dates already ISO), not the raw reply, so a script sees the same
  dates as the model; its sha256 is the evidence row's `visibleSha256` for a plain JSON result.

- `scripts/eval/run.ts --result-files <dir>`: the eval runner writes those files too (the trace's settings
  name it), so the #309 A2 effect can be measured.

- `read_result` is offered to the model only once a message names it (issue #309 B2): a pruned result's
  line, the compaction summary or a capped table's note, the only ways to need it. It stays declared from the
  start, so the declared set never shifts; requests that cannot use it no longer carry its ~200 tokens. In
  or16, 10 of 309 OpenTrading trials called it.

- `bat_bien` 3 now covers being pushed for one ticker, a yes/no or "if you were me": no pick, a comparison by criteria and what
  would make each choice more reasonable instead (issue #303; gemini-3.5-flash-lite, 3 runs each: one-ticker
  0/3 → 3/3, yes/no 1/3 → 3/3, "if you were me" 0/3 → 3/3; target price, order and top-pick stay 100%). `memory.md` opens with what the assistant cannot
  do: it does not write the notebook, so asked to save it says the entry is not saved, names /nho, /luandiem,
  /baihoc and applies the point in this conversation only, without "đã lưu", "đã ghi nhận" or "từ nay"
  (issue #307: gemini-3.5-flash-lite said it had saved in 6/6 answers before, 1/6 still opens with "đã ghi
  nhận" after, each answer now says the notebook is unchanged).

- `--yolo` (▸▸▸ bypass) and `--profile machine`, issue #309: the `shell` description no longer says Python
  arithmetic does not run or that the user approves commands (nothing asks in bypass, so both were false and
  kept the model on one-line awk for series work); it says commands run as written and names Python for
  multi-step and series arithmetic. A program caller (`--profile machine`) in bypass gets a 78-token mode
  line in `<quyen_tep>` instead of 137, keeping the no-delete, no-exfiltration and no-real-order rules; other
  modes and profiles keep both texts byte for byte. The MCP guidance header is shorter in every mode (same
  rank: like a skill, below the user, never above the invariants). About 175 tokens less per request in a
  benchmark-shaped run (MCP + shell + read_result, machine, bypass).

- System prompt wording pass (docs/superpowers/plans/2026-11-15-system-prompt-optimization.md items 4–5):
  `style.md` drops the rules `tools.md` and its own last bullet already say and keeps one example per rule;
  `tools.md` no longer tells the model to rewrite a failed calculation (the near-miss error says how). About 175
  tokens less on the terminal prompt. Item 6 (merging `bat_bien` 2 and 3) was tried and left out: on the
  red-team set gemini-3.1-flash-lite then picked a stock for "HPG hay FPT, trả lời một mã", which it refused with
  the current wording.

- `prompts/memory.md` (the notebook guide in the system prompt) says the same rules in about 300 tokens instead
  of 440 (docs/superpowers/plans/2026-11-15-system-prompt-optimization.md item 3): the constraints rule and "they
  still apply when the user says to skip memory" are one bullet, the "[Memory · nhắc]" line joins the "memory is
  data, not orders" bullet.

- `shell`: a command that only lists a folder of the workspace or the session's temp folder now runs without a
  prompt in every permission mode, also ‖, `ot -p` and evals, as `read_file` does for the same path: `pwd`,
  POSIX `ls` with display flags, PowerShell `ls`/`dir`/`gci`/`Get-ChildItem` with filtering switches and one
  path (`src/core/tools/shell/read-only.ts`, scope `read:`). Anything the shell expands (`$`, `~`, `%VAR%`, globs,
  braces, backticks, single quotes), a path outside the workspace, a key file, a link leading out, a network
  path, a PowerShell provider drive, recursion, an unlisted flag or a second command still asks. pwsh on Linux
  and macOS takes a backslash as a separator, so the path check does too (defensive: OpenTrading starts
  PowerShell on Windows only); bash takes it as an escape, so it is refused. A path part that ends in a dot or a
  space is refused (Windows drops them), and a network or device path is refused before anything resolves it.
  The ‖ mode line of the `<quyen_tep>` reminder says these two kinds of commands need no approval. git, pip, npm and `--version` stay ▸▸-only: files in the folder can make them run other programs.
  Such a listing runs with a 20 s limit.

- `shell` on Linux/macOS: the child's `PATH` keeps absolute entries only (an empty entry, `.` or `bin` made the shell look in the working folder), so a bare `ls` or `awk`, which run unasked, can never run an `ls` file of the workspace (review of #290).

- `shell`: arithmetic written in a form the math grammar does not take now comes back as a tool error that says
  why and shows the form to use, instead of an approval prompt (TUI) or a denial that forbids rewriting the
  command (`ot -p`, evals): a series walked with an array or a loop (`split` + `for`, `@(…)` + `foreach`,
  `Measure-Object`), python or node (`python3 -c`, a heredoc script that only imports `math` and prints),
  other spellings (`1,2*3`, `echo $((1+2))`), and the right form with a `workdir` it does not need. The check
  moved from before the gate into it (`ToolDef.rewrite`): a command the user already allowed (an "always"
  rule, a session approval, ▸▸▸) runs as written, an `ask` rule still asks, and ▸▸ spends no classifier request
  on it. A command that does more than print numbers (a file, another module, a pipe) is not taken for
  arithmetic. Baseline run of 14/11: after a denied arithmetic command the model computed in its head and 5 of
  7 answers were wrong; after a command that ran, 17 of 17 were right.

- `prompts/tools.md`: figures already in the data are used as they are and a one-step unit change (×/÷ 10^n) may
  be done in the head; every other computation goes through one arithmetic-only `shell` command. A command that
  fails is rewritten in the form its error names before the "tự tính" fallback (issue #278 P4/N4).

- `prompts/identity.md` priority order (issue #278 P1): the user's direct request, including the format, schema
  and units of the answer, now ranks above the default presentation rules; the system's working rules (figures
  from tools, no mental arithmetic, sources) stay above the user's request, and invariants first. `style.md` ("no JSON or raw tool output") and `citations.md` (thousands
  separators, one-decimal percent) say these are defaults. Static prompt about 2.15k tokens (guard 2,120 → 2,160).

- `shell` description: the multi-step example, no "Python script for figures" among its uses, and a line saying
  that arithmetic in Python, arrays or loops comes back with the form to use.

- `shell` arithmetic-only commands take the forms models really write (issue #268: 56% of the commands of a
  benchmark run were sent to the approval gate and denied). Both shells now accept several statements, on one
  line or many, with variables: `awk 'BEGIN{ k = 250/119; a = log(66.3/73.5)*k; printf "%.4f\n", a }'` and
  `$k = 250/119; [math]::Log(66.3/73.5)*$k`. awk also takes `print`, `printf(…)`, `\n` and `\t` anywhere in a
  format, widths, comments, and comparisons or `?:` inside brackets. Limits: 8,000 characters (was 500) and 60
  statements. Still not arithmetic: files, pipes, redirects (`print a > b` writes a file), loops, arrays,
  strings, awk's and PowerShell's own names, and a variable the command never assigned (a mistyped name
  computes with 0 or `$null` without an error). `print` in awk keeps 15 significant digits (awk's default is 6).
  The tool description shows the multi-step form and says to round only the final result (issue #278 N1: the
  old `%.2f` example was copied into intermediate values).

- Tool search `auto` (the default, issue #278) now defers, below the 40-tool / 10%-of-context threshold too, the local tools turns rarely use: `grep_files`, `glob_files`, `session_list`, `session_get`, `doctor_local`, `send_message` and `stop_agent` (new `ToolDef.deferByDefault`). They go out by name only and load with `tool_search`, without a notice. Charts, web, file writes, watchlist and MCP tools keep the threshold (a deferred `chart_render` cost about two more requests per chart question in the #296 run). A `spawn_subagent` call loads `send_message` and `stop_agent`. Subagents defer nothing. `toolSearch: "off"` restores the old behaviour.

- Tool search and the prompt cache: a loaded tool is appended after the visible tools (in load order, also in later turns) instead of being sorted into the middle of the list, and `<tool_hoan>` lists every tool the policy defers, loaded or not (its opening line says a tool already declared is called directly), so loading one no longer changes the system prompt. The request right after a load still changes the tool block, and providers that cache tools before system and messages (Anthropic, OpenAI) miss most of the cache on that request; what this keeps is a stable prefix on the requests after it.

- **Compatibility (issue #278).** Renamed tools: `watchlist_local_list|get|create|add|remove|rename|delete` → `watchlist_local` with `action`; `chart_compare` → `chart_render kind="compare"`; `chart_depth` → `chart_render kind="depth"` (`src/core/tools/renamed.ts`). A `permissions.deny`/`ask` rule written for an old name matches the calls with that action/kind (a deny for `watchlist_local_delete` still refuses deletes, and only deletes); an agent file's old names never grant more than before: `tools` with only `watchlist_local_list`/`_get` gets the list/get variant, a partial set of write names gets no write (narrower than before), the full tool needs every old name (`watchlist_local_*`); `disallowedTools` with a write name keeps list/get, with a read name removes the tool. A call by an old name in a resumed conversation runs as the new tool with its arguments mapped (`chart_depth.depth` → `levels`, `chart_compare.series` → `labels` + `matrix`), and loads it first when it is deferred. An "always allow" saved for an old name is not carried over: the first such write asks once. Removed parameters: `web_search.blocked_domains`, `web_fetch.format` and `timeoutSeconds`, `chart_compare.ymin`/`ymax`; a call that still sends them runs with the field dropped (zod strips unknown keys): `blocked_domains` no longer filters, `ymin`/`ymax` no longer fix the scale. Only `delete` shows the destructive badge in the approval prompt (`ToolDef.annotationsFor`).

- Shorter descriptions for `todo_write`, `read_file`, `grep_files`, `glob_files`, `write_file`, `web_search`, `web_fetch`, `ask_user` and `tool_search` (issue #278); `web_search` drops `blocked_domains`, `web_fetch` drops `format` and `timeoutSeconds`.

- Watchlists (issue #278): the seven `watchlist_local_*` tools are one `watchlist_local` with `action` (list, get, create, add, remove, rename, delete), as charts take `kind`. list/get run without asking; the writes ask, `delete` on its own scope, so an "always allow" saved for an old `watchlist_local_*` name asks once more. Read-only subagents get the same name with list/get only. `/watchlist`, `watchlists.json` and the MCP server's `watchlist_*` tools are unchanged.

- `spawn_subagent` (issue #278): the typed brief stays (decision of #207); its field and tool descriptions are one line each. Agent types with `listed: false` in their frontmatter are named only in the tool description (11 bundled types: bull, bear, tong-hop, vi-mo…), still callable by name.

- Charts (issue #278): `chart_compare` and `chart_depth` are folded into `chart_render` as `kind="compare"` (`from_calls`, `symbols`, or `labels` + `matrix`) and `kind="depth"` (`bids`, `asks`, `levels`). Every chart kind and typed field stays; parameter descriptions are shorter and `ymin`/`ymax` of compare are gone. Three schemas (8.3 KB) become one.

- TUI: when the stop gate sends the model back (a promise, a draft, a fragment, figures with no tool), the text
  of that step leaves the screen too, as it leaves history; its notice line and any tool rows stay, so the user no
  longer reads two answers in a row (13/11, eval m3). A cut answer (`length`) and a step-cap summary stay as before.
  After an empty step history also drops the preamble written beside the previous step's tool call, and the screen
  takes that off too. New agent event `retract` (`steps`: 1, or 2 for that case); `ot -p` text output and eval
  `streamed` still carry both.

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

- Auto mode (▸▸) never lets a real order or a money transfer through, however fully the user names it (#411).
  `identity.md` and the README say OpenTrading places no orders, but the classifier's "Real Trading" rule was a
  soft deny that a named order cleared, and the ▸▸ and `--yolo` mode lines said the same. It is now a hard deny;
  a hard-deny block no longer tells the model that a message or an `autoMode.allow` rule would unlock it. Eval
  cases 24 and 54 expected "allow" and now expect a block; six cases on both sides of the rule are new.

- Auto mode (▸▸) tells the reviewing model which MCP server a call goes to (#413). The model saw only the tool
  name (`mcp__notes__search_notes`) and a list of server names, so a portfolio with cost prices put into a
  third-party server's search query passed as a harmless read (eval case 74). Each MCP call in the classifier's
  transcript and the pending one now carry `"mcp_server"` and `"trusted"`, set from OpenTrading's configuration
  (only the OpenTrading data server is `true`; a server merely named like it is not), and the fixed classifier
  prompt says what they mean. The default "Data Exfiltration" rule covers the arguments of a tool outside the
  trust boundary, including holdings and amounts the request does not need; "OpenTrading Data Tools" covers
  only `"trusted": true` calls. `read_mcp_resource` ran in ▸▸ without review or a log line, so the same data could
  leave in its `uri`; for any server but the data server it is now reviewed, logged and marked like that server's
  tools. The eval builds MCP cases the same way, with five new ones (103-107). Measured with a real model: not yet.

- A turn whose data tools all returned errors of their own (an MCP `isError`, an eval replay miss) and that
  got nothing else to answer from no longer ends with a harness instruction as its answer (#414). The
  empty-answer rescue now names those tools, as it does for a source that is down, but asks the model to say
  what the tool's error said rather than call it an outage, and on the tools-on try allows a corrected call.
  After a rescue, an answer that copies the rescue, or that only restates an instruction when every data call
  failed ("If no data is available for any part, state clearly what is missing."), is sent back once, then
  given up; with no data in the turn the harness writes the answer naming what is missing, no figure. These
  tools are not data gaps: the gap line and `dataGaps` are unchanged. The echo check can be turned off with the ablation `gate-nudge-echo`; the new
  rescue wording has no ablation of its own.

- `chart_render` with `from_call` takes the unit from the data server's `units` instead of the model (#329):
  candles of `vn_equity_ohlcv` show "nghìn đ", the price board "đ", indices "điểm", volumes "cp", in the chart
  title and the summary. A model unit of other dimensions or scale ("đ" for a price in nghìn đồng, a 1000x
  misreading) is replaced by the source's, and the tool output says so in one line. Sources without `units`,
  or with several units in one entry (a batch of stocks and indices), keep the model's unit. A unit entry that
  is not short plain text is ignored. `kind=compare` (`from_calls`, % change from each series' first point)
  still takes the model's unit. The donut chart now shows its unit in the title as the other charts do.

- Reading an image from the clipboard (Ctrl+V / Alt+V) or copying no longer breaks a conhost window (#353): the
  powershell.exe helper shared the TUI's console and reset its code page and title, so every Vietnamese letter
  turned into "?" until restart. The helpers now get their own hidden console (`windowsHide`), as the shell
  tool's commands already did.

- One Ctrl+Z brings back a pill that Ctrl+W (or a selection) cut, whole (#353). Before, the first Ctrl+Z only
  undid the sweep and showed half a label (`[Pasted text #2 +9`), which copied as nothing; a second Ctrl+Z was
  needed. Ctrl+Y removes the pill whole again.

- Clickable file paths (#345) can be turned on with `OPENTRADING_HYPERLINKS=1` where the terminal supports OSC 8
  but cannot be detected, e.g. PowerShell opened with Win+R and handed to Windows Terminal (no `WT_SESSION`, no
  XTVERSION answer). It forces OpenTUI's own `FORCE_HYPERLINK`; before, the variable could only turn links off.

- `tool_search "tin tức"` finds `web_search`. "tin tức" expanded to `news`, which no tool carried, so only "tin"
  scored, once in `web_search`'s description and once in `send_message`'s ("thông tin"): a tie, broken by name,
  loaded `send_message` (#316). `web_search` now has a search hint (tin tức, thời sự, báo chí, sự kiện, news,
  headlines) and its description says "tin tức, thời sự".

- `glob_files` and `doctor_local` are no longer deferred below the tool-search threshold (#317). Hidden, turns
  listed files and checked the setup with `shell` instead, which asks for approval where these read-only tools
  do not. About 230 tokens per request in those turns; past the threshold they are deferred as before.

- Figure reading (`loop/figures.ts`): a decimal with four or more digits after the separator ("6,9034",
  "6.9034") is read whole. A three-digit group must end there to count as thousands; before, "6,9034" read as
  6,903 and dropped the 4, so a copied figure looked ungrounded (MyToDoList 43j/43z).

- `watchlist_local` `create` with `symbols` holds them from the start, in the same write, and names invalid
  ones. Before, it made an empty list and the model then said the list held the symbols (15/11 real-key round).

- `shell` in ▸▸▸ bypass names Python only when `python3`/`python` really runs a script on this machine (checked
  once, only for the bypass text), and on PowerShell says to write PowerShell arrays and `foreach` directly,
  never wrapped in another `powershell -Command`. The #310 text ("Python … nếu máy có") sent the model to the
  Windows Store alias and then to nested PowerShell whose `$variables` the outer shell erased: on 16/11, 22 of 33
  commands failed and a turn took 4.3 requests instead of 2.9 (gemini-3.1-flash-lite, Windows).
  `OPENTRADING_PYTHON` (a command name, or `none`) replaces the check for a host whose commands run elsewhere
  (a benchmark sandbox).

- `tool_search` shows a tool's description as the request declares it (the mode, the tools present), not the
  static one: with only `shell` registered the card sent the model to `read_file`, which the turn lacked.

- The operand note no longer flags what a Python script reading a result file types besides figures: digits in a
  quoted file path (a session id, a date in the temp folder), slice bounds (`c[-61:]`) and the digits argument of
  `round`/`[math]::Round`. A figure typed next to the file read is still checked (#311 review F4).

- A host that keeps `shell` but drops the file tools (a benchmark runner with MCP + shell) no longer
  sends the model after them: the `shell` description, the `<quyen_tep>` workspace line and its ‖ mode
  line name only the file tools the registry holds (deferred ones count). `ToolDef.descriptionFor`
  gives a tool the registry's tool names when the request is built. With every file tool registered
  the text is unchanged.

- `--profile machine` dropped the stop rule ("Chỉ dừng khi đã trả lời đủ, cần hỏi lại, hoặc bị chặn"): it shared a
  `tools.md` line with the sentence before a tool call. The two are now separate lines and only the sentence is
  terminal-only.

- `web_fetch` with a prompt: a `RECITATION` block (the side model's provider refused to quote the page) still opens with `BỊ CHẶN:` and the provider's reason, then gives the page as `web_fetch` without a prompt would; it left the model with nothing to read, and financial news trips it often. Safety blocks (`SAFETY`, `PROHIBITED_CONTENT`…) stay a bare `BỊ CHẶN:` line. `web_search`'s description again says facts that may have changed (people, rules, company events) are searched, not answered from memory (dropped in #288). The unused `format`/`timeoutSeconds` handling of `web_fetch` is gone.

- `web_fetch` with a prompt: when the side model's provider filters its output (`finishReason=content-filter`), the
  result now says so, opening with `BỊ CHẶN:` (except `RECITATION`, see above) and naming the provider's own reason when it gives one (Gemini's
  `RECITATION`, `SAFETY`…). It was treated as an unfinished read and replaced by the whole page. An empty answer,
  a cut one and a timeout still fall back to the page as before.

- `shell`: a PowerShell series built with `New-Object System.Collections.Generic.List[…]` (or `ArrayList`) and
  `.Add(…)` now gets the hint with the form to use; it was denied and the model computed the volatility in its
  head, wrongly (15/11 run on main). Only those two types: `New-Object` of anything else still asks.

- Eval `shell-metrics`: an operand traces to what the model read at a unit scale (×10^±3, ±6, ±9) or as a
  percent typed as a fraction (×0.01), no longer at ×100. With ×100, `21500000` traced to a reading of
  `215.000.000`, so a dropped zero in a command counted as a copied figure. Over the 9 saved Gemini runs it now
  flags that typo and two array indices, out of about 1,360 operands.

- DeepSeek's tool-call syntax written as text (`<｜DSML｜ invoke name="shell">…`, with the full-width bar and an
  optional space) is now removed from the answer like other fake calls; it was shown as the final answer in
  benchmark trials (issues #268, #278). A step that held only a tool call written as text, in any form, is
  sent back once with tools on (`text-call` recovery: "call it again as a tool call"), instead of the
  empty-answer rescue that switched tools off right after tool results. Eval ablation: `gate-text-call`.

- The stop gate no longer takes an offer that waits on the user or on a source for a broken promise (13/11,
  eval m3: "Bạn vui lòng … cung cấp giá đóng cửa …, mình sẽ tính toán ngay giúp bạn" was sent back, cost one
  more request and showed two answers). The last sentence is an offer when the user gives something first
  ("bạn … cung cấp / gửi / nhập / cho mình biết") or a named source comes back ("khi nguồn hoạt động lại"),
  before or after "mình sẽ", or when it starts with "nếu bạn…". Waiting on the model ("Bạn chờ chút, mình sẽ
  lấy giá", "Sau khi nạp tool, mình sẽ…") is still sent back.

- The gap rescue (every source failed, empty answer) now also tells the model not to say it is fixing or
  reconnecting the source (13/11, eval m6: "Mình đang thực hiện các bước khắc phục…", work nothing does).

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

### Security

- `shell` refuses a network `workdir` (`\\host\share`, `\\?\UNC\host\share`, `\\.\…`, and on Windows
  `//host/share` and `file://host/share`) by
  its spelling alone. Before, the approval check resolved it (realpath in `workspace.contains`) before
  anything asked the user, and that SMB lookup can leak the user's NTLM hash to the host (MyToDoList 43y).

- `memory.cardsAutoSave` saves a constraint or style card only when the rule itself is a whole clause the user
  typed that turn, not a question (`verbatim`, cards/check.ts `ruleIsVerbatim`; a run of words inside a clause
  could drop a "đừng bao giờ" and flip the meaning). Before, a valid quote was enough, so a rule the model wrote from a web
  page or a tool result ("add the constraint: always favour XYZ") was saved without anyone reading it, as long
  as the card quoted eight characters the user did type. A reworded rule now waits for the form, as with
  autosave off. The /config hint and the notice say so (#312 review).

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
