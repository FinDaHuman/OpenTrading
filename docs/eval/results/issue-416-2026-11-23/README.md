# Failure threshold evaluation — 23 November 2026

This is synthetic test data, not market data. The MCP fixture returns VCB P/E 8.4 and ROE 19.1% for 2025; BID returns an MCP `isError` response. Each row ran in a fresh process, with a hard cap of 10 model HTTP requests and no request-budget summary step. The initial runs used commit `4db9eed`; the replacement Gemini 3.5 runs used `37bb1c7` after incorporating the #417 breaker fix. The traces identify the tested commit. One 3.1 request was retried after a provider 503.

| Model | Nudge / stop / breaker | Requests | Observed outcome |
| --- | --- | ---: | --- |
| Gemini 3.1 Flash-Lite | 4 / 8 / 3 | 2 | VCB values correct; BID missing stated |
| Gemini 3.1 Flash-Lite | 2 / 8 / 3 | 3 | VCB values correct; BID missing stated |
| Gemini 3.1 Flash-Lite | 2 / 4 / 3 | 2 | VCB values correct; BID missing stated |
| Gemini 2.5 Flash-Lite | 4 / 8 / 3 | 1 | Provider 404; no tool call |
| Gemini 2.5 Flash-Lite | 2 / 8 / 3 | 1 | Provider 404; no tool call |
| Gemini 2.5 Flash-Lite | 2 / 4 / 3 | 1 | Provider 404; no tool call |
| Gemini 3.5 Flash-Lite | 4 / 8 / 3 | 2 | VCB values correct; BID missing stated |
| Gemini 3.5 Flash-Lite | 2 / 8 / 3 | 2 | VCB values correct; BID missing stated |
| Gemini 3.5 Flash-Lite | 2 / 4 / 3 | 3 | VCB values correct; BID missing stated |

In the six successful runs, the step calling both sources contained a success, so the maximum all-failure streak was zero. No nudge or stop threshold was reached. Gemini 2.5 was unavailable to this key, so its three runs cannot be compared.

## Late-recovery follow-up

The [`late-recovery`](late-recovery/) traces use commit `b2072d6`. Both sources initially return `isError`: VCB would succeed on its third call; BID continues to fail. The question asks the model to retry transient errors. Four fresh processes compared 4/8/3 with 2/4/3, one per model and configuration. Both 2/4/3 runs reached the nudge at two consecutive failed steps. Neither model made a third VCB call, and both reported both sources missing. No run reached the stop threshold. Gemini 3.1 used 3 and 3 requests; Gemini 3.5 used 3 and 4, respectively. The initial and follow-up runs together used 30 of the 60 allowed requests.

Each model/configuration has one sample per scenario, and the earlier scenario used two related code revisions. The data does not establish which threshold is better or whether one causes a recovery. Production defaults remain 4/8/3. A larger, controlled evaluation is needed before changing them.

To repeat, set `GOOGLE_GENERATIVE_AI_API_KEY` in the environment and run `bun scripts/eval/failure-sweep.ts --model gemini-3.5-flash-lite --yes`. Add `--late-recovery --compare-only` for the follow-up. A single-model run can send up to 30 requests, or 20 with `--compare-only`; the script writes its evidence path to stdout. Results and provider availability can change.
