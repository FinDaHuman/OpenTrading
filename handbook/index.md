# Engineering handbook

This handbook is the durable source of truth for product intent, architecture, contracts,
integration assumptions, engineering workflow, testing, and delivery order.

## Reading paths

**New contributor:** [product scope](product/product-scope.md) →
[architecture](architecture/architecture.md) →
[coding standards](engineering/coding-standards.md) →
[test strategy](testing/test-strategy.md).

**Adapter author:** [core contracts](contracts/core-contracts.md) →
[internal APIs](integrations/internal-apis.md) →
[adapter checklist](integrations/adapter-checklist.md).

**Runtime author:** [agent runtime](architecture/agent-runtime.md) →
[runtime policies](contracts/runtime-policies.md) →
[session/event ADR](architecture/adr/0004-session-event-model.md) →
[extension ADR](architecture/adr/0005-extension-boundaries.md) → `evals/`.

**Interface author:** [CLI and TUI contract](interfaces/cli-tui.md) → application contract →
relevant use case.

**Reviewer:** capability status in the root README → relevant contract →
[definition of done](testing/test-strategy.md).

## Documentation rules

For design provenance, read [harness inspirations and implementation traceability](research/harness-lessons.md).
It distinguishes observed mechanisms, executable contracts, planned runtime behavior, and internal API references.

- Use English for documents, identifiers, comments, and user-interface text.
- Mark capabilities as `implemented`, `specified`, or `deferred`.
- Record durable architectural trade-offs as ADRs; do not use ADRs for routine code changes.
- Link source evidence and state its snapshot or version. Separate observed facts from proposals.
- Update the integration inventory after upstream contracts are verified.
