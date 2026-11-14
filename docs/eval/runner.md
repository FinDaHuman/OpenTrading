# Eval runner

`scripts/eval/run.ts` sends a question set through the real agent loop, with no TUI, and writes a JSONL trace. It spends provider quota, so it calls a model only with `--yes`. It never runs in CI.

```sh
# Prints the question count and a request estimate, then exits. Needs no key.
bun scripts/eval/run.ts --questions scripts/eval/example-questions.json --model google/gemini-3.1-flash-lite --memory none
# Real run.
bun scripts/eval/run.ts --questions set.json --model provider/model --memory notebook --repeat 3 --out trace.jsonl --yes
```

Each question has an `id`, a `group` (A–F), the `question`, and `now`, the moment it is asked at, with a UTC offset.

## What a run isolates

- A temporary home holds only `auth.json`, the MCP files and the model catalog, plus a `config.json` naming the model. The investor profile, the user's memory and user skills stay out.
- `--memory notebook|none` is required, like `--model`. `notebook` opens an empty notebook in the run's home before each question: the memory guide goes into the system prompt and `memory_read` is offered, and nothing a question leaves in it reaches the next. Suggestion cards stay off. `none` is the product default. The header records `memory`, and so do the `settings`. Since memory changes the prompt and the tools, record a baseline per setting and never compare across them. The home is deleted at the end, because it holds a copy of the keys.
- The working folder is empty, so project skills, agents and `.mcp.json` do not apply.
- `now` reaches the prompt's date, `current_time` and subagents. Web tools still use the real date.
- Refs are cleared before each question, and each question starts with no history.
- `web_fetch` and `web_search` are removed for groups A–E, because recorded MCP data does not cover the web. Group F keeps them.
- Without a connected MCP tool the run stops before any model request.
- Approvals: nobody watches, so by default only `web_fetch` is answered "once" (approvals.ts) and every other call that asks is refused. `--yolo` runs in ▸▸▸ bypass instead: no prompt, no classifier request, and what bypass still keeps for the user is refused. The header records `permission_mode`. Bypass also declares the write tools in full, so the prompt is not the same as a run without it: do not compare traces across the two.
- OpenRouter: the provider behind a model id is not fixed unless the run pins it. `--or-provider a,b` sets `order`, `--or-no-fallback` sets `allow_fallbacks: false`, and `--or-quant fp8` sets `quantizations`, written into the run's `config.json` for the measured model only, never copied from the user's config. The flags stop the run for a non-OpenRouter model, and the estimate warns when the pin is missing or still allows fallback. The header's `settings` records `openrouter_routing`, each `answer` records `served_by` (steps per upstream provider, subagents included), and the run ends with the totals. See `docs/openrouter.md`.
- `ot -p` is the same loop for runners that drive several harnesses alike. Unlike this script, it uses the real home (memory, constraints, rules, sessions), so a benchmark should point `OPENTRADING_HOME` at a clean home.

## Trace

`scripts/eval/trace.ts` defines the format. One `run` line opens the file, then each question writes `question`, its events, and one `answer`.

`tool_result.visible` is what the model saw, after notices and the output cap. `tool_raw.raw` is what the tool returned. Use `visible` to ask whether the model invented a figure, and `raw` to check a figure against the data. Subagent calls have only `tool_raw`, with `agent` set. `raw` is taken before date normalization, so it can hold `/Date(ms)/` where `visible` shows an ISO date.

`answer.text` is the answer the harness kept. `answer.markup_stripped` names the harness tags the loop took out of the turn's text (a step it dropped included), when there were any. `answer.fallback: true` means the model gave no answer after every recovery while sources failed, and the harness wrote the answer: the missing sources, no figure. `answer.streamed` is everything the user saw, including a draft the stop gate sent back.

## Shell commands

A `tool_result` of the `shell` tool also carries `shell: { route, exec_ms }`: what became of the command.

| `route` | Meaning |
|---|---|
| `math` | Ran as an arithmetic-only command, with no approval. |
| `read-only` | Ran, and the command only lists or prints state. |
| `approved` | Ran any other command (bypass, a rule). |
| `near-miss` | Refused as arithmetic in a form the grammar does not take, with the form to use. |
| `denied` | Needed an approval nobody could give, or was blocked. |
| `error` | Never started for another reason. |

`exec_ms` is the run time the tool itself reports, without the approval wait. The header's `settings.shell` names the shell of the machine (`bash`, `sh`, `pwsh`, `powershell`): it decides which arithmetic form runs unasked, so compare runs per shell.

```sh
# Counts for one trace: commands per route, attempts where nothing ran, answers that say "tự tính",
# requests per attempt, time per command, typed operands found in what the model had read.
bun scripts/dev/shell-metrics.ts trace.jsonl [--untraced] [--out metrics.json]
# Recorded commands against the grammar alone: run unasked, refused with a hint, or sent to the gate.
bun scripts/dev/shell-replay.ts test/fixtures/shell-commands.jsonl [--ask]
```

- Both read files only: no model, no key.
- The operand count covers `math` and `near-miss` commands. Small counts and unit factors (1, 2, 12, 100, 250, powers of ten…) are skipped. An operand is traced when the question or an earlier result of the attempt holds it, at a common scale (×100, ×1000…): a decimal may be the source rounded as typed, an integer must be the number itself. Denials, errors and the shell's own status line are not sources. Untraced does not mean invented: list them with `--untraced` and read them. A command the gate denied is not counted, so the rate of a run where many arithmetic commands were denied covers fewer commands than a run where they were refused as near misses.
- `scripts/eval/questions/compute.json` is a set of 12 arithmetic questions that carry their own data, with labels, for measuring the shell path without depending on a data source.
- `test/fixtures/shell-commands.jsonl` is a provisional replay set written from the command forms of issue #268, one JSON object per line (`shell`, `command`, `form`).

