# ADR 0003: Read-only tools and deterministic permissions

Status: accepted

## Decision

The initial registry accepts only reviewed read operations. Each tool declares a permission,
schemas, timeout, result limit, and concurrency mode. Code evaluates permissions before execution.

## Consequences

An upstream endpoint or function is not automatically safe because it uses HTTP GET or has a
read-like name. Tools are allowlisted from verified behavior. Prompt text, skills, memory, and model
output can never grant a permission. Trading requires a separate future architecture and review.
