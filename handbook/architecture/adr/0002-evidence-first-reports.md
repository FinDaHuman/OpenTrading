# ADR 0002: Evidence-first reports

Status: accepted

## Decision

Canonical source data and provenance are stored before model interpretation. Reports separate facts,
calculations, interpretation, evidence references, and limitations. Missing inputs are explicit.

## Consequences

Adapters require more metadata and report validation can reject a fluent but unsupported answer.
This is necessary for financial research where freshness, units, and source conflicts materially
change meaning.
