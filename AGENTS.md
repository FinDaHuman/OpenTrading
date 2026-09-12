# Repository instructions for coding agents

Read `handbook/index.md`, `handbook/architecture/architecture.md`, and the relevant contract
before changing behavior. Treat the capability-status table in `README.md` as authoritative:
never present a specified or deferred capability as implemented.

Keep the dependency direction `interfaces -> application/runtime -> ports -> domain/contracts`;
adapters implement ports and are assembled only in `bootstrap`. Foundation modules must not import
network, UI, provider SDK, or storage packages. Do not add order placement, broker credentials,
arbitrary shell execution, or database access.

Run `ruff check .`, `ruff format --check .`, `mypy`, `pytest`, both repository check scripts, and
the wheel build/smoke test before handing off a change. Update contracts and handbook pages when
public behavior changes.
