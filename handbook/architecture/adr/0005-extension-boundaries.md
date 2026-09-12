# ADR 0005: Extensions remain subordinate to policy

Status: accepted

## Decision

Skills, future MCP servers, memory, and future child agents enter through explicit adapters and
manifests. They declare capabilities and required permissions but cannot grant permissions. The
single-agent runtime remains the baseline until measurements justify another topology.

## Consequences

A skill is versioned prompt/workflow content rather than authority. MCP tools pass through the common
registry and policy. Memory records provenance, retention, and user controls. Child work shares the
parent budget and permission set. These surfaces evolve without changing domain models or interfaces.
