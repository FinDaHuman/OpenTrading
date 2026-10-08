# Developer workflow

## Setup

Install Bun, then run `bun install` and `bun run dev`. Windows PowerShell and a POSIX shell are supported.

## Adding a tool

1. Define the user need and canonical output contract.
2. Verify upstream behavior and complete the adapter checklist.
3. Implement the gateway operation without exposing the raw payload to the runtime.
4. Define one `ToolSpec` with narrow permission, timeout, result limit, and schemas.
5. Add deterministic policy and contract tests, then document capability status.

Example: `market_candles` accepts canonical symbol, interval, and bounded limit. Its adapter returns a
`CandleSeries`, including availability, price unit, timezone-aware observations, provenance, and
warnings. The tool spec requests `market:read`; policy checks that permission before dispatch. HTTP
payload fields never become the tool's public output schema.

## Adding a provider

Implement `ModelProvider` behind a provider-specific module. Normalize streaming, complete tool calls,
usage, finish reasons, errors, and cancellation. Maintain a tested capability catalogue and reject
unsupported combinations. Do not assume a consumer subscription grants third-party API access.

The provider contract test feeds recorded synthetic chunks through the adapter and asserts the exact
common event sequence, cancellation, usage, finish reason, malformed chunk behavior, and secret
redaction. Use the fake provider only for application tests; it is not proof that a real adapter
conforms.

## Changing a contract

Update executable models, handbook semantics, fixtures, contract tests, capability status, and any
persistence migration. Write an ADR for a breaking architectural decision. The pull request must state
which recorded or upstream versions remain compatible.

## Troubleshooting

- Invalid `.env`: run `opentrading doctor`; it performs no remote requests.
- Import-boundary failure: move infrastructure behavior to an adapter and assemble it in bootstrap.
- Empty market response: preserve `empty`; inspect source calendar/freshness before treating it as an
  outage.
- Provider streams text where a tool call was expected: check capability and adapter normalization;
  do not parse a tool call from arbitrary prose.
