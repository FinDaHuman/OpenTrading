# Contributing

## Development workflow

1. Create a short-lived branch from the current default branch.
2. Write or update the contract before changing an adapter boundary.
3. Add focused tests for observable behavior and failure states.
4. Run the complete local quality gate.
5. Open a small pull request that explains the trigger, resulting behavior, and validation.

```shell
uv sync --extra dev
uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run pytest --cov
uv run python scripts/check_docs.py
uv run python scripts/check_secrets.py
uv build
uv run python scripts/smoke_wheel.py
```

Install local hooks only if desired: `uv run pre-commit install`. Hooks are a convenience;
CI is the source of truth.

## Review rules

- At least one reviewer is required for changes to contracts, permissions, evidence handling,
  authentication, or future execution boundaries.
- New network adapters require contract tests for timeouts, authentication failure, rate limits,
  malformed payloads, stale data, and partial results.
- Dependencies need a concrete use case, active maintenance, compatible terms, and an owner.
- Never catch a broad exception and return an empty or successful financial result.
- Avoid generic `utils.py` or `manager.py` modules. Name modules after one responsibility.

See [engineering standards](handbook/engineering/coding-standards.md) and the
[definition of done](handbook/testing/test-strategy.md).
