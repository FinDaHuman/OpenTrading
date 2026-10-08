# Security policy

This scaffold does not accept security reports through a public channel yet. Report suspected
issues privately to the repository owners and do not include credentials or personal data.

Secrets belong in environment variables or a future credential store. They must not be stored
in repository files, prompts, session events, logs, fixtures, or error messages. Market news,
API payloads, model output, and tool output are untrusted input. They cannot grant permissions
or override deterministic policy.

The initial product is read-only research software. Any broker or order-execution feature
requires a separate threat model, legal review, approval design, reconciliation model, and
release decision.
