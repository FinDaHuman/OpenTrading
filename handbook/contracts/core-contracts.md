# Core contracts

The Python types in `contracts`, `domain`, `ports`, and `runtime` are the executable starting point.
This page defines semantics that type checking alone cannot express.

## Time, identity, and units

All datetimes crossing a real adapter are timezone-aware. Preserve source time, publication time,
observation time, retrieval time, and model-generation time as distinct fields. Symbols are canonical
uppercase identifiers, but symbol alone never identifies asset class, venue, or a futures contract.
Prices require a declared `PriceUnit`; adapters convert units only through documented, tested rules.

A future is either a specific contract with `contract_code` or a continuous series. These states are
mutually exclusive. An equity or index cannot carry futures identity.

## Availability envelopes

`DataPage`, `CandleSeries`, and `MarketSnapshot` carry availability, provenance, warnings, and data.
`empty` means a successful query found no records. `unavailable` means the capability or source could
not answer. `stale` means records violate the capability's freshness policy. `partial` means a stated
subset remains usable. Empty/unavailable envelopes cannot contain records; available/stale/partial
envelopes must contain records. None becomes zero, a neutral signal, or a complete report.

## Provider stream

A provider emits a discriminated union of ordered events for text, complete tool calls, usage,
finish, and errors. Each variant contains its required fields: a finish without a reason and an error
without a stable code are invalid. Model IDs and capabilities belong to adapter configuration. The
runtime checks capability requirements and never silently switches model or provider.

Provider requests use typed messages and tool descriptions. An assistant message can preserve one or
more complete tool calls, including call ID, name, and arguments; each following tool result refers to
the corresponding call ID. This conversation shape supports deterministic multi-step replay without
reconstructing provider-specific wire data. Provider-specific payloads remain inside adapters.

## Tools

Tool results form a discriminated success/failure union. A success cannot contain an error; a failure
cannot omit stable code, safe message, and retryability. Invalid arguments fail before dispatch. An
HTTP 200 payload containing an upstream error maps to failure. Each spec declares permission,
schemas, timeout, result-size limit, and concurrency mode.

## Reports and evidence

A report embeds its evidence index. Every claim has identity, kind, content, and evidence references.
Every calculation has identity, method/version, named inputs, result, units, and evidence. Validation
rejects duplicate identities and references to unknown evidence. A citation proves traceability; evals
must still determine whether the cited evidence supports the claim.

## Sessions and events

A session is created before its runs. Events carry schema version, event ID, session ID, run ID when
run-scoped, session-scoped sequence, time, kind, and JSON payload. The store atomically appends only
when `expected_previous_sequence` equals durable state. The caller transfers a payload snapshot and
must not mutate nested JSON after append. Database constraints enforce unique event, session, and run
IDs. Replay reads events in ascending sequence and never invokes an upstream service.

Each event kind has a registered payload model. The envelope retains JSON-compatible storage while
validation rejects missing, extra, or contradictory fields before append. Summary events contain the
source event sequences they compact, and terminal events contain a terminal state.

Run outcomes accept terminal states only. Startup converts durable queued/running runs left by a
previous process into interrupted runs before accepting new work. A resumed run stores
`resumed_from_run_id`; creation atomically verifies that the source run is interrupted and belongs to
the same session. A run cannot resume itself.

## Compatibility

Breaking public-model changes require an ADR and migration note. Additive optional fields are minor
changes. Event `schema_version` changes only with a replay/persistence migration. Adapters own
upstream version translation; canonical models do not mirror unstable payloads.
