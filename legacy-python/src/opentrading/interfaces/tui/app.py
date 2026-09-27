"""Minimal TUI shell that states the scaffold boundary honestly."""

from typing import ClassVar

from textual.app import App, ComposeResult
from textual.binding import BindingType
from textual.containers import Container
from textual.widgets import Footer, Header, Static


class OpenTradingTui(App[None]):
    TITLE = "OpenTrading"
    SUB_TITLE = "Scaffold"
    BINDINGS: ClassVar[list[BindingType]] = [("q", "quit", "Quit")]
    CSS = """
    Screen { align: center middle; }
    #panel { width: 72; height: auto; border: round $accent; padding: 1 2; }
    #status { color: $warning; margin-top: 1; }
    """

    def compose(self) -> ComposeResult:
        yield Header()
        with Container(id="panel"):
            yield Static("Vietnamese equities and derivatives research harness")
            yield Static(
                "The TUI shell is ready. Agent runtime and live integrations are specified "
                "but not implemented.",
                id="status",
            )
            yield Static("Press q to exit.")
        yield Footer()
