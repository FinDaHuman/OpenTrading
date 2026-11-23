# Failure threshold evaluation — 23 November 2026

This is synthetic test data, not market data. The MCP fixture returns VCB P/E 8.4 and ROE 19.1% for 2025; BID returns an MCP `isError` response. Each row ran in a fresh process at commit `4db9eed`, with a hard cap of 10 model HTTP requests and no request-budget summary step. `questions.json`, the six JSONL traces and `summary.json` preserve the inputs and observed output. The second request in one 3.1 run was retried after a provider 503.

| Model | Nudge / stop / breaker | Requests | Observed outcome |
| --- | --- | ---: | --- |
| Gemini 3.1 Flash-Lite | 4 / 8 / 3 | 2 | VCB values correct; BID missing stated |
| Gemini 3.1 Flash-Lite | 2 / 8 / 3 | 3 | VCB values correct; BID missing stated |
| Gemini 3.1 Flash-Lite | 2 / 4 / 3 | 2 | VCB values correct; BID missing stated |
| Gemini 2.5 Flash-Lite | 4 / 8 / 3 | 1 | Provider 404; no tool call |
| Gemini 2.5 Flash-Lite | 2 / 8 / 3 | 1 | Provider 404; no tool call |
| Gemini 2.5 Flash-Lite | 2 / 4 / 3 | 1 | Provider 404; no tool call |

All three successful runs called both tools in the same step. Because that step contained a success, its failure streak was zero; none reached a nudge or stop threshold. Gemini 2.5 was unavailable to this key, so its three runs cannot be compared. These results do not establish which threshold is better. The production defaults remain 4/8/3; further comparison needs an available second model and a scenario that actually reaches the thresholds.

To repeat, set `GOOGLE_GENERATIVE_AI_API_KEY` in the environment and run `bun scripts/eval/failure-sweep.ts --yes`. The script can send up to 60 model requests and writes its evidence path to stdout. Results and provider availability can change.
