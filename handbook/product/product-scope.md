# Product scope

## Goal

Turn a user-selected LLM into a disciplined local research assistant for Vietnamese equities,
indices, and derivatives. It should collect approved evidence, expose freshness and gaps, explain
internal machine-learning signals, and help a user reason about a decision. It does not decide or
trade on the user's behalf.

## Initial users and journeys

One user runs one local installation with local settings and sessions. Initial journeys are:

1. Ask for a Vietnamese market overview.
2. Research an equity using price history, relevant news, and available internal signals.
3. Research VN30 futures while preserving the difference between a named contract and a
   continuous series such as VN30F1M.
4. Ask what a model signal means, including its horizon, timestamp, version, and limitations.
5. Inspect the evidence and freshness behind a generated explanation.

## Initial product boundary

Included in the design: CLI, TUI, local sessions, multiple LLM API providers, approved internal
data APIs, evidence-aware reports, explicit budgets, cancellation, and audit-friendly events.

Excluded: live or paper orders, portfolio accounting, backtests, autonomous monitoring, model
training, arbitrary code or shell execution, direct database access, multi-user hosting, and a web
interface. These exclusions are product boundaries rather than hidden backlog items.

## Success criteria for the first working runtime

- A user can configure one approved provider and one internal API without exposing credentials.
- One research request streams progress and a final report through both CLI and TUI.
- Every material claim maps to captured evidence with source and time metadata.
- Empty, partial, stale, unavailable, authentication, rate-limit, and timeout states remain distinct.
- A user can cancel a run and resume a persisted session after restart.
- Cost, token, tool-call, step, and wall-time limits stop execution predictably.
- No tool can place an order, mutate upstream data, or obtain a permission from prompt content.
