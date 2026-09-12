"""Deterministic test doubles for development and contract tests."""

from collections.abc import AsyncIterator

from opentrading.ports.provider import (
    FinishEvent,
    FinishReason,
    ModelCapabilities,
    ModelEvent,
    ModelRequest,
    TextDeltaEvent,
)


class FakeModelProvider:
    async def capabilities(self, model: str) -> ModelCapabilities:
        del model
        return ModelCapabilities(
            streaming=True,
            tool_calling=True,
            structured_output=True,
            parallel_tool_calls=False,
            context_window=32_000,
        )

    async def stream(self, request: ModelRequest) -> AsyncIterator[ModelEvent]:
        del request
        yield TextDeltaEvent(text_delta="fixture response")
        yield FinishEvent(finish_reason=FinishReason.STOP)
