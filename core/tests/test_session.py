import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from fake_provider import FakeProvider
from voice_fakes import FakeKokoro, ScriptedDetector, chunk, ready_engine, types

from professor_core.protocol import (
    VOICE_OFF,
    Configure,
    ListenEnd,
    ListenStart,
    ListenStop,
    Message,
    PersonaConfig,
    ProviderConfig,
    ResponseCancel,
    ResponseEnd,
    SpeechEnd,
    Transcript,
    UserText,
    VoiceConfig,
    VoiceStatus,
)
from professor_core.session import Session
from professor_core.speech_models import SpeechModels, VoiceEngine

pytestmark = pytest.mark.anyio

OPEN_SESSIONS: list[Session] = []


@pytest.fixture(autouse=True)
async def close_sessions() -> AsyncIterator[None]:
    """A session left open keeps Pipecat tasks alive, which hangs the test runner."""
    yield
    for session in OPEN_SESSIONS:
        await session.close()
    OPEN_SESSIONS.clear()


def new_session(send: Any, **options: Any) -> Session:
    session = Session(send, **options)
    OPEN_SESSIONS.append(session)
    return session


class Outbox:
    """Collects what the session sends to the desktop."""

    def __init__(self) -> None:
        self.messages: list[Message] = []

    async def __call__(self, message: Message) -> None:
        self.messages.append(message)

    async def answer(self, message_id: str, timeout: float = 10) -> list[Message]:
        return await self.until(message_id, "response.end", timeout)

    async def until(self, message_id: str, kind: str, timeout: float = 10) -> list[Message]:
        """Everything sent for this id, once a message of this kind arrives."""
        async with asyncio.timeout(timeout):
            while True:
                sent = [m for m in self.messages if getattr(m, "id", None) == message_id]
                if any(m.type == kind for m in sent):  # type: ignore[attr-defined]
                    return sent
                await asyncio.sleep(0.02)


def configure(fake: FakeProvider) -> Configure:
    provider = ProviderConfig(
        kind="openai-compatible", base_url=fake.openai_base_url, model="gpt-fake", api_key="k"
    )
    return Configure(provider=provider, persona=PersonaConfig(name="Professor"), voice=VOICE_OFF)


async def test_reports_the_voice_status_while_voice_is_on(
    fake_provider: FakeProvider, tmp_path: Path
) -> None:
    engine = VoiceEngine(
        tmp_path,
        check=lambda: None,
        downloader=lambda folder, *, progress: None,
        loader=lambda folder: SpeechModels(whisper="whisper", kokoro="kokoro"),
    )
    outbox = Outbox()
    session = new_session(outbox, voice=engine)
    await session.handle(configure(fake_provider))
    assert not [m for m in outbox.messages if m.type == "voice.status"]  # type: ignore[attr-defined]
    pipeline = session._conversation

    voice_on = VoiceConfig(
        enabled=True, speak_answers=True, spoken_language="auto", english_voice="teacher"
    )
    await session.handle(configure(fake_provider).model_copy(update={"voice": voice_on}))
    await engine.wait()
    states = [m.state for m in outbox.messages if m.type == "voice.status"]  # type: ignore[attr-defined]
    assert states[-2:] == ["loading", "ready"]
    assert session._conversation is pipeline, "voice settings keep the teacher's pipeline"

    await session.handle(configure(fake_provider))
    assert outbox.messages[-1] == VoiceStatus(state="off")
    await session.close()


VOICE_ON = VoiceConfig(
    enabled=True, speak_answers=False, spoken_language="auto", english_voice="teacher"
)


async def listening_session(
    fake: FakeProvider, folder: Path, *, speaking: int = 3
) -> tuple[Session, Outbox]:
    engine = await ready_engine(folder)
    outbox = Outbox()
    detector = ScriptedDetector(speaking=speaking)
    session = new_session(outbox, voice=engine, detector_factory=lambda: detector)
    await session.handle(configure(fake).model_copy(update={"voice": VOICE_ON}))
    return session, outbox


async def test_hears_a_spoken_question_and_answers_it(
    fake_provider: FakeProvider, tmp_path: Path
) -> None:
    session, outbox = await listening_session(fake_provider, tmp_path)
    await session.handle(ListenStart(id="v1"))
    for _ in range(4):
        await session.handle_audio(chunk())

    answer = await outbox.answer("v1")
    assert types(answer)[:3] == ["listen.end", "transcript", "response.start"]
    assert answer[0] == ListenEnd(id="v1", reason="silence")
    assert answer[1] == Transcript(id="v1", text="since vs for?", lang="pt")
    assert ResponseEnd(id="v1", reason="complete") in answer
    request = fake_provider.last_request("/v1/chat/completions")
    assert "since vs for?" in str(request.body)

    metrics = (await outbox.until("v1", "turn.metrics"))[-1]
    assert metrics.listened_ms == round(4 * 0.032 * 1000)  # type: ignore[attr-defined]
    assert metrics.transcribe_ms is not None  # type: ignore[attr-defined]
    assert metrics.first_audio_ms is None, "this answer is not spoken"  # type: ignore[attr-defined]
    await session.close()


