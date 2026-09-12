"""Durable local event-store contract."""

from collections.abc import AsyncIterator
from typing import Protocol
from uuid import UUID

from opentrading.contracts.events import RunRecord, SessionEvent, SessionRecord


class SessionStore(Protocol):
    async def create_session(self, session: SessionRecord) -> None: ...

    async def create_run(self, run: RunRecord) -> None:
        """Create a run and validate any resume link in one transaction.

        A resumed run must reference an interrupted run in the same session.
        """
        ...

    async def append(self, event: SessionEvent, *, expected_previous_sequence: int) -> None: ...

    def events(
        self, *, session_id: UUID, after_sequence: int = -1
    ) -> AsyncIterator[SessionEvent]: ...

    async def mark_incomplete_runs_interrupted(self, *, session_id: UUID | None = None) -> int: ...

    async def delete_session(self, session_id: UUID) -> None: ...
