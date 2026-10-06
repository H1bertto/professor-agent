"""Serves one desktop connection: turns protocol messages into a conversation and back."""

import asyncio
import uuid
from collections import deque
from collections.abc import Awaitable, Callable, Coroutine
from dataclasses import dataclass
from typing import Any, Literal

from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer

from professor_core.conversation import (
    Conversation,
    ConversationEvent,
    ResponseFailed,
    ResponseFinished,
    ResponseStarted,
    ResponseText,
)
from professor_core.listening import (
    ConversationWatch,
    ListenEndReason,
    Listening,
    TurnJudge,
    VoiceDetector,
    smart_turn_judge,
    transcribe,
)
from professor_core.markup import MarkupEvent, MarkupParser, TextPiece
from professor_core.persona import build_system_prompt
from professor_core.protocol import (
    MICROPHONE_SAMPLE_RATE,
    ClientMessage,
    Configure,
    ConversationStart,
    ConversationStop,
    CoreMessage,
    ErrorMessage,
    ListenEnd,
    ListenStart,
    ListenStop,
    ProviderTest,
    ProviderTestResult,
    ResponseCancel,
    ResponseDelta,
    ResponseEmotion,
    ResponseEnd,
    ResponseStart,
    Segment,
    SpeechHeard,
    SpokenLanguage,
    Transcript,
    TurnMetrics,
    TurnStart,
    UserText,
    VoiceConfig,
    VoiceStatus,
)
from professor_core.providers import create_llm_service, describe_provider_error, list_models
from professor_core.speaking import SendAudio, Speaker, guess_language, voices_for
from professor_core.speech_models import VoiceEngine
from professor_core.turn_recording import recordings_folder, save_turn

Send = Callable[[CoreMessage], Awaitable[None]]
PROVIDER_TEST_TIMEOUT_S = 20.0
MAX_LOGGED_ERROR_LENGTH = 300
VOICE_UNAVAILABLE_MESSAGE = (
    "Voice is not ready. Turn it on in the settings and wait for the speech models."
)
NO_SPEECH_MESSAGE = "I did not hear anything. Try again, a little closer to the microphone."
EMPTY_ANSWER_MESSAGE = "The AI provider sent back an empty answer. Try asking again."
# English phrases from recent answers, which help Whisper hear them inside Portuguese.
MAX_ENGLISH_PHRASES = 30


@dataclass
class TurnClock:
    """When each step of one question and answer happened, in event loop seconds."""

    asked_at: float
    listened_ms: int | None = None
    transcribe_ms: int | None = None
    first_text_at: float | None = None

    def metrics(self, question_id: str, first_audio_at: float | None) -> TurnMetrics:
        def ms(start: float | None, end: float | None) -> int | None:
            return None if start is None or end is None else round((end - start) * 1000)

        return TurnMetrics(
            id=question_id,
            listened_ms=self.listened_ms,
            transcribe_ms=self.transcribe_ms,
            first_text_ms=ms(self.asked_at, self.first_text_at),
            first_audio_ms=ms(self.first_text_at, first_audio_at),
            total_ms=ms(self.asked_at, first_audio_at or self.first_text_at),
        )


def describe_turn(metrics: TurnMetrics) -> str:
    """The step times of a turn for the log, without anything the student said."""
    steps = [
        ("listened", metrics.listened_ms),
        ("transcribed in", metrics.transcribe_ms),
        ("first words after", metrics.first_text_ms),
        ("first speech after", metrics.first_audio_ms),
        ("total", metrics.total_ms),
    ]
    return ", ".join(f"{name} {value / 1000:.2f} s" for name, value in steps if value is not None)


def silero_detector() -> VoiceDetector:
    detector = SileroVADAnalyzer(sample_rate=MICROPHONE_SAMPLE_RATE)
    detector.set_sample_rate(MICROPHONE_SAMPLE_RATE)
    return detector


