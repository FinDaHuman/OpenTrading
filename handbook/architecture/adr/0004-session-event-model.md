# ADR 0004: Session-scoped event log

Status: accepted

## Decision

Persist immutable versioned events ordered by a monotonically increasing sequence within each
session. Events contain session and run identity. Create explicit session and run records before
appending run events. Storage uses compare-and-swap on the expected previous sequence. Every event
kind has a registered payload schema. Context summaries reference their source-event sequences.
Resume creates a separate run linked to an interrupted run in the same session.

## Consequences

One session contains multiple runs while replay remains deterministic. Concurrent writers receive a
conflict instead of silently reordering events. Event, run, and session identities require database
constraints. Payload-schema changes require migrations. Replay never invokes remote services. The
store validates a resume source and creates the new run atomically.
