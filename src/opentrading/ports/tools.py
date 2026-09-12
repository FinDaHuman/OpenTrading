"""Tool schemas and deterministic policy contract."""

from enum import StrEnum
from typing import Annotated, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

from opentrading.contracts.json_types import JsonObject
from opentrading.errors import ErrorCode


class ToolModel(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", frozen=True, allow_inf_nan=False)


class Permission(StrEnum):
    MARKET_READ = "market:read"
    NEWS_READ = "news:read"
    SIGNAL_READ = "signal:read"


class ConcurrencyMode(StrEnum):
    PARALLEL = "parallel"
    EXCLUSIVE = "exclusive"


class ToolSpec(ToolModel):
    name: str = Field(pattern=r"^[a-z][a-z0-9_]{1,63}$")
    description: str = Field(min_length=1)
    input_schema: JsonObject
    output_schema: JsonObject
    permission: Permission
    timeout_seconds: float = Field(gt=0, le=120)
    max_result_bytes: int = Field(gt=0, le=10_000_000)
    concurrency: ConcurrencyMode = ConcurrencyMode.PARALLEL


class ToolCall(ToolModel):
    call_id: str = Field(min_length=1)
    name: str = Field(pattern=r"^[a-z][a-z0-9_]{1,63}$")
    arguments: JsonObject


class ToolSuccess(ToolModel):
    success: Literal[True] = True
    call_id: str = Field(min_length=1)
    content: JsonObject


class ToolFailure(ToolModel):
    success: Literal[False] = False
    call_id: str = Field(min_length=1)
    error_code: ErrorCode
    error_message: str = Field(min_length=1, max_length=2_000)
    retryable: bool


type ToolResult = Annotated[ToolSuccess | ToolFailure, Field(discriminator="success")]


class ToolPolicy(Protocol):
    def authorize(self, spec: ToolSpec, granted: frozenset[Permission]) -> bool: ...
