# ADR 0001: Python modular monolith

Status: accepted

## Decision

Use Python 3.12 with one installable package and explicit modules. Use Pydantic at external
boundaries, Typer for CLI, Textual for TUI, and asyncio-compatible ports.

## Context and consequences

The existing data services and financial code are Python, while the initial product runs locally.
This choice minimizes cross-language ownership and supports typed financial models. Python does not
provide hard module isolation, so import-boundary tests and review rules enforce the architecture.
We will reconsider services or native extensions only after measurements identify a concrete need.
