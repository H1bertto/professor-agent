import asyncio
from collections.abc import AsyncIterator

import anthropic
import openai
import pytest
from fake_provider import (
    BAD_KEY,
    HANG_QUESTION,
    MODEL_MAX_TOKENS,
    REPLY,
    SLOW_MODEL,
    FakeProvider,
)

from professor_core import providers
from professor_core.conversation import (
    Conversation,
    ConversationEvent,
    ResponseFailed,
    ResponseFinished,
    ResponseStarted,
    ResponseText,
)
from professor_core.protocol import ProviderConfig
from professor_core.providers import REFUSAL_FALLBACK_BETA, create_llm_service

pytestmark = pytest.mark.anyio


class Recorder:
    """Collects conversation events and waits for answers to end."""

    def __init__(self) -> None:
        self.events: list[ConversationEvent] = []
        self._changed = asyncio.Event()

    async def __call__(self, event: ConversationEvent) -> None:
        self.events.append(event)
        self._changed.set()

    async def wait_until_done(self, message_id: str, timeout: float = 10) -> ConversationEvent:
        async with asyncio.timeout(timeout):
            while True:
                for event in self.events:
                    if event.id == message_id and isinstance(
                        event, ResponseFinished | ResponseFailed
                    ):
                        return event
                self._changed.clear()
                await self._changed.wait()

    async def wait_for_text(self, message_id: str, timeout: float = 10) -> None:
        async with asyncio.timeout(timeout):
            while not any(isinstance(e, ResponseText) and e.id == message_id for e in self.events):
                self._changed.clear()
                await self._changed.wait()

    def text(self, message_id: str) -> str:
        return "".join(
            e.text for e in self.events if isinstance(e, ResponseText) and e.id == message_id
        )

    def kinds(self, message_id: str) -> list[str]:
        kinds = [type(e).__name__ for e in self.events if e.id == message_id]
        return [kind for index, kind in enumerate(kinds) if index == 0 or kinds[index - 1] != kind]


def openai_provider(fake: FakeProvider, model: str = "gpt-fake", key: str = "k") -> ProviderConfig:
    return ProviderConfig(
        kind="openai-compatible", base_url=fake.openai_base_url, model=model, api_key=key
    )


def anthropic_provider(fake: FakeProvider, model: str, key: str = "k") -> ProviderConfig:
    return ProviderConfig(kind="anthropic", base_url=fake.base_url, model=model, api_key=key)


@pytest.fixture
async def talk(fake_provider: FakeProvider) -> AsyncIterator:
    conversations: list[Conversation] = []

    async def start(provider: ProviderConfig, **options: object) -> tuple[Conversation, Recorder]:
        recorder = Recorder()
        llm = await create_llm_service(provider, "You are a test teacher.")
        conversation = Conversation(llm, recorder, **options)  # type: ignore[arg-type]
        await conversation.start()
        conversations.append(conversation)
        return conversation, recorder

    yield start
    for conversation in conversations:
        await conversation.close()


async def test_streams_a_full_answer(talk, fake_provider: FakeProvider) -> None:
    conversation, recorder = await talk(openai_provider(fake_provider))
    await conversation.ask("q1", "since vs for?")

    assert await recorder.wait_until_done("q1") == ResponseFinished("q1", "complete")
    assert recorder.kinds("q1") == ["ResponseStarted", "ResponseText", "ResponseFinished"]
    assert recorder.text("q1") == REPLY


async def test_cancels_an_answer_midway(talk, fake_provider: FakeProvider) -> None:
    conversation, recorder = await talk(openai_provider(fake_provider, SLOW_MODEL))
    await conversation.ask("q1", "tell me a long story")
    await recorder.wait_for_text("q1")
    await conversation.cancel("q1")

    assert await recorder.wait_until_done("q1") == ResponseFinished("q1", "cancelled")
    assert 0 < len(recorder.text("q1")) < len(REPLY) * 4


async def test_a_new_question_interrupts_the_running_answer(
    talk, fake_provider: FakeProvider
) -> None:
    conversation, recorder = await talk(openai_provider(fake_provider, SLOW_MODEL))
    await conversation.ask("q1", "first")
    await recorder.wait_for_text("q1")
    await conversation.ask("q2", "second")

    assert await recorder.wait_until_done("q1") == ResponseFinished("q1", "cancelled")
    assert await recorder.wait_until_done("q2", timeout=20) == ResponseFinished("q2", "complete")
    first_q2 = next(i for i, e in enumerate(recorder.events) if e.id == "q2")
    last_q1 = max(i for i, e in enumerate(recorder.events) if e.id == "q1")
    assert last_q1 < first_q2, "the first answer must end before the second starts"


async def test_cancelling_a_question_before_it_starts(talk, fake_provider: FakeProvider) -> None:
    conversation, recorder = await talk(openai_provider(fake_provider, SLOW_MODEL))
    await conversation.ask("q1", "first")
    await conversation.cancel("q1")

    assert await recorder.wait_until_done("q1") == ResponseFinished("q1", "cancelled")
    assert recorder.text("q1") == ""


async def test_reports_provider_errors(talk, fake_provider: FakeProvider) -> None:
    conversation, recorder = await talk(openai_provider(fake_provider, key=BAD_KEY))
    await conversation.ask("q1", "hi")

    result = await recorder.wait_until_done("q1")
    assert isinstance(result, ResponseFailed)
    assert isinstance(result.error, openai.AuthenticationError)


