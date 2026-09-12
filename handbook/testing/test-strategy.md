# Test strategy and definition of done

Tests protect contracts and product risks rather than mirror implementation.

- **Unit:** validation, pure policy, budgeting, evidence mapping, and error conversion.
- **Contract:** each provider/data/storage adapter against sanitized fixtures and fake servers.
- **Architecture:** import direction and side-effect-free imports.
- **Smoke:** installed CLI/TUI lifecycle and package artifacts.
- **Evaluations:** report grounding, freshness, uncertainty, prompt injection resistance, and useful
  explanations. Evals complement deterministic tests and never replace them.

A change is done when relevant tests pass on supported platforms, documentation and capability status
match behavior, no secret/licensed payload is committed, error states remain explicit, and build
artifacts install successfully. Skipped placeholders do not count as validation.

CI runs lint, format check, strict typing, tests with branch coverage, documentation links, a
high-confidence secret scan, package build, and clean wheel-install smoke test on Windows and Linux.
A future runtime release must add end-to-end tests for timeout,
cancellation, budget exhaustion, interrupted-session recovery, provider stream errors, conflicting
sources, and citation validation.
