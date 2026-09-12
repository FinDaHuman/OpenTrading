# Internal API integration inventory

Status: source discovery snapshot, not a live API guarantee. Verify deployed OpenAPI, authentication,
sample payloads, rate limits, data rights, and freshness before writing an adapter.

Source snapshots inspected:

- Trading_Agents commit `0ff70a638713e4eef788cd2f9efa3d9835378255`, with one untracked review
  document excluded from inspection; [upstream](https://github.com/DoanDuyLong212/Trading_Agents).
- DongAnhCapital commit `fd6d136c94a29c33273ed3184ce230c9135b485c`, clean at inspection;
  [upstream](https://github.com/FinDaHuman/donganhcapital).

## Capability inventory

| Capability | Candidate endpoint | Observed source | Known request/shape | Required verification |
| --- | --- | --- | --- | --- |
| Instruments | DongAnhCapital `GET /api/stocks` | `backend/main.py:875` | `{count, stocks}` wrapper | Auth, canonical venue/asset identity |
| Market snapshot | DongAnhCapital `GET /api/market-status` | `backend/main.py:883` | Cached upstream result | Fields, units, observation time, empty/error |
| VNINDEX series | DongAnhCapital `GET /api/vnindex?limit=` | `backend/main.py:890` | Array; `Date` serialized to ISO | Price unit, timezone, max limit, freshness |
| Equity OHLC | DongAnhCapital `GET /api/ohlc/{stock_id}?limit=` | `backend/main.py:1171` | `Date/Open/High/Low/Close/Volume` | Auth, corporate adjustments, units |
| OHLC history | Trading_Agents `GET /api/ohlcv/history?symbol=&days=` | `backend/dashboard/server.py:590` | `time/open/high/low/close/volume` | Error-in-200 behavior, units, adjustment |
| AI signals | DongAnhCapital `GET /api/ai-signals` | `backend/main.py:912` | Verified-account gate observed | Score semantics, horizon, model version |
| Forecast | DongAnhCapital `GET /api/predict/{stock_id}` | `backend/main.py:1203` | History plus forecast | VN30F1M branch had empty forecast; per-symbol behavior |
| VN30 futures | Trading_Agents `GET /api/vn30f1m` | `backend/dashboard/server.py:702` | Fetcher-owned payload | Contract identity, source rights, session times |
| News/macro | Trading_Agents dashboard endpoints | `backend/dashboard/server.py` | Multiple heterogeneous endpoints | Pagination, license, publication/update time |
| Tool catalogue | Custom `GET /tools/list`, `POST /tools/call` | `backend/mcp/server.py:30,40` | Reflection-derived schema | Do not expose until auth, schema, and allowlist review |

The Trading_Agents tool service observed here is custom HTTP rather than standard MCP. Name a future
adapter `TradingAgentsToolHttpClient`. Standard MCP is a separate adapter and conformance effort.

## Canonical mapping rules

Implement `DongAnhCapitalHttpGateway` and `TradingAgentsHttpGateway` separately. Do not import their
source or query databases. Each endpoint mapping declares source fields, canonical fields, timezone,
price unit, adjustment policy, freshness threshold, empty/error behavior, and contract fixture hash.

For overlapping capabilities, configuration selects a primary source. A fallback is explicit and
emits an event. Comparison keeps sources separate and reports conflicts. Authentication is injected at
request time and redacted. Every request has connect/read/write/pool timeout, correlation ID,
response-size limit, cancellation, and source-specific rate policy.

## Gate before implementation

An inventory row becomes verified only when the deployed contract and a sanitized payload have been
captured, the owner confirms units/semantics and data rights, authentication and limits are recorded,
all adapter checklist cases pass, and the reviewed operation is added to the read-only allowlist.
