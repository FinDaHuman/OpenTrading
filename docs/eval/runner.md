# Eval runner

`scripts/eval/run.ts` sends a question set through the real agent loop, with no TUI, and writes a JSONL trace. It spends provider quota, so it calls a model only with `--yes`. It never runs in CI.

```sh
# Prints the question count and a request estimate, then exits. Needs no key.
bun scripts/eval/run.ts --questions scripts/eval/example-questions.json --model google/gemini-3.1-flash-lite
# Real run.
bun scripts/eval/run.ts --questions set.json --model provider/model --repeat 3 --out trace.jsonl --yes
```

Each question has an `id`, a `group` (A–F), the `question`, and `now`, the moment it is asked at, with a UTC offset.

## What a run isolates

- A temporary home holds only `auth.json`, the MCP files and the model catalog, plus a `config.json` naming the model. The investor profile, memory and user skills stay out. The home is deleted at the end, because it holds a copy of the keys.
- The working folder is empty, so project skills, agents and `.mcp.json` do not apply.
- `now` reaches the prompt's date, `current_time` and subagents. Web tools still use the real date.
- Refs are cleared before each question, and each question starts with no history.
- `web_fetch` and `web_search` are removed for groups A–E, because recorded MCP data does not cover the web. Group F keeps them.
- Without a connected MCP tool the run stops before any model request.

## Trace

`scripts/eval/trace.ts` defines the format. One `run` line opens the file, then each question writes `question`, its events, and one `answer`.

`tool_result.visible` is what the model saw, after notices and the output cap. `tool_raw.raw` is what the tool returned. Use `visible` to ask whether the model invented a figure, and `raw` to check a figure against the data. Subagent calls have only `tool_raw`, with `agent` set. `raw` is taken before date normalization, so it can hold `/Date(ms)/` where `visible` shows an ISO date.

`answer.text` is the answer the harness kept. `answer.streamed` is everything the user saw, including a draft the stop gate sent back.

## Limits

- `model_steps` counts finished model steps. Retries and side calls (web side model, classifier) are not in it.
- The runner does not compact. A question that outgrows the context fails and is traced as failed.
- Nobody approves anything: `web_fetch` is allowed once per call, because a gate with no UI would refuse every new domain, and everything else that asks is refused (`scripts/eval/approvals.ts`). This is a list, not "read-only": `read_file` also asks, for paths outside the workspace. A refusal is in the trace.
