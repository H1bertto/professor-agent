import asyncio
import wave
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from fake_provider import EMPTY_MODEL, SLOW_MODEL, FakeProvider
from loguru import logger
from pipecat.audio.vad.vad_analyzer import VADState
from voice_fakes import (
    FakeJudge,
    FakeKokoro,
    FakeWhisper,
    ScriptedDetector,
    chunk,
    ready_engine,
    types,
)

from professor_core.protocol import (
    VOICE_OFF,
    Configure,
    ConversationStart,
    ConversationStop,
    ListenEnd,
    ListenStart,
    ListenStop,
    Message,
    PersonaConfig,
    ProviderConfig,
    ResponseCancel,
    ResponseEnd,
    SpeechEnd,
    SpeechHeard,
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
    options.setdefault("judge_factory", FakeJudge)
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
        enabled=True,
        speak_answers=True,
        spoken_language="auto",
        english_voice="teacher",
        teacher_voice="dora",
        native_voice="heart",
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
    enabled=True,
    speak_answers=False,
    spoken_language="auto",
    english_voice="teacher",
    teacher_voice="dora",
    native_voice="heart",
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


async def test_saves_each_question_while_developing(
    fake_provider: FakeProvider, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    folder = tmp_path / "turns"
    monkeypatch.setenv("PROFESSOR_CORE_RECORD_TURNS", str(folder))
    session, outbox = await listening_session(fake_provider, tmp_path)
    await session.handle(ListenStart(id="v1"))
    for _ in range(4):
        await session.handle_audio(chunk())
    await outbox.answer("v1")

    async with asyncio.timeout(5):
        while not list(folder.glob("*.wav")):
            await asyncio.sleep(0.02)
    [saved] = list(folder.glob("*.wav"))
    assert saved.name.endswith("-silence.wav")
    with wave.open(str(saved)) as file:
        assert (file.getframerate(), file.getnframes()) == (16_000, 4 * 512)
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


async def speaking_behind_the_text(
    fake: FakeProvider, folder: Path
) -> tuple[Session, Outbox, FakeKokoro]:
    """A session whose answer text is done while the teacher still speaks it."""
    # The first sentence plays, and the second one waits for Kokoro.
    kokoro = FakeKokoro(hold_from=1)
    engine = await ready_engine(folder, kokoro=kokoro)
    outbox = Outbox()

    async def send_audio(frame: bytes) -> None:
        pass

    session = new_session(
        outbox, send_audio=send_audio, voice=engine, detector_factory=ScriptedDetector
    )
    speaking = VOICE_ON.model_copy(update={"speak_answers": True})
    await session.handle(configure(fake).model_copy(update={"voice": speaking}))
    await session.handle(UserText(id="q1", text="since vs for?"))
    await outbox.until("q1", "speech.segment")
    await outbox.answer("q1")
    return session, outbox, kokoro


async def test_cancel_stops_speech_that_outlives_the_text(
    fake_provider: FakeProvider, tmp_path: Path
) -> None:
    session, outbox, kokoro = await speaking_behind_the_text(fake_provider, tmp_path)
    await session.handle(ResponseCancel(id="q1"))
    kokoro.release.set()

    sent = await outbox.until("q1", "speech.end")
    assert SpeechEnd(id="q1", reason="cancelled") in sent
    await session.close()


async def test_a_new_question_stops_the_last_answers_speech(
    fake_provider: FakeProvider, tmp_path: Path
) -> None:
    session, outbox, kokoro = await speaking_behind_the_text(fake_provider, tmp_path)
    await session.handle(ListenStart(id="v2"))
    kokoro.release.set()

    sent = await outbox.until("q1", "speech.end")
    assert SpeechEnd(id="q1", reason="cancelled") in sent
    await session.close()


async def test_says_so_when_the_answer_comes_back_empty(fake_provider: FakeProvider) -> None:
    outbox = Outbox()
    session = new_session(outbox)
    empty = configure(fake_provider)
    assert empty.provider is not None
    empty = empty.model_copy(
        update={"provider": empty.provider.model_copy(update={"model": EMPTY_MODEL})}
    )
    await session.handle(empty)
    await session.handle(UserText(id="q1", text="since vs for?"))

    warnings: list[str] = []
    sink = logger.add(lambda message: warnings.append(str(message)), level="WARNING")
    try:
        answer = await outbox.answer("q1")
    finally:
        logger.remove(sink)
    errors = [m for m in answer if m.type == "error"]  # type: ignore[attr-defined]
    assert [e.code for e in errors] == ["provider_unavailable"]  # type: ignore[attr-defined]
    assert "empty" in errors[0].message  # type: ignore[attr-defined]
    # The log tells what came back, never the text itself.
    [warning] = [w for w in warnings if "came back empty" in w]
    assert "8 characters of text and tags, finish reason stop" in warning
    assert answer[-1] == ResponseEnd(id="q1", reason="error")
    await session.close()


async def test_speaks_with_the_voices_in_the_settings(
    fake_provider: FakeProvider, tmp_path: Path
) -> None:
    kokoro = FakeKokoro()
    engine = await ready_engine(tmp_path, kokoro=kokoro)
    outbox = Outbox()

    async def send_audio(frame: bytes) -> None:
        pass

    session = new_session(outbox, send_audio=send_audio, voice=engine)
    voice = VOICE_ON.model_copy(update={"speak_answers": True, "teacher_voice": "alex"})
    await session.handle(configure(fake_provider).model_copy(update={"voice": voice}))
    await session.handle(UserText(id="q1", text="Qual a diferença entre since e for?"))

    await outbox.until("q1", "speech.end")
    assert {call["voice"] for call in kokoro.calls} == {"pm_alex"}
    await session.close()


QUIET, SPEAKING = VADState.QUIET, VADState.SPEAKING


async def conversation_session(
    fake: FakeProvider, folder: Path, script: list[VADState], whisper: FakeWhisper | None = None
) -> tuple[Session, Outbox]:
    engine = await ready_engine(folder, whisper=whisper)
    outbox = Outbox()
    detector = ScriptedDetector(script=script)
    session = new_session(outbox, voice=engine, detector_factory=lambda: detector)
    await session.handle(configure(fake).model_copy(update={"voice": VOICE_ON}))
    await session.handle(ConversationStart())
    return session, outbox


async def test_conversation_mode_finds_a_turn_and_answers_it(
    fake_provider: FakeProvider, tmp_path: Path
) -> None:
    script = [QUIET] * 5 + [SPEAKING] * 3 + [QUIET]
    session, outbox = await conversation_session(fake_provider, tmp_path, script)
    for _ in range(5):
        await session.handle_audio(chunk())
    assert not [m for m in outbox.messages if m.type == "turn.start"]  # type: ignore[attr-defined]

    for _ in range(4):
        await session.handle_audio(chunk())
    [turn] = [m for m in outbox.messages if m.type == "turn.start"]  # type: ignore[attr-defined]
    answer = await outbox.answer(turn.id)  # type: ignore[attr-defined]

    assert types(answer)[:4] == ["turn.start", "listen.end", "transcript", "response.start"]
    assert ResponseEnd(id=turn.id, reason="complete") in answer  # type: ignore[attr-defined]
    metrics = (await outbox.until(turn.id, "turn.metrics"))[-1]  # type: ignore[attr-defined]
    # The turn keeps the quiet audio just before the student spoke.
    assert metrics.listened_ms > 4 * 32  # type: ignore[attr-defined]
    await session.close()


async def test_a_turn_without_words_ends_quietly_as_no_speech(
    fake_provider: FakeProvider, tmp_path: Path
) -> None:
    script = [SPEAKING] * 2 + [QUIET]
    session, outbox = await conversation_session(
        fake_provider, tmp_path, script, whisper=FakeWhisper(text="")
    )
    for _ in range(3):
        await session.handle_audio(chunk())
    [turn] = [m for m in outbox.messages if m.type == "turn.start"]  # type: ignore[attr-defined]

    sent = await outbox.until(turn.id, "error")  # type: ignore[attr-defined]
    assert types(sent) == ["turn.start", "listen.end", "error"]
    assert sent[-1].code == "no_speech"  # type: ignore[attr-defined]
    await session.close()


async def test_stopping_conversation_mode_cancels_the_turn_in_progress(
    fake_provider: FakeProvider, tmp_path: Path
) -> None:
    session, outbox = await conversation_session(fake_provider, tmp_path, [SPEAKING])
    await session.handle_audio(chunk())
    [turn] = [m for m in outbox.messages if m.type == "turn.start"]  # type: ignore[attr-defined]
    await session.handle(ConversationStop())
    await session.handle_audio(chunk())

    assert outbox.messages[-1] == ListenEnd(id=turn.id, reason="cancelled")  # type: ignore[attr-defined]
    assert [m.type for m in outbox.messages].count("turn.start") == 1  # type: ignore[attr-defined]
    await session.close()


async def test_conversation_mode_needs_voice(fake_provider: FakeProvider) -> None:
    outbox = Outbox()
    session = new_session(outbox)
    await session.handle(configure(fake_provider))
    await session.handle(ConversationStart())

    assert outbox.messages[-1].code == "voice_unavailable"  # type: ignore[attr-defined]
    assert outbox.messages[-1].id is None  # type: ignore[attr-defined]
    await session.close()


def assistant_history(fake: FakeProvider) -> list[str]:
    request = fake.last_request("/v1/chat/completions")
    return [m["content"] for m in request.body["messages"] if m["role"] == "assistant"]


async def test_the_history_keeps_only_what_the_student_heard(
    fake_provider: FakeProvider, tmp_path: Path
) -> None:
    session, outbox, kokoro = await speaking_behind_the_text(fake_provider, tmp_path)
    await session.handle(SpeechHeard(id="q1", parts=1, finished=False))
    await session.handle(ResponseCancel(id="q1"))
    kokoro.release.set()
    await session.handle(UserText(id="q2", text="E o for?"))
    await outbox.answer("q2")

    assert assistant_history(fake_provider) == ["Boa pergunta! [interrupted]"]
    await session.close()


async def test_an_answer_heard_to_the_end_stays_whole(
    fake_provider: FakeProvider, tmp_path: Path
) -> None:
    session, outbox, kokoro = await speaking_behind_the_text(fake_provider, tmp_path)
    await session.handle(SpeechHeard(id="q1", parts=1, finished=True))
    await session.handle(ResponseCancel(id="q1"))
    kokoro.release.set()
    await session.handle(UserText(id="q2", text="E o for?"))
    await outbox.answer("q2")

    [answer] = assistant_history(fake_provider)
    assert "ponto de partida" in answer and "[interrupted]" not in answer
    await session.close()


async def test_cutting_off_an_answer_while_its_text_streams(
    fake_provider: FakeProvider, tmp_path: Path
) -> None:
    engine = await ready_engine(tmp_path, kokoro=FakeKokoro())
    outbox = Outbox()

    async def send_audio(frame: bytes) -> None:
        pass

    session = new_session(outbox, send_audio=send_audio, voice=engine)
    message = configure(fake_provider)
    assert message.provider is not None
    slow = message.provider.model_copy(update={"model": SLOW_MODEL})
    speaking = VOICE_ON.model_copy(update={"speak_answers": True})
    await session.handle(message.model_copy(update={"provider": slow, "voice": speaking}))
    await session.handle(UserText(id="q1", text="since vs for?"))
    await outbox.until("q1", "speech.segment")
    await session.handle(SpeechHeard(id="q1", parts=1, finished=False))
    await session.handle(ResponseCancel(id="q1"))
    await session.handle(UserText(id="q2", text="E o for?"))
    await outbox.answer("q2")

    assert assistant_history(fake_provider) == ["Boa pergunta! [interrupted]"]
    await session.close()


async def test_speaking_over_the_teacher_in_conversation_mode(
    fake_provider: FakeProvider, tmp_path: Path
) -> None:
    kokoro = FakeKokoro(hold_from=1)
    engine = await ready_engine(tmp_path, kokoro=kokoro)
    outbox = Outbox()

    async def send_audio(frame: bytes) -> None:
        pass

    detector = ScriptedDetector(script=[SPEAKING] * 3 + [QUIET])
    session = new_session(
        outbox, send_audio=send_audio, voice=engine, detector_factory=lambda: detector
    )
    speaking = VOICE_ON.model_copy(update={"speak_answers": True})
    await session.handle(configure(fake_provider).model_copy(update={"voice": speaking}))
    await session.handle(UserText(id="q1", text="since vs for?"))
    await outbox.until("q1", "speech.segment")
    await outbox.answer("q1")
    await session.handle(SpeechHeard(id="q1", parts=1, finished=False))

    await session.handle(ConversationStart())
    for _ in range(4):
        await session.handle_audio(chunk())
    [turn] = [m for m in outbox.messages if m.type == "turn.start"]  # type: ignore[attr-defined]
    # The teacher goes on speaking until the turn turns out to be a question.
    await outbox.until(turn.id, "transcript")  # type: ignore[attr-defined]
    kokoro.release.set()

    assert SpeechEnd(id="q1", reason="cancelled") in await outbox.until("q1", "speech.end")
    await outbox.answer(turn.id)  # type: ignore[attr-defined]
    assert assistant_history(fake_provider) == ["Boa pergunta! [interrupted]"]
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
