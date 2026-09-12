from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import TypeAdapter, ValidationError

from opentrading.contracts import (
    EventKind,
    RunOutcome,
    RunRecord,
    RunState,
    SessionEvent,
    TerminalRunState,
)
from opentrading.contracts.events import EVENT_PAYLOAD_MODELS
from opentrading.ports.tools import ToolResult


def test_successful_tool_result_cannot_carry_an_error() -> None:
    with pytest.raises(ValidationError):
        TypeAdapter(ToolResult).validate_python(
            {
                "success": True,
                "call_id": "call-1",
                "content": {},
                "error_code": "permission_denied",
            }
        )


def test_run_outcome_accepts_only_terminal_states() -> None:
    outcome = RunOutcome(
        run_id=uuid4(),
        session_id=uuid4(),
        state=TerminalRunState.COMPLETED,
        final_event_sequence=3,
    )
    assert outcome.state is TerminalRunState.COMPLETED
    with pytest.raises(ValidationError):
        RunOutcome(
            run_id=uuid4(),
            session_id=uuid4(),
            state=RunState.RUNNING,  # type: ignore[arg-type]
            final_event_sequence=0,
        )


def test_run_scoped_event_requires_run_identity() -> None:
    with pytest.raises(ValidationError, match="run_id is required"):
        SessionEvent(
            event_id=uuid4(),
            session_id=uuid4(),
            sequence=1,
            occurred_at=datetime.now(UTC),
            kind=EventKind.RUN_STARTED,
            payload={},
        )


def test_context_summary_event_requires_source_event_sequences() -> None:
    with pytest.raises(ValidationError, match="source_event_sequences"):
        SessionEvent(
            event_id=uuid4(),
            session_id=uuid4(),
            run_id=uuid4(),
            sequence=4,
            occurred_at=datetime.now(UTC),
            kind=EventKind.CONTEXT_SUMMARY_CREATED,
            payload={"summary": "Compact context"},
        )


def test_context_summary_event_accepts_ordered_source_sequences() -> None:
    event = SessionEvent(
        event_id=uuid4(),
        session_id=uuid4(),
        run_id=uuid4(),
        sequence=4,
        occurred_at=datetime.now(UTC),
        kind=EventKind.CONTEXT_SUMMARY_CREATED,
        payload={"summary": "Compact context", "source_event_sequences": [1, 2, 3]},
    )
    assert event.payload["source_event_sequences"] == [1, 2, 3]


def test_context_summary_cannot_reference_itself_or_future_events() -> None:
    with pytest.raises(ValidationError, match="only earlier event sequences"):
        SessionEvent(
            event_id=uuid4(),
            session_id=uuid4(),
            run_id=uuid4(),
            sequence=4,
            occurred_at=datetime.now(UTC),
            kind=EventKind.CONTEXT_SUMMARY_CREATED,
            payload={"summary": "Invalid context", "source_event_sequences": [4]},
        )


def test_run_record_cannot_resume_itself() -> None:
    run_id = uuid4()
    with pytest.raises(ValidationError, match="cannot resume itself"):
        RunRecord(
            run_id=run_id,
            session_id=uuid4(),
            created_at=datetime.now(UTC),
            resumed_from_run_id=run_id,
        )


def test_run_finished_event_requires_terminal_state_payload() -> None:
    with pytest.raises(ValidationError):
        SessionEvent(
            event_id=uuid4(),
            session_id=uuid4(),
            run_id=uuid4(),
            sequence=5,
            occurred_at=datetime.now(UTC),
            kind=EventKind.RUN_FINISHED,
            payload={"state": "running"},
        )


def test_run_created_event_rejects_malformed_resume_identity() -> None:
    with pytest.raises(ValidationError):
        SessionEvent(
            event_id=uuid4(),
            session_id=uuid4(),
            run_id=uuid4(),
            sequence=1,
            occurred_at=datetime.now(UTC),
            kind=EventKind.RUN_CREATED,
            payload={"resumed_from_run_id": "not-a-uuid"},
        )


def test_every_event_kind_has_a_payload_schema() -> None:
    assert set(EVENT_PAYLOAD_MODELS) == set(EventKind)
