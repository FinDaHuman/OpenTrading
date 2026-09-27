"""Local-only diagnostics used by the doctor command."""

import sys
from dataclasses import dataclass
from pathlib import Path

from opentrading.config import Settings


@dataclass(frozen=True, slots=True)
class Diagnostic:
    name: str
    ok: bool
    detail: str


def run_local_diagnostics(settings: Settings) -> tuple[Diagnostic, ...]:
    """Check local configuration without contacting any upstream service."""
    database_parent = settings.session_database.expanduser().parent
    return (
        Diagnostic("python", sys.version_info >= (3, 12), sys.version.split()[0]),
        Diagnostic("environment", True, settings.environment),
        Diagnostic("session-directory", _parent_is_usable(database_parent), str(database_parent)),
        Diagnostic(
            "remote-access",
            True,
            "not checked; doctor never contacts remote services",
        ),
    )


def _parent_is_usable(parent: Path) -> bool:
    current = parent
    while not current.exists() and current != current.parent:
        current = current.parent
    return current.is_dir()
