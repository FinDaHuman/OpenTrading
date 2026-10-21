# PR #116: review resolution and verification

Baseline: `51cacf46c1efe7bf14ba9acc094aab351e131218`. This ledger maps the findings in the accepted implementation plan to changes and checks; it does not imply that GitHub threads have been resolved.

| Review finding | Implemented resolution | Verification |
| --- | --- | --- |
| Cycle/sector collisions and overly broad triggers | Optional `triggers.exclude_keywords` blocks both keyword and soft suggestions using the same accent folding and word boundaries; explicit loading remains possible. Keep the scoring corpus stable. Narrow the thirteen sector trigger sets and add cycle intent triggers. | Schema/backward compatibility, boundary/accent, soft scoring stability and explicit-load tests; exact-set regressions Q278–Q291 and all-sector cycle cases. |
| Finance, commodity-price, standalone-brand and Fed/tariff misroutes | Remove broad trigger terms and preserve positive sector, NIM/CASA, insurance and SOTP queries. | Exact-set regressions include all nine reported examples, Fed/tariffs, and positive controls. |
| Bank KPI names and NIM denominator | Separate gross/net interest income, use matching-period average earning assets, and never invent NIM or CAR from an unavailable denominator. | Reviewed source paths, formulas, period requirements and missing-data branches in banking skill/reference. |
| `peer_compare` assumed to return arbitrary operating KPIs | Restrict overview comparisons to supported fields; operating KPIs come from each company's statements or disclosures for matching periods. | Review all thirteen sector skills and references against the tool catalog. |
| Steel commodity coverage | Remove mandatory `yf_commodities`; obtain iron ore, coking coal and steel references with explicit period/unit/product, or report gross margin separately from spreads. | Steel tool requirements and favorable/adverse/missing-data tree paths. |
| Retail company news used a market-news tool | Use company-specific news/events or company-source search for openings and disclosures. | Retail instructions and tool names checked against catalog. |
| Vingroup index influence without matching weights | Separate market-cap share, index weight and point contribution; require matching index, period and source. | Vingroup index-contribution preconditions and missing-data conclusion. |
| Insurance life/non-life conflation | Branch by business first; define loss/combined ratios, reinsurance basis and investment yield with comparable periods. | Insurance framework and KPI/reference review. |
| Flat tariff assumption and fixed margin thresholds | Query current origin/product/destination/exemption/effective-date rules; require current margin regulation instead of a frozen threshold. | Source requirements in trade/securities skill and references; no fixed current-policy claim. |
| Incomplete/misleading decision trees | All thirteen trees distinguish favorable, adverse and unknown data; terminal stars end the path. Correct transport, power, steel, retail, oil, securities and import-equipment inferences. | Tree lint with positive/negative fixtures; manual semantic review of paths. Structural lint alone cannot establish financial correctness. |
| Catalog truncation and unsupported evaluation claims | Budgets A/B/C = 2600/1200/280; full A catalog has at least 20% estimated headroom, B retains shortened descriptions, C all names. Add a bounded opt-in live evaluator. | Real catalog checks, offline evaluation and separately recorded harness/catalog-only LLM smoke runs. |
| Missing case ID 276 | Retain stable case IDs; reject duplicates instead of requiring continuity. | Routing fixture validation. |

## Verification record

Offline verification: **634 tests pass** outside the sandbox, including **32 focused tests**; typecheck is clean and skill-scan has no findings. Sandbox-only MCP demo failures were environmental and were verified outside the sandbox. Offline routing gets **83/87** expected-skill hits, with **20** surplus suggestions and **4** negative cases still suggested; existing regression thresholds are unchanged. The fourteen new regression cases require exact suggestion sets.

Catalog inspection: **41** auto skill names in every tier; A **1882/2600** estimated tokens with **27.6%** headroom, B **1042/1200** with shortened descriptions, C **253/280** with names only. These use the application estimator, not the provider tokenizer.

| Live run | Tier A | Tier B | Total | Selection mismatch | Missing required tool call | Timeout |
| --- | --- | --- | --- | --- | --- | --- |
| Harness (catalog + deterministic reminders) | 3/10 | 3/10 | **6/20 pass** | 7 | 3 | 4 |
| Catalog only | 1/3 | 1/3 | **2/6 pass** | 2 | 2 | 0 |

The bounded live smoke **did not pass**. The model added sector skills to cycle questions, chose property/asset-cycle skills for the apartment-vs-deposit case, and selected only Vingroup for the SOTP case where the exact expected set also includes valuation. Bank/NIM/CASA and non-life-insurance positive controls passed. Missing-call errors and timeouts remain distinct from observed wrong selections; all count as failed requests, with no retries or success reinterpretation.

Artifacts: [harness trace](pr116/live-harness.json), [catalog-only trace](pr116/live-catalog.json), [machine-readable counts](pr116/summary.json). Recorded usage is 72,728 tokens for harness requests returning usage and 21,870 for catalog-only; errors may consume tokens without returning usage, so these are incomplete usage totals, not a spend estimate. Live evidence records exact prompts, model/options, commit and diff/payload/evaluator hashes, selected tools, usage, timing and failures. It tests routing behavior only; no financial/data tools are executed, and it does not validate financial-answer factual quality.

See [routing evaluation instructions](skill-routing.md) for reproduction commands and limitations.

### Snapshot provenance

Live runs started at `2026-10-21T07:03:06.309Z` (catalog-only) and `2026-10-21T07:03:12.891Z` (harness), both at 14:03 Asia/Bangkok with model `nvidia/z-ai/glm-5.3-flash`, temperature 0, retries 0, output limit 1024 tokens and 45-second request timeout. Their source diff SHA256 is `274282127a6c949d47e6a44ec928a46f3898de59e39b059916ea4c1c17241590`; baseline commit and exact evaluator/payload hashes are inside each JSON artifact.

After launch, a narrow trigger `kỹ thuật định giá` and Q1 regression restored the pre-existing comprehensive-FPT route lost to corpus drift. A final dry-run comparison found no changes to any of the twenty live-case system prompts or user payloads after normalizing only the session clock minute; catalog rendering and live-case reminder selections were unchanged. That later checked diff hash was `303dec792eb3a103bf93533887c17980fa6c3cc7da63b844f77a8e1fff53f019`. The live JSON retains the original snapshot rather than falsely claiming to have run against a later diff.

NVIDIA required network escalation after the initial sandbox DNS failure; live artifacts use the successful external-network runs. Evidence was checked against the configured API key and contains no occurrence of it. No credentials or provider connection configuration are published.

These results apply to the recorded model, prompt and bounded budget. Extra selected skills are observed set mismatches; missing required tool calls are protocol failures, and timeouts are separate incomplete requests. They are not evidence that a financial answer is factually wrong or that every production model/budget behaves the same.
