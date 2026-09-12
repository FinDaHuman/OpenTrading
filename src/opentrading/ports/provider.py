"""LLM provider contract independent of provider SDKs."""

from collections.abc import AsyncIterator
from enum import StrEnum
from typing import Annotated, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, model_validator

from opentrading.contracts.json_types import JsonObject
from opentrading.errors import ErrorCode


class ProviderModel(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", frozen=True, allow_inf_nan=False)


class MessageRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


class FinishReason(StrEnum):
    STOP = "stop"
    TOOL_CALL = "tool_call"
    LENGTH = "length"
    CANCELLED = "cancelled"


class ModelCapabilities(ProviderModel):
    streaming: bool
    tool_calling: bool
    structured_output: bool
    parallel_tool_calls: bool = False
    context_window: int = Field(gt=0)


class AssistantToolCall(ProviderModel):
    """A complete provider-neutral tool call preserved in conversation history."""

    call_id: str = Field(min_length=1)
    name: str = Field(pattern=r"^[a-z][a-z0-9_]{1,63}$")
    arguments: JsonObject


class ModelMessage(ProviderModel):
    role: MessageRole
    content: str | None = Field(default=None, min_length=1)
    tool_call_id: str | None = Field(default=None, min_length=1)
    tool_calls: tuple[AssistantToolCall, ...] = ()

    @model_validator(mode="after")
    def validate_shape_for_role(self) -> "ModelMessage":
        if self.role is MessageRole.USER:
            if self.content is None:
                raise ValueError("content is required for user messages")
            if self.tool_call_id is not None or self.tool_calls:
                raise ValueError("tool identity is not valid for user messages")
        elif self.role is MessageRole.ASSISTANT:
            if self.content is None and not self.tool_calls:
                raise ValueError("assistant messages require content or tool_calls")
            if self.tool_call_id is not None:
                raise ValueError("tool_call_id is valid only for tool messages")
        else:
            if self.content is None:
                raise ValueError("content is required for tool messages")
            if self.tool_call_id is None:
                raise ValueError("tool_call_id is required for tool messages")
            if self.tool_calls:
                raise ValueError("tool_calls are valid only for assistant messages")
        return self


class ProviderTool(ProviderModel):
    name: str = Field(pattern=r"^[a-z][a-z0-9_]{1,63}$")
    description: str = Field(min_length=1)
    input_schema: JsonObject


class ModelRequest(ProviderModel):
    model: str = Field(min_length=1)
    system: str = Field(min_length=1)
    messages: tuple[ModelMessage, ...] = Field(min_length=1)
    tools: tuple[ProviderTool, ...] = ()
    max_output_tokens: int = Field(gt=0)

    @model_validator(mode="after")
    def validate_tool_call_history(self) -> "ModelRequest":
        pending: set[str] = set()
        seen: set[str] = set()
        for message in self.messages:
            if message.role is MessageRole.ASSISTANT and message.tool_calls:
                if pending:
                    raise ValueError("assistant tool calls cannot start before prior results")
                call_ids = {call.call_id for call in message.tool_calls}
                if len(call_ids) != len(message.tool_calls) or call_ids & seen:
                    raise ValueError("assistant tool call IDs must be unique within a request")
                pending = call_ids
                seen.update(call_ids)
            elif message.role is MessageRole.TOOL:
                if message.tool_call_id not in pending:
                    raise ValueError("tool message must reference a pending assistant tool call")
                pending.remove(message.tool_call_id)
            elif pending:
                raise ValueError("all assistant tool calls require results before the next message")
        if pending:
            raise ValueError("all assistant tool calls require results before a model request")
        return self


class TextDeltaEvent(ProviderModel):
    kind: Literal["text_delta"] = "text_delta"
    text_delta: str = Field(min_length=1)


class ToolCallEvent(ProviderModel):
    kind: Literal["tool_call"] = "tool_call"
    call_id: str = Field(min_length=1)
    name: str = Field(pattern=r"^[a-z][a-z0-9_]{1,63}$")
    arguments: JsonObject


class UsageEvent(ProviderModel):
    kind: Literal["usage"] = "usage"
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)


class FinishEvent(ProviderModel):
    kind: Literal["finish"] = "finish"
    finish_reason: FinishReason


class ProviderErrorEvent(ProviderModel):
    kind: Literal["error"] = "error"
    error_code: ErrorCode
    message: str = Field(min_length=1, max_length=2_000)
    retryable: bool


type ModelEvent = Annotated[
    TextDeltaEvent | ToolCallEvent | UsageEvent | FinishEvent | ProviderErrorEvent,
    Field(discriminator="kind"),
]


class ModelProvider(Protocol):
    async def capabilities(self, model: str) -> ModelCapabilities: ...

    def stream(self, request: ModelRequest) -> AsyncIterator[ModelEvent]: ...
