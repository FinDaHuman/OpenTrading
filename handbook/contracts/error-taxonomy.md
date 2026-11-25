# Error taxonomy

> **Historical.** This page was written for the first Python design (ADR 0001, now superseded); its
> `errors.py` is no longer in the repository. What errors must preserve and what may be retried still
> holds. Today request retries are in `src/core/retry.ts` and MCP errors in `src/core/mcp/errors.ts`.

Use stable error codes. UI copy may vary while code and retryability remain stable.

Authentication and permission failures are not retryable without user action. Rate limits may be
retryable when the server supplies a bounded delay. Timeouts and upstream unavailability may be
retried within the run budget. Malformed upstream data is not retried automatically. Cancellation is
a normal terminal outcome, not an internal failure.

Errors must preserve which source and operation failed without exposing URL credentials, tokens,
headers, prompt content, or sensitive response bodies.
