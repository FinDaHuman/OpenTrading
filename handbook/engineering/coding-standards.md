# Coding standards

## Boundaries and names

Public functions and port implementations are fully typed. Avoid `Any` in domain and port models;
use `object` plus validation at an untyped boundary. Keep modules focused on one responsibility.
Infrastructure imports remain in adapters and bootstrap. Imports must not perform network, filesystem,
credential, or database work.

## Async and failure handling

Network and provider ports are asynchronous. Propagate cancellation; do not shield arbitrary work.
Every I/O operation has a timeout. Retry only an idempotent operation with a retryable error, bounded
attempts, and remaining budget. Convert upstream errors once at the adapter boundary. Never catch a
broad exception to produce empty data or a successful response.

## Financial data

Use `Decimal` where an exact financial value crosses the domain. Preserve upstream precision and
units. Never infer missing data, score meaning, causal impact, or market-open state. Centralize
Vietnam exchange-calendar logic behind a versioned calendar interface when it is introduced.

## Configuration and logging

Configuration comes from typed settings and explicit files, never hidden constants. No production
URL is the default. Structured logs use correlation IDs and event names. Redact secrets before
serialization and avoid logging complete prompt, news body, portfolio, or provider payload by default.

## Code review limits

Prefer small patches and composition over inheritance. New dependencies need an owner and reason.
Generated files identify their generator. Comments explain constraints and decisions, not syntax.
