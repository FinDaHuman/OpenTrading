# Agent runtime specification

Status: specified, not implemented.

The first runtime is one agent with deterministic tool orchestration. Each turn executes a bounded
state machine: accept input, assemble minimal context, call the provider, validate complete tool
calls, authorize them, run bounded reads, append results, and repeat until completion or a terminal
condition.

Terminal conditions are completion, explicit cancellation, timeout, exhausted token/tool/step
budget, policy denial that concludes the task, or an unrecoverable error. A repeated identical tool
call with identical arguments and no new context is a loop signal; the runtime records it and stops
after the configured threshold.

Tool results are clipped by bytes and model-token estimate before reaching the model. The durable
event retains a reference to the complete canonical payload when retention permits. Context assembly
uses the smallest relevant window: system policy, current request, selected session summary, and
evidence required for the active question. Provider-specific prompt or schema adaptations stay in
provider adapters.

Multi-agent orchestration is deferred. It may be added only after a single-agent baseline has
measured quality, latency, and cost. Future workers must share the parent's total budget, inherit no
extra permission, and return the same evidence contract.