class Session:
    def __init__(
        self,
        send: Send,
        *,
        send_audio: SendAudio | None = None,
        voice: VoiceEngine | None = None,
        detector_factory: Callable[[], VoiceDetector] = silero_detector,
        judge_factory: Callable[[], TurnJudge] = smart_turn_judge,
    ) -> None:
        self._send = send
        self._send_audio = send_audio
        self._voice = voice
        self._speakers: dict[str, Speaker] = {}
        # Speech runs behind the text, so a finished answer can still be speaking.
        self._speaking_after_text: dict[str, Speaker] = {}
        # The language each question was asked in, which the answer is spoken in.
        self._question_languages: dict[str, SpokenLanguage] = {}
        self._clocks: dict[str, TurnClock] = {}
        self._detector_factory = detector_factory
        self._detector: VoiceDetector | None = None
        self._judge_factory = judge_factory
        self._judge: TurnJudge | None = None
        # Conversation mode: the open microphone, and the ids of the turns found on it.
        self._watch: ConversationWatch | None = None
        self._turns: set[str] = set()
        # How many parts of each answer's speech the student has started to hear.
        self._heard_parts: dict[str, int] = {}
        self._configuration: Configure | None = None
        self._conversation: Conversation | None = None
        self._parsers: dict[str, MarkupParser] = {}
        self._answer_pieces: dict[str, list[TextPiece]] = {}
        # How much text each answer brought from the provider, before the markup is taken out.
        self._answer_chars: dict[str, int] = {}
        self._tasks: set[asyncio.Task[None]] = set()
        # The desktop starts from "off", so only changes are worth sending.
        self._reported_voice = VoiceStatus(state="off")
        self._stop_voice_updates: Callable[[], None] | None = None
        self._listening: Listening | None = None
        # Questions that Whisper is turning into text, and the ones cancelled meanwhile.
        self._hearing: set[str] = set()
        self._abandoned: set[str] = set()
        self._last_language: SpokenLanguage = "pt"
        self._english_phrases: deque[str] = deque(maxlen=MAX_ENGLISH_PHRASES)

    async def handle(self, message: ClientMessage) -> None:
        if isinstance(message, Configure):
            await self._configure(message)
        elif isinstance(message, ProviderTest):
            self._in_background(self._test_provider(message))
        elif isinstance(message, UserText):
            self._hush()
            await self._ask(message)
        elif isinstance(message, ListenStart):
            self._hush()
            await self._listen_start(message)
        elif isinstance(message, ListenStop):
            if self._listening and self._listening.id == message.id:
                await self._end_listening("stopped")
        elif isinstance(message, ResponseCancel):
            await self._cancel(message.id)
        elif isinstance(message, ConversationStart):
            await self._conversation_start()
        elif isinstance(message, ConversationStop):
            await self._conversation_stop()
        elif isinstance(message, SpeechHeard):
            self._heard_parts[message.id] = message.parts

    async def handle_audio(self, pcm: bytes) -> None:
        """Microphone audio for the listening in progress, or for the open microphone."""
        listening = self._listening
        if listening is not None:
            reason = await listening.feed(pcm)
            if reason and self._listening is listening:
                await self._end_listening(reason)
            return
        watch = self._watch
        if watch is None or self._detector is None:
            return  # Frames can still arrive right after a listening ends.
        earlier = await watch.feed(pcm)
        if earlier is None or self._watch is not watch:
            return
        turn_id = str(uuid.uuid4())
        self._turns.add(turn_id)
        self._listening = Listening(turn_id, self._detector, self._turn_judge(), earlier=earlier)
        await self._send(TurnStart(id=turn_id))

    def _voice_ready(self) -> bool:
        voice_on = self._configuration is not None and self._configuration.voice.enabled
        return voice_on and self._voice is not None and self._voice.models is not None

    def _voice_problem(self, question_id: str | None) -> ErrorMessage:
        return ErrorMessage(
            id=question_id,
            code="voice_unavailable",
            message=self._reported_voice.message or VOICE_UNAVAILABLE_MESSAGE,
        )

    def _turn_judge(self) -> TurnJudge:
        if self._judge is None:
            self._judge = self._judge_factory()
        return self._judge

    async def _conversation_start(self) -> None:
        if not self._voice_ready():
            await self._send(self._voice_problem(None))
            return
        if self._detector is None:
            self._detector = self._detector_factory()
        self._watch = ConversationWatch(self._detector)

    async def _conversation_stop(self) -> None:
        self._watch = None
        if self._listening and self._listening.id in self._turns:
            await self._end_listening("cancelled")

    async def _listen_start(self, message: ListenStart) -> None:
        if not self._voice_ready():
            await self._send(self._voice_problem(message.id))
            await self._send(ListenEnd(id=message.id, reason="cancelled"))
            return
        if self._listening:
            await self._end_listening("cancelled")
        if self._detector is None:
            self._detector = self._detector_factory()
        self._listening = Listening(message.id, self._detector, self._turn_judge())

    async def _end_listening(self, reason: ListenEndReason) -> None:
        listening, self._listening = self._listening, None
        if listening is None:
            return
        await self._send(ListenEnd(id=listening.id, reason=reason))
        if reason == "cancelled":
            self._turns.discard(listening.id)
            return
        if folder := recordings_folder():
            self._in_background(asyncio.to_thread(save_turn, folder, listening.audio(), reason))
        if not listening.heard_speech:
            self._turns.discard(listening.id)
            await self._send(
                ErrorMessage(id=listening.id, code="no_speech", message=NO_SPEECH_MESSAGE)
            )
            return
        self._in_background(self._hear(listening))

    async def _hear(self, listening: Listening) -> None:
        """Turns the question into text, then asks it like a typed one."""
        models = self._voice.models if self._voice else None
        if models is None or self._configuration is None:
            return
        ended_at = asyncio.get_running_loop().time()
        self._hearing.add(listening.id)
        try:
            heard = await asyncio.to_thread(
                transcribe,
                models.whisper,
                listening.audio(),
                spoken_language=self._configuration.voice.spoken_language,
                last_language=self._last_language,
                english_words=list(self._english_phrases),
            )
        except Exception:
            logger.exception("Could not turn the question into text")
            await self._send(
                ErrorMessage(
                    id=listening.id, code="internal", message="Could not hear the question."
                )
            )
            return
        finally:
            self._hearing.discard(listening.id)
        # A cancel, or a new question, arrived while Whisper was working.
        abandoned = listening.id in self._abandoned
        self._abandoned.discard(listening.id)
        # With the hotkey, a new question replaces this one. In conversation mode the student just
        # went on speaking, and this question still gets its answer.
        replaced = self._listening is not None and listening.id not in self._turns
        self._turns.discard(listening.id)
        if abandoned or replaced:
            return
        if not heard.text:
            await self._send(
                ErrorMessage(id=listening.id, code="no_speech", message=NO_SPEECH_MESSAGE)
            )
            return
        self._last_language = heard.lang
        self._clocks[listening.id] = TurnClock(
            asked_at=ended_at,
            listened_ms=round(listening.seconds * 1000),
            transcribe_ms=round((asyncio.get_running_loop().time() - ended_at) * 1000),
        )
        await self._send(Transcript(id=listening.id, text=heard.text, lang=heard.lang))
        # A spoken question interrupts the teacher, even speech that runs after the text.
        self._hush()
        await self._ask(UserText(id=listening.id, text=heard.text), language=heard.lang)

    async def _cancel(self, question_id: str) -> None:
        if speaker := self._speaking_after_text.pop(question_id, None):
            speaker.stop()
            return
        if self._listening and self._listening.id == question_id:
            await self._end_listening("cancelled")
            return
        if question_id in self._hearing:
            self._abandoned.add(question_id)
        if self._conversation:
            await self._conversation.cancel(question_id)

    async def close(self) -> None:
        self._listening = None
        self._watch = None
        for speaker in self._speakers.values():
            speaker.stop()
        self._speakers.clear()
        self._hush()
        self._stop_following_voice()
        for task in self._tasks:
            task.cancel()
        conversation, self._conversation = self._conversation, None
        if conversation:
            await conversation.close()

    async def _configure(self, message: Configure) -> None:
        previous, self._configuration = self._configuration, message
        await self._apply_voice(message.voice)
        # Voice settings change often and do not affect the teacher, so they keep the pipeline.
        same_teacher = previous is not None and (previous.provider, previous.persona) == (
            message.provider,
            message.persona,
        )
        if not same_teacher or self._conversation is None or not self._conversation.alive:
            await self._restart_conversation()

    async def _apply_voice(self, voice: VoiceConfig) -> None:
        if not voice.enabled:
            self._stop_following_voice()
            await self._report_voice(VoiceStatus(state="off"))
            return
        if self._voice is None:
            await self._report_voice(
                VoiceStatus(state="unavailable", message="This core has no voice engine.")
            )
            return
        if self._stop_voice_updates is None:
            self._stop_voice_updates = self._voice.subscribe(self._report_voice)
        await self._report_voice(self._voice.status)
        self._voice.start()

    def _stop_following_voice(self) -> None:
        if self._stop_voice_updates:
            self._stop_voice_updates()
            self._stop_voice_updates = None

    async def _report_voice(self, status: VoiceStatus) -> None:
        if status != self._reported_voice:
            self._reported_voice = status
            await self._send(status)

    async def _restart_conversation(self) -> None:
        # A new provider or persona needs a new pipeline. The history carries over.
        previous, self._conversation = self._conversation, None
        history = previous.history if previous else []
        if previous:
            await previous.close()
        configuration = self._configuration
        if configuration is None or configuration.provider is None:
            return
        llm = await create_llm_service(
            configuration.provider, build_system_prompt(configuration.persona)
        )
        conversation = Conversation(llm, self._on_event, history=history)
        await conversation.start()
        self._conversation = conversation

    async def _ask(self, message: UserText, *, language: SpokenLanguage | None = None) -> None:
        self._question_languages[message.id] = language or self._typed_language(message.text)
        self._clocks.setdefault(message.id, TurnClock(asked_at=asyncio.get_running_loop().time()))
        if self._conversation is not None and not self._conversation.alive:
            # A pipeline that stopped by itself would swallow every question from now on.
            logger.warning("The conversation pipeline had stopped. Starting a new one.")
            await self._restart_conversation()
        if self._conversation is None:
            self._question_languages.pop(message.id, None)
            self._clocks.pop(message.id, None)
            await self._send(ResponseStart(id=message.id))
            await self._send(
                ErrorMessage(
                    id=message.id,
                    code="not_configured",
                    message="Choose an AI provider in the settings first.",
                )
            )
            await self._send(ResponseEnd(id=message.id, reason="error"))
            return
        await self._conversation.ask(message.id, message.text)

    async def _test_provider(self, message: ProviderTest) -> None:
        try:
            models = await asyncio.wait_for(
                list_models(message.provider), timeout=PROVIDER_TEST_TIMEOUT_S
            )
            result = ProviderTestResult(request_id=message.request_id, ok=True, models=models)
        except Exception as error:
            code, text = describe_provider_error(error)
            result = ProviderTestResult(
                request_id=message.request_id, ok=False, code=code, message=text
            )
        await self._send(result)

    async def _on_event(self, event: ConversationEvent) -> None:
        if isinstance(event, ResponseStarted):
            await self._start(event.id)
        elif isinstance(event, ResponseText):
            await self._start(event.id)
            clock = self._clocks.get(event.id)
            if clock and clock.first_text_at is None and event.text.strip():
                clock.first_text_at = asyncio.get_running_loop().time()
            self._answer_chars[event.id] = self._answer_chars.get(event.id, 0) + len(event.text)
            await self._send_markup(event.id, self._parsers[event.id].feed(event.text))
        elif isinstance(event, ResponseFinished):
            await self._end(event.id, event.reason)
        elif isinstance(event, ResponseFailed):
            code, text = describe_provider_error(event.error)
            # The provider's own message explains most failures. It never holds the API key.
            detail = str(event.error)[:MAX_LOGGED_ERROR_LENGTH]
            logger.warning(
                f"Answer {event.id} failed: {type(event.error).__name__} ({code}): {detail}"
            )
            await self._start(event.id)
            await self._send(ErrorMessage(id=event.id, code=code, message=text))
            await self._end(event.id, "error")

    async def _start(self, response_id: str) -> None:
        if response_id not in self._parsers:
            self._parsers[response_id] = MarkupParser()
            await self._send(ResponseStart(id=response_id))
            self._start_speaking(response_id)

    def _start_speaking(self, response_id: str) -> None:
        language = self._question_languages.pop(response_id, self._last_language)
        kokoro = self._voice.models.kokoro if self._voice and self._voice.models else None
        voice = self._configuration.voice if self._configuration else None
        if not (voice and voice.enabled and voice.speak_answers and kokoro and self._send_audio):
            return
        self._speakers[response_id] = Speaker(
            response_id,
            kokoro,
            main_language=language,
            english_voice=voice.english_voice,
            voices=voices_for(voice),
            send=self._send,
            send_audio=self._send_audio,
        )

    def _typed_language(self, text: str) -> SpokenLanguage:
        spoken = self._configuration.voice.spoken_language if self._configuration else "auto"
        if spoken != "auto":
            return spoken
        return guess_language(text) or self._last_language

    async def _end(
        self, response_id: str, reason: Literal["complete", "cancelled", "error"]
    ) -> None:
        await self._start(response_id)
        await self._send_markup(response_id, self._parsers.pop(response_id).finish())
        pieces = self._answer_pieces.pop(response_id, [])
        chars = self._answer_chars.pop(response_id, 0)
        if reason == "complete" and not any(piece.text.strip() for piece in pieces):
            # A provider can end an answer without a word. Saying nothing would leave the
            # student looking at the question, waiting for an answer that never comes.
            ending = self._conversation.last_ending if self._conversation else None
            how = f", {ending.describe()}" if ending else ""
            logger.warning(
                f"Answer {response_id} came back empty from the provider "
                f"({chars} characters of text and tags{how})"
            )
            await self._send(
                ErrorMessage(
                    id=response_id, code="provider_unavailable", message=EMPTY_ANSWER_MESSAGE
                )
            )
            reason = "error"
        self._remember_english(pieces)
        await self._send(ResponseEnd(id=response_id, reason=reason))
        clock = self._clocks.pop(response_id, None)
        speaker = self._speakers.pop(response_id, None)
        if speaker and reason != "complete":
            speaker.stop("cancelled" if reason == "cancelled" else "error")
        elif speaker:
            # Speech can run behind the text, so it ends on its own after the last sentence.
            speaker.finish()
            self._speaking_after_text[response_id] = speaker
            self._in_background(self._forget_when_quiet(response_id, speaker))
        if clock and reason == "complete":
            self._in_background(self._report_turn(response_id, clock, speaker))

    async def _forget_when_quiet(self, response_id: str, speaker: Speaker) -> None:
        await speaker.done()
        if self._speaking_after_text.get(response_id) is speaker:
            del self._speaking_after_text[response_id]

    def _hush(self) -> None:
        """A new question interrupts the teacher, even when the last answer's text is done."""
        for speaker in self._speaking_after_text.values():
            speaker.stop()
        self._speaking_after_text.clear()

    async def _report_turn(
        self, question_id: str, clock: TurnClock, speaker: Speaker | None
    ) -> None:
        if speaker:
            await speaker.done()
        metrics = clock.metrics(question_id, speaker.first_audio_at if speaker else None)
        logger.info(f"Turn {question_id[:8]}: {describe_turn(metrics)}")
        await self._send(metrics)

    def _remember_english(self, pieces: list[TextPiece]) -> None:
        """Keeps the English phrases of an answer. Spans can arrive split across pieces."""
        phrase: list[str] = []
        for piece in [*pieces, TextPiece(text="", lang=None)]:
            if piece.lang == "en":
                phrase.append(piece.text)
                continue
            text = "".join(phrase).strip()
            phrase = []
            if text and text not in self._english_phrases:
                self._english_phrases.append(text)

    async def _send_markup(self, response_id: str, events: list[MarkupEvent]) -> None:
        if speaker := self._speakers.get(response_id):
            speaker.add(event for event in events if isinstance(event, TextPiece))
        segments: list[Segment] = []
        for event in events:
            if isinstance(event, TextPiece):
                segments.append(Segment(text=event.text, lang=event.lang))
                self._answer_pieces.setdefault(response_id, []).append(event)
                continue
            if segments:
                await self._send(ResponseDelta(id=response_id, segments=segments))
                segments = []
            await self._send(ResponseEmotion(id=response_id, emotion=event.emotion))
        if segments:
            await self._send(ResponseDelta(id=response_id, segments=segments))

    def _in_background(self, work: Coroutine[Any, Any, None]) -> None:
        task = asyncio.create_task(work)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
