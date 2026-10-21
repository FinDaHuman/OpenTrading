# Architecture

## Shape

The product begins as a modular monolith. A single process and package are easier to debug,
package, and evolve for a local user. Module boundaries preserve a future web interface without
introducing a server now.

```mermaid
flowchart TD
    CLI[CLI] --> APP[Application use cases]
    TUI[TUI] --> APP
    WEB[Future local web] -.-> APP
    APP --> RUNTIME[Agent runtime]
    APP --> DOMAIN[Domain models]
    RUNTIME --> CONTRACTS[Shared contracts]
    RUNTIME --> PORTS[Ports]
    BOOT[Bootstrap] --> APP
    BOOT --> PROVIDERS[LLM provider adapters]
    BOOT --> DATA[Internal data API adapters]
    BOOT --> STORE[Local session adapter]
    PROVIDERS -. implement .-> PORTS
    DATA -. implement .-> PORTS
    STORE -. implement .-> PORTS
    PROVIDERS --> LLM[Approved LLM APIs]
    DATA --> MCP[Market-data MCP servers]
```

Dependency direction is enforced: interfaces depend on application/bootstrap; application and
runtime use contracts, domain types, and ports; adapters implement ports; bootstrap selects concrete
adapters. Shared contracts and domain code never import UI, HTTP, database, or provider SDK modules.

## Trust boundaries

The local process, configuration, remote providers, internal APIs, and future MCP servers are
separate trust zones. News, API fields, tool output, and model output are untrusted data. Only code
policy can authorize a tool. Credentials are resolved immediately before adapter calls and are
redacted before an event or error is persisted.

## One research run

```mermaid
sequenceDiagram
    participant U as User interface
    participant A as Application
    participant R as Runtime
    participant P as Policy
    participant D as Data adapter
    participant L as LLM adapter
    U->>A: RunRequest
    A->>R: start with budgets and cancellation
    R->>L: model request with visible tool schemas
    L-->>R: streamed tool call
    R->>P: authorize typed call
    P-->>R: allow or deny
    R->>D: bounded read request
    D-->>R: canonical data plus provenance
    R->>L: bounded tool result
    L-->>R: report draft
    R->>R: validate evidence references and budgets
    R-->>U: ordered events and outcome
```

## Operational invariants

- Every accepted state change becomes an ordered event before another model step depends on it.
- Cancellation stops new tool dispatch, drains or terminates started work, and records the outcome.
- Parallel calls are limited and allowed only for tools declared safe to overlap.
- Retries are bounded, apply only to retryable failures, and respect the original budget.
- A replay reads stored results and never contacts an upstream service.
- Context compaction references durable originals; summaries cannot erase provenance.