async def test_the_hotkey_ends_the_question(fake_provider: FakeProvider, tmp_path: Path) -> None:
    session, outbox = await listening_session(fake_provider, tmp_path, speaking=1_000)
    await session.handle(ListenStart(id="v1"))
    await session.handle_audio(chunk())
    await session.handle(ListenStop(id="v1"))

    answer = await outbox.answer("v1")
    assert answer[0] == ListenEnd(id="v1", reason="stopped")
    assert types(answer)[1] == "transcript"
    await session.close()


async def test_a_cancelled_question_is_not_heard(
    fake_provider: FakeProvider, tmp_path: Path
) -> None:
    session, outbox = await listening_session(fake_provider, tmp_path, speaking=1_000)
    await session.handle(ListenStart(id="v1"))
    await session.handle_audio(chunk())
    await session.handle(ResponseCancel(id="v1"))
    await session.handle_audio(chunk())
    await asyncio.sleep(0.1)

    sent = [m for m in outbox.messages if getattr(m, "id", None) == "v1"]
    assert sent == [ListenEnd(id="v1", reason="cancelled")]
    await session.close()


async def test_says_so_when_it_heard_nothing(fake_provider: FakeProvider, tmp_path: Path) -> None:
    session, outbox = await listening_session(fake_provider, tmp_path, speaking=0)
    await session.handle(ListenStart(id="v1"))
    await session.handle_audio(chunk())
    await session.handle(ListenStop(id="v1"))

    sent = await outbox.until("v1", "error")
    assert types(sent) == ["listen.end", "error"]
    assert sent[1].code == "no_speech"  # type: ignore[attr-defined]
    await session.close()


async def test_a_new_question_replaces_the_one_being_heard(
    fake_provider: FakeProvider, tmp_path: Path
) -> None:
    session, outbox = await listening_session(fake_provider, tmp_path, speaking=1_000)
    await session.handle(ListenStart(id="v1"))
    await session.handle(ListenStart(id="v2"))

    assert outbox.messages[-1] == ListenEnd(id="v1", reason="cancelled")
    await session.close()


async def test_listening_needs_voice_on(fake_provider: FakeProvider, tmp_path: Path) -> None:
    engine = await ready_engine(tmp_path)
    outbox = Outbox()
    session = new_session(outbox, voice=engine)
    await session.handle(configure(fake_provider))
    await session.handle(ListenStart(id="v1"))

    assert types(outbox.messages[-2:]) == ["error", "listen.end"]
    assert outbox.messages[-2].code == "voice_unavailable"  # type: ignore[attr-defined]
    await session.close()


async def test_speaks_the_answer_while_the_text_streams(
    fake_provider: FakeProvider, tmp_path: Path
) -> None:
    kokoro = FakeKokoro()
    engine = await ready_engine(tmp_path, kokoro=kokoro)
    outbox = Outbox()
    audio: list[bytes] = []

    async def send_audio(frame: bytes) -> None:
        audio.append(frame)

    session = new_session(outbox, send_audio=send_audio, voice=engine)
    speaking = VOICE_ON.model_copy(update={"speak_answers": True})
    await session.handle(configure(fake_provider).model_copy(update={"voice": speaking}))
    await session.handle(UserText(id="q1", text="Qual a diferença entre since e for?"))

    sent = await outbox.until("q1", "speech.end")
    kinds = types(sent)
    assert kinds.index("speech.start") > kinds.index("response.start")
    assert SpeechEnd(id="q1", reason="complete") in sent
    segments = [m for m in sent if m.type == "speech.segment"]  # type: ignore[attr-defined]
    assert segments and all(s.lang == "pt" for s in segments)  # type: ignore[attr-defined]
    assert audio and all(frame[0] == 0x02 for frame in audio)
    # The fake teacher says <en>since</en>, which the teacher's voice pronounces in English.
    assert any("<en-us:since>" in call["text"] for call in kokoro.calls)

    metrics = (await outbox.until("q1", "turn.metrics"))[-1]
    assert metrics.type == "turn.metrics"  # type: ignore[attr-defined]
    assert metrics.listened_ms is None  # type: ignore[attr-defined]
    assert metrics.first_text_ms is not None and metrics.first_audio_ms is not None  # type: ignore[attr-defined]
    assert metrics.total_ms >= metrics.first_text_ms  # type: ignore[attr-defined]
    await session.close()


async def test_replaces_a_pipeline_that_stopped_by_itself(fake_provider: FakeProvider) -> None:
    outbox = Outbox()
    session = new_session(outbox)
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

    assert ResponseEnd(id="q2", reason="complete") in answer
    assert any(m.type == "response.delta" for m in answer)  # type: ignore[attr-defined]
    assert session._conversation is not stopped
    request = fake_provider.last_request("/v1/chat/completions")
    assert "remember me" in str(request.body), "the history carries over"
    await session.close()
