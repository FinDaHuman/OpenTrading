# Runtime policies

Status: decision-complete specification for Milestones 1 and 2.

## Budgets

One `RunRequest` defines ceilings for steps, tool calls, input tokens, output tokens, and wall time.
Usage is cumulative across retries, compaction, and future child work. The runtime reserves capacity
before each call and refuses work that cannot fit. Provider usage reconciles estimates after each
response. Budget exhaustion records measured totals and ends the run with a stable non-retryable error.

## Cancellation and timeout

One cancellation signal is owned by the run and propagated to provider streams and tool adapters.
Cancellation prevents new dispatch. Started parallel reads receive cancellation and have five seconds
to settle; the adapter boundary terminates remaining work. The runtime records completed and skipped
calls, then emits one terminal cancelled event. Wall-time timeout follows the same cleanup path and
ends as a failed run.

## Retry

Only idempotent reads with retryable rate-limit, timeout, or unavailable errors may retry. Default is
three attempts with full-jitter delay capped at eight seconds and bounded by valid `Retry-After`.
Authentication, permission, validation, malformed data, cancellation, and policy denial never retry.
Attempts consume the original budget and each attempt is recorded.

## Ordering and parallel work

Event sequence increases within a session; append is compare-and-swap on expected previous sequence.
Model-visible tool results commit in model-call order even when safe reads overlap. An exclusive tool
is a barrier. Default maximum parallel calls is four.

## Repetition and termination

The runtime fingerprints tool name plus canonical JSON arguments. Three identical calls without new
user input or evidence terminate as failed. Provider finish, validated final report, user cancellation,
timeout, exhausted budget, unrecoverable error, or repetition are terminal.

## Context and recovery

Context order is stable: system policy, tool policy, selected session summary, current request, and
evidence required by the active step. Tool output is capped by `max_result_bytes` before provider
serialization. Compaction creates `context.summary.created` with the summary and referenced
source-event sequences. Startup marks queued/running runs interrupted. Explicit resume creates a new
run whose `resumed_from_run_id` references the interrupted run. The session store rejects missing,
non-interrupted, cross-session, and self-referential resume sources in the create transaction.
