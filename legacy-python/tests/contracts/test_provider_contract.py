import pytest
from pydantic import TypeAdapter, ValidationError

from opentrading.adapters.fakes import FakeModelProvider
from opentrading.ports.provider import (
    AssistantToolCall,
    FinishReason,
    MessageRole,
    ModelEvent,
    ModelMessage,
    ModelRequest,
)


@pytest.mark.asyncio
async def test_fake_provider_emits_text_then_terminal_finish() -> None:
    provider = FakeModelProvider()
    request = ModelRequest(
        model="fixture-model",
        system="Fixture system text.",
        messages=(ModelMessage(role=MessageRole.USER, content="fixture"),),
        max_output_tokens=100,
    )
    events = [event async for event in provider.stream(request)]
    assert events[0].text_delta == "fixture response"
    assert events[-1].finish_reason is FinishReason.STOP


@pytest.mark.asyncio
async def test_fake_provider_declares_capabilities() -> None:
    capabilities = await FakeModelProvider().capabilities("fixture-model")
    assert capabilities.streaming
    assert capabilities.tool_calling
    assert capabilities.context_window == 32_000


def test_provider_event_discriminator_rejects_incomplete_finish() -> None:
    with pytest.raises(ValidationError):
        TypeAdapter(ModelEvent).validate_python({"kind": "finish"})


def test_tool_message_requires_tool_call_identity() -> None:
    with pytest.raises(ValidationError, match="tool_call_id is required"):
        ModelMessage(role=MessageRole.TOOL, content="fixture result")


def test_multi_step_tool_conversation_preserves_assistant_call() -> None:
    call = AssistantToolCall(call_id="call-1", name="market_snapshot", arguments={})
    messages = (
        ModelMessage(role=MessageRole.USER, content="Summarize today's market."),
        ModelMessage(role=MessageRole.ASSISTANT, tool_calls=(call,)),
        ModelMessage(role=MessageRole.TOOL, tool_call_id=call.call_id, content='{"status":"ok"}'),
        ModelMessage(role=MessageRole.ASSISTANT, content="The market data is available."),
    )

    request = ModelRequest(
        model="fixture-model",
        system="Fixture system text.",
        messages=messages,
        max_output_tokens=100,
    )
    assert request.messages[1].tool_calls == (call,)
    assert request.messages[2].tool_call_id == call.call_id


def test_assistant_message_requires_content_or_tool_calls() -> None:
    with pytest.raises(ValidationError, match="content or tool_calls"):
        ModelMessage(role=MessageRole.ASSISTANT)


def test_model_request_rejects_tool_result_without_assistant_call() -> None:
    with pytest.raises(ValidationError, match="pending assistant tool call"):
        ModelRequest(
            model="fixture-model",
            system="Fixture system text.",
            messages=(
                ModelMessage(
                    role=MessageRole.TOOL,
                    content="orphan result",
                    tool_call_id="missing-call",
                ),
            ),
            max_output_tokens=100,
        )
