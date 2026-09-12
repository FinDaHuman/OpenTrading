"""CLI entrypoint for local diagnostics and the TUI shell."""

from typing import Annotated

import typer
from pydantic import ValidationError
from rich.console import Console
from rich.table import Table

from opentrading import __version__
from opentrading.application.diagnostics import run_local_diagnostics
from opentrading.config import Settings, summarize_settings_error

app = typer.Typer(
    name="opentrading",
    help="Local-first scaffold for Vietnamese market research agents.",
    no_args_is_help=True,
)
console = Console()
error_console = Console(stderr=True)


def version_callback(value: bool) -> None:
    if value:
        typer.echo(f"opentrading {__version__}")
        raise typer.Exit()


@app.callback()
def root(
    version: Annotated[
        bool | None,
        typer.Option("--version", callback=version_callback, is_eager=True),
    ] = None,
) -> None:
    """Inspect and develop the OpenTrading scaffold."""
    del version


@app.command()
def doctor() -> None:
    """Validate local setup without contacting any remote service."""
    try:
        settings = Settings()
    except ValidationError as error:
        error_console.print(f"[red]Invalid configuration:[/red] {summarize_settings_error(error)}")
        raise typer.Exit(code=2) from error

    results = run_local_diagnostics(settings)
    table = Table(title="Local diagnostics")
    table.add_column("Check")
    table.add_column("Status")
    table.add_column("Detail")
    for result in results:
        table.add_row(result.name, "PASS" if result.ok else "FAIL", result.detail)
    console.print(table)
    if not all(result.ok for result in results):
        raise typer.Exit(code=1)


@app.command()
def status() -> None:
    """Show which product capabilities are currently implemented."""
    console.print("[bold]Scaffold status[/bold]")
    console.print("Contracts, configuration, CLI and TUI shell: implemented")
    console.print("LLM adapters, data adapters, agent loop and sessions: specified")
    console.print("Trading and order execution: out of scope")


@app.command()
def research(question: Annotated[str, typer.Argument(help="Research question")]) -> None:
    """Reserved command for the future research runtime."""
    del question
    error_console.print("[yellow]Research runtime is specified but not implemented.[/yellow]")
    raise typer.Exit(code=3)


@app.command()
def tui() -> None:
    """Launch the terminal user-interface shell."""
    from opentrading.interfaces.tui.app import OpenTradingTui

    OpenTradingTui().run()


def main() -> None:
    app()


if __name__ == "__main__":
    main()
