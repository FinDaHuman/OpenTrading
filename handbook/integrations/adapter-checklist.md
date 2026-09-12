# Adapter implementation checklist

- Capture the upstream owner, version/snapshot, authentication, rate limit, and data terms.
- Document endpoint, parameters, response schema, pagination, timezone, currency, and units.
- Map explicit empty, partial, stale, unavailable, and error payloads.
- Use strict boundary validation and reject unknown semantics rather than guessing.
- Set connect/read/write/pool timeouts and bounded retry with jitter where appropriate.
- Honour cancellation and cap request and response sizes.
- Redact credentials and sensitive payloads from errors, logs, and session events.
- Write contract tests for 200 success, empty, HTTP error, error-in-200, malformed data, 401/403,
  429, timeout, cancellation, and upstream schema drift.
- Add the capability to the reviewed read-only allowlist only after its behavior is verified.
- Update the integration inventory and capability status.
