"""Versioned session and run contracts with session-scoped ordering."""

from collections.abc import Mapping
from enum import StrEnum
from types import MappingProxyType
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from .json_types import JsonObject


class ContractModel(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", frozen=True, allow_inf_nan=False)


class RunState(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    INTERRUPTED = "interrupted"


class TerminalRunState(StrEnum):
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    INTERRUPTED = "interrupted"


class EventKind(StrEnum):
    SESSION_CREATED = "session.created"
    RUN_CREATED = "run.created"
    RUN_STARTED = "run.started"
    MODEL_EVENT = "model.event"
    TOOL_CALL_STARTED = "tool.call.started"
    TOOL_CALL_FINISHED = "tool.call.finished"
    EVIDENCE_RECORDED = "evidence.recorded"
    CONTEXT_SUMMARY_CREATED = "context.summary.created"
    RUN_FINISHED = "run.finished"


class EventPayloadModel(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", frozen=True, allow_inf_nan=False)


class SessionCreatedPayload(EventPayloadModel):
    title: str = Field(min_length=1, max_length=200)


class RunCreatedPayload(EventPayloadModel):
    resumed_from_run_id: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def validate_resume_identity(self) -> "RunCreatedPayload":
        if self.resumed_from_run_id is not None:
            UUID(self.resumed_from_run_id)
        return self


class RunStartedPayload(EventPayloadModel):
    pass


class ModelEventPayload(EventPayloadModel):
    event: JsonObject


class ToolCallStartedPayload(EventPayloadModel):
    call_id: str = Field(min_length=1)
    name: str = Field(pattern=r"^[a-z][a-z0-9_]{1,63}$")


class ToolCallFinishedPayload(EventPayloadModel):
    call_id: str = Field(min_length=1)
    success: bool
    error_code: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def validate_result(self) -> "ToolCallFinishedPayload":
        if self.success and self.error_code is not None:
            raise ValueError("a successful tool call cannot carry error_code")
        if not self.success and self.error_code is None:
            raise ValueError("a failed tool call requires error_code")
        return self


class EvidenceRecordedPayload(EventPayloadModel):
    evidence_id: str = Field(min_length=1)


class ContextSummaryCreatedPayload(EventPayloadModel):
    summary: str = Field(min_length=1)
    source_event_sequences: list[int] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_source_order(self) -> "ContextSummaryCreatedPayload":
        if any(sequence < 0 for sequence in self.source_event_sequences):
            raise ValueError("source event sequences cannot be negative")
        if self.source_event_sequences != sorted(set(self.source_event_sequences)):
            raise ValueError("source event sequences must be unique and increasing")
        return self


class RunFinishedPayload(EventPayloadModel):
    state: Literal["completed", "failed", "cancelled", "interrupted"]
    message: str | None = Field(default=None, max_length=2_000)


EVENT_PAYLOAD_MODELS: Mapping[EventKind, type[EventPayloadModel]] = MappingProxyType(
    {
        EventKind.SESSION_CREATED: SessionCreatedPayload,
        EventKind.RUN_CREATED: RunCreatedPayload,
        EventKind.RUN_STARTED: RunStartedPayload,
        EventKind.MODEL_EVENT: ModelEventPayload,
        EventKind.TOOL_CALL_STARTED: ToolCallStartedPayload,
        EventKind.TOOL_CALL_FINISHED: ToolCallFinishedPayload,
        EventKind.EVIDENCE_RECORDED: EvidenceRecordedPayload,
        EventKind.CONTEXT_SUMMARY_CREATED: ContextSummaryCreatedPayload,
        EventKind.RUN_FINISHED: RunFinishedPayload,
    }
)


class SessionRecord(ContractModel):
    schema_version: Literal[1] = 1
    session_id: UUID
    created_at: AwareDatetime
    title: str = Field(min_length=1, max_length=200)


class RunRequest(ContractModel):
    schema_version: Literal[1] = 1
    run_id: UUID
    session_id: UUID
    question: str = Field(min_length=1, max_length=20_000)
    created_at: AwareDatetime
    max_steps: int = Field(default=12, gt=0, le=64)
    max_tool_calls: int = Field(default=24, gt=0, le=128)
    max_input_tokens: int = Field(default=60_000, gt=0)
    max_output_tokens: int = Field(default=8_000, gt=0)
    timeout_seconds: float = Field(default=180, gt=0, le=900)
    resumed_from_run_id: UUID | None = None

    @model_validator(mode="after")
    def reject_self_resume(self) -> "RunRequest":
        if self.resumed_from_run_id == self.run_id:
            raise ValueError("a run cannot resume itself")
        return self


class RunRecord(ContractModel):
    schema_version: Literal[1] = 1
    run_id: UUID
    session_id: UUID
    created_at: AwareDatetime
    state: RunState = RunState.QUEUED
    resumed_from_run_id: UUID | None = None

    @model_validator(mode="after")
    def reject_self_resume(self) -> "RunRecord":
        if self.resumed_from_run_id == self.run_id:
            raise ValueError("a run cannot resume itself")
        return self


class SessionEvent(ContractModel):
    schema_version: Literal[1] = 1
    event_id: UUID
    session_id: UUID
    run_id: UUID | None = None
    sequence: int = Field(ge=0)
    occurred_at: AwareDatetime
    kind: EventKind
    payload: JsonObject

    @model_validator(mode="after")
    def require_run_for_run_event(self) -> "SessionEvent":
        if self.kind is EventKind.SESSION_CREATED and self.run_id is not None:
            raise ValueError("run_id must be absent for session.created")
        if self.kind is not EventKind.SESSION_CREATED and self.run_id is None:
            raise ValueError("run_id is required for run-scoped events")
        validated_payload = EVENT_PAYLOAD_MODELS[self.kind].model_validate(self.payload)
        if isinstance(validated_payload, ContextSummaryCreatedPayload) and any(
            source >= self.sequence for source in validated_payload.source_event_sequences
        ):
            raise ValueError("a summary can reference only earlier event sequences")
        return self


class RunOutcome(ContractModel):
    schema_version: Literal[1] = 1
    run_id: UUID
    session_id: UUID
    state: TerminalRunState
    final_event_sequence: int = Field(ge=0)
    message: str | None = Field(default=None, max_length=2_000)