## Fixed data

`--mcp-record tape.jsonl` keeps each MCP answer. A request already in the file is answered from it, so the first answer stays and a second run only adds what is new. `--mcp-replay tape.jsonl` uses the file alone and never reaches the server.

- A failed call, or an envelope that is `unavailable` and retryable, is passed on but not kept: an outage must not become the data.
- A request the tape does not hold fails as a tool error starting with `[replay]`, so it shows in the trace. The run also prints how many there were. A model free to change its arguments can reach these, so record with the model you will replay with, and treat the count as part of the result.
- The tape holds MCP results only, no tokens. It keeps the day it was recorded on: `now` in a question does not change the data.

## Ablation

`--ablate a,b` runs without those parts, and the header's `settings.ablate` records it. A name that does not exist stops the run. No config reaches these switches, so a user's run always has every part.

| Name | Without it |
|---|---|
| `gate-empty`, `gate-length`, `gate-malformed`, `gate-promise`, `gate-unfetched`, `gate-fragment` | That stop-gate rule never sends the model back. An empty or malformed answer ends the turn unanswered. |
| `strip-echoes` | Echoed todo lines stay in the saved messages. The gate's own reading of an answer still strips them. |
| `strip-markup` | Harness markup (`<nhac_nho>`, tool calls written as text, `<thought>` notes; see `src/core/loop/markup.ts`) stays in the stream and the saved messages. The gate's own reading of an answer still strips it. |
| `tool-nudge`, `todo-nudge` | The reminder after tool results, or only its open-todo part. |
| `failure-nudge` | The reminder about failed tools. The stop after a long failure streak stays. |
| `skill-hints` | The per-question skill suggestion. The catalog stays. |
| `citations-prompt` | The citation rules in the system prompt. |
| `skills` | No skills and no `load_skill`. |
| `todo` | No `todo_write`. |
| `tool-deferral` | `toolSearch: off`: every tool is declared, up to the 128-tool cap. |

`identity.md` and `style.md` have no switch, so `citations-prompt,skills` removes the citation rules and the skills, not every domain instruction. Every run also goes without the investor profile, while the thesis's "same domain instructions" baseline adds it: decide how to compare the two before reporting that row. `answerAfterTools` has no switch: it reshapes past turns, and every question here is a first turn.

## Request cap

Every model request is counted at the provider's fetch and added to `<home>/usage/YYYY-MM-DD.json`, by the `provider/model` it went to, in the real home. `--max-requests` (default 500) is a cap for the `--model` model for the day, across runs; a side model on another provider is booked under its own name and does not spend it. The run stops before the next question at the cap, and a question that reaches it mid-way is aborted; a `stopped` line records it. The ledger counts only eval runs, not requests made in the TUI, and the day is the local day, while a provider's quota may reset at another hour.

## Scoring

`scripts/eval/score.ts` scores a trace in code, offline. It uses no model, so a score is repeatable.

```sh
bun scripts/eval/score.ts trace.jsonl --labels set.json --against other.jsonl --out score.json
```

Labels sit beside each question in the same file, as `expected`; the runner never sends them. Group F has no label: a report needs human rubric scoring.

| `kind` | Correct when |
|---|---|
| `number` | A figure equals `value` (plain units, so `2.5e9` for "2,5 tỷ") within `tolerance_pct`. Without `line_has` this means only that the answer contains the value, which a table can do by chance. With it, only lines holding that text count, such as a date. |
| `order` | `items` appear in this order. |
| `contains` | One of `any` appears. |
| `no_figures` | The answer states no figure. For data that does not exist: an unpublished period, an unknown ticker. Not for "nên mua không", where scenarios with fetched figures are the right answer. |

| Measure | How it is read |
|---|---|
| Correct | The label holds. A failed turn is wrong. Without a label there is no verdict. |
| Untraced | Figures that are not marked as computed and are in nothing the model received: tool output as it saw it, subagent tool output, the question. Share per question. |
| Cited | The answer has a `Nguồn:` line or a tool name. Only answers with figures count. |
| Wrong unit | A price in thousand dong, per `units`, written as dong: "62,2 đ". A scale check cannot see this. |
| Cost | Requests, tokens and seconds per attempt. |

- Intervals are 95% bootstrap over questions, because repeats of a question are not independent. They are seeded, so a trace always gives the same interval.
- `--against` pairs two traces on questions, with the majority of repeats as each verdict, and gives an exact McNemar p.
- An attempt stopped by the request cap or by a killed run is counted as unscored. An attempt that timed out is wrong, and the report counts them: a harness that hangs on hard questions must not gain from it.
- A figure counts as traced at scales of 100 and powers of 1000, so "24,1%" matches `0.241` and a wrong figure can match by chance; a factor of 10 is not accepted. Untraced is a lower bound on invention, and a traced figure can still be the wrong one, which is what Correct is for.

The reader refuses a trace of another version or with a broken line. A new optional field needs no new version; removing or renaming a field does, and `test/fixtures/eval/trace-v1.jsonl` fails until it is done on purpose.

## Limits

- `answer.requests` counts HTTP requests to a model, with retries, subagents and side calls. `model_steps` counts finished steps only. Tokens of side calls are not in the trace.
- The runner does not compact. A question that outgrows the context fails and is traced as failed.
- Nobody approves anything: `web_fetch` is allowed once per call, because a gate with no UI would refuse every new domain, and everything else that asks is refused (`scripts/eval/approvals.ts`). This is a list, not "read-only": `read_file` also asks, for paths outside the workspace. A refusal is in the trace.