async def test_anthropic_errors_too(talk, fake_provider: FakeProvider) -> None:
    conversation, recorder = await talk(anthropic_provider(fake_provider, "claude-opus-5", BAD_KEY))
    await conversation.ask("q1", "hi")

    result = await recorder.wait_until_done("q1")
    assert isinstance(result, ResponseFailed)
    assert isinstance(result.error, anthropic.AuthenticationError)


async def test_anthropic_request_for_a_current_model(talk, fake_provider: FakeProvider) -> None:
    conversation, recorder = await talk(anthropic_provider(fake_provider, "claude-opus-5"))
    await conversation.ask("q1", "since vs for?")

    assert await recorder.wait_until_done("q1") == ResponseFinished("q1", "complete")
    assert recorder.text("q1") == REPLY
    request = fake_provider.last_request("/v1/messages")
    assert request.body is not None
    assert request.body["max_tokens"] == MODEL_MAX_TOKENS
    assert request.body["output_config"] == {"effort": "low"}
    assert request.body["fallbacks"] == "default"
    assert "You are a test teacher." in str(request.body["system"])
    assert REFUSAL_FALLBACK_BETA in request.headers["anthropic-beta"]


async def test_anthropic_request_for_an_older_model(talk, fake_provider: FakeProvider) -> None:
    conversation, recorder = await talk(anthropic_provider(fake_provider, "claude-haiku-4-5"))
    await conversation.ask("q1", "hi")

    assert await recorder.wait_until_done("q1") == ResponseFinished("q1", "complete")
    request = fake_provider.last_request("/v1/messages")
    assert request.body is not None
    assert "output_config" not in request.body
    assert "fallbacks" not in request.body
    assert REFUSAL_FALLBACK_BETA not in request.headers.get("anthropic-beta", "")


async def test_keeps_a_limited_history(talk, fake_provider: FakeProvider) -> None:
    conversation, recorder = await talk(openai_provider(fake_provider), history_limit=3)
    for index in range(3):
        await conversation.ask(f"q{index}", f"question {index}")
        await recorder.wait_until_done(f"q{index}")

    request = fake_provider.last_request("/v1/chat/completions")
    assert request.body is not None
    roles = [message["role"] for message in request.body["messages"] if message["role"] != "system"]
    assert roles[0] == "user"
    assert len(roles) <= 3
    # The last answer is saved in the history a moment after it ends.
    async with asyncio.timeout(2):
        while conversation.history[-1]["role"] != "assistant":
            await asyncio.sleep(0.02)


async def test_carries_history_into_a_new_conversation(talk, fake_provider: FakeProvider) -> None:
    first, recorder = await talk(openai_provider(fake_provider))
    await first.ask("q1", "remember me")
    await recorder.wait_until_done("q1")

    second, recorder2 = await talk(openai_provider(fake_provider), history=first.history)
    await second.ask("q2", "do you remember?")
    await recorder2.wait_until_done("q2")

    request = fake_provider.last_request("/v1/chat/completions")
    assert request.body is not None
    contents = [message.get("content") for message in request.body["messages"]]
    assert "remember me" in contents


async def test_a_silent_provider_fails_with_a_timeout(talk, fake_provider: FakeProvider) -> None:
    conversation, recorder = await talk(openai_provider(fake_provider), first_text_timeout_s=0.5)
    await conversation.ask("q1", HANG_QUESTION)

    result = await recorder.wait_until_done("q1", timeout=5)
    assert isinstance(result, ResponseFailed)
    assert isinstance(result.error, TimeoutError)
    assert recorder.text("q1") == ""


async def test_answers_again_after_a_timeout(talk, fake_provider: FakeProvider) -> None:
    conversation, recorder = await talk(openai_provider(fake_provider), first_text_timeout_s=0.5)
    await conversation.ask("q1", HANG_QUESTION)
    await recorder.wait_until_done("q1", timeout=5)
    await conversation.ask("q2", "since vs for?")

    assert await recorder.wait_until_done("q2", timeout=10) == ResponseFinished("q2", "complete")
    assert recorder.text("q2") == REPLY


async def test_only_gemini_gets_a_reasoning_effort(
    talk, fake_provider: FakeProvider, monkeypatch: pytest.MonkeyPatch
) -> None:
    conversation, recorder = await talk(openai_provider(fake_provider))
    await conversation.ask("q1", "hi")
    await recorder.wait_until_done("q1")
    request = fake_provider.last_request("/v1/chat/completions")
    assert request.body is not None
    assert "reasoning_effort" not in request.body

    # Pretend the fake is Gemini.
    monkeypatch.setattr(providers, "GEMINI_HOST", "127.0.0.1")
    conversation, recorder = await talk(openai_provider(fake_provider))
    await conversation.ask("q2", "hi")
    await recorder.wait_until_done("q2")
    request = fake_provider.last_request("/v1/chat/completions")
    assert request.body is not None
    assert request.body["reasoning_effort"] == "low"


async def test_closing_cancels_the_running_answer(talk, fake_provider: FakeProvider) -> None:
    conversation, recorder = await talk(openai_provider(fake_provider, SLOW_MODEL))
    await conversation.ask("q1", "long")
    await recorder.wait_for_text("q1")
    await conversation.close()

    assert recorder.events[-1] == ResponseFinished("q1", "cancelled")
    assert isinstance(recorder.events[0], ResponseStarted)
