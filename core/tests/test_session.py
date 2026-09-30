import asyncio

import pytest
from fake_provider import FakeProvider

from professor_core.protocol import (
    VOICE_OFF,
    Configure,
    Message,
    PersonaConfig,
    ProviderConfig,
    UserText,
)
from professor_core.session import Session

pytestmark = pytest.mark.anyio


class Outbox:
    """Collects what the session sends to the desktop."""

    def __init__(self) -> None:
        self.messages: list[Message] = []

    async def __call__(self, message: Message) -> None:
        self.messages.append(message)

    async def answer(self, message_id: str, timeout: float = 10) -> list[Message]:
        async with asyncio.timeout(timeout):
            while True:
                answer = [m for m in self.messages if getattr(m, "id", None) == message_id]
                if any(m.type == "response.end" for m in answer):  # type: ignore[attr-defined]
                    return answer
                await asyncio.sleep(0.02)


def configure(fake: FakeProvider) -> Configure:
    provider = ProviderConfig(
        kind="openai-compatible", base_url=fake.openai_base_url, model="gpt-fake", api_key="k"
    )
    return Configure(provider=provider, persona=PersonaConfig(name="Professor"), voice=VOICE_OFF)


async def test_replaces_a_pipeline_that_stopped_by_itself(fake_provider: FakeProvider) -> None:
    outbox = Outbox()
    session = Session(outbox)
    await session.handle(configure(fake_provider))
    await session.handle(UserText(id="q1", text="remember me"))
    await outbox.answer("q1")

    # Stop the pipeline behind the session's back, as Pipecat's idle timeout used to do.
    stopped = session._conversation
    assert stopped is not None
    await stopped._worker.cancel()
    async with asyncio.timeout(5):
        while stopped.alive:
            await asyncio.sleep(0.02)

    await session.handle(UserText(id="q2", text="since vs for?"))
    answer = await outbox.answer("q2")

    assert answer[-1].reason == "complete"  # type: ignore[attr-defined]
    assert any(m.type == "response.delta" for m in answer)  # type: ignore[attr-defined]
    assert session._conversation is not stopped
    request = fake_provider.last_request("/v1/chat/completions")
    assert "remember me" in str(request.body), "the history carries over"
    await session.close()
