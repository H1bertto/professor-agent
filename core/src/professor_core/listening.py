"""Hears a spoken question: collects microphone audio until the student stops, then turns it
into text with faster-whisper.

This runs next to the conversation pipeline rather than inside it: the text it hears goes to
the same conversation as a typed question. With the hotkey, the student starts each question.
In conversation mode, `ConversationWatch` finds the start of each turn on an open microphone.
"""

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol

import numpy as np
from pipecat.audio.turn.base_turn_analyzer import EndOfTurnState
from pipecat.audio.vad.vad_analyzer import VADParams, VADState

from professor_core.protocol import MICROPHONE_SAMPLE_RATE, SpokenLanguage

ListenEndReason = Literal["silence", "stopped", "too_long", "cancelled"]

# The voice detector reports a pause this short, and then Smart Turn judges whether the student
# finished. With a real voice it never took a thinking pause for an ending (spikes/smart-turn).
PAUSE_S = 0.2
# Without a clear ending, the question ends after this much silence.
MAX_SILENCE_S = 3.0
# Stop waiting when nothing that sounds like speech arrives for this long.
NO_SPEECH_TIMEOUT_S = 8.0
MAX_LISTEN_S = 30.0
# Language detection is wrong too often on less audio than this, as the phase 0 spike found.
SHORT_AUDIO_S = 1.0
# Whisper invents words for silence and noise. Segments it rates this likely to be silence go.
MAX_NO_SPEECH_PROB = 0.6
# The English words that help Whisper hear a Portuguese question: the most recent ones, and only
# short ones, so the prompt stays a Portuguese sentence.
MAX_HINTS = 20
MAX_HINT_WORDS = 3
VAD_PARAMS = VADParams(stop_secs=PAUSE_S)
# In conversation mode a turn keeps the audio from just before the detector heard speech, so its
# first syllable is not lost.
EARLIER_S = 0.5 + VAD_PARAMS.start_secs
# Whisper writes these for noise or silence, after the subtitles it learned from.
_HALLUCINATIONS = frozenset(
    [
        "legendas pela comunidade amara.org",
        "obrigado por assistir",
        "inscreva-se no canal",
        "thank you for watching",
        "thanks for watching",
        "subtitles by the amara.org community",
    ]
)


class VoiceDetector(Protocol):
    def set_params(self, params: VADParams) -> None: ...

    async def analyze_audio(self, buffer: bytes) -> VADState: ...


class TurnJudge(Protocol):
    """Pipecat's turn analyzer: whether a pause ends the student's turn."""

    def clear(self) -> None: ...

    def append_audio(self, buffer: bytes, is_speech: bool) -> EndOfTurnState: ...

    async def analyze_end_of_turn(self) -> tuple[EndOfTurnState, Any]: ...


def smart_turn_judge() -> TurnJudge:
    """Smart Turn v3, which comes with Pipecat and runs on the CPU in about 140 ms a check."""
    from pipecat.audio.turn.smart_turn.base_smart_turn import SmartTurnParams
    from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3

    judge = LocalSmartTurnAnalyzerV3(
        sample_rate=MICROPHONE_SAMPLE_RATE, params=SmartTurnParams(stop_secs=MAX_SILENCE_S)
    )
    # Inside a Pipecat pipeline the transport sets the rate. Out here it stays 0 until set.
    judge.set_sample_rate(MICROPHONE_SAMPLE_RATE)
    judge.update_vad_start_secs(VAD_PARAMS.start_secs)
    return judge


def is_speech(state: VADState) -> bool:
    return state in (VADState.STARTING, VADState.SPEAKING)


class Listening:
    """One spoken question in progress."""

    def __init__(
        self,
        question_id: str,
        detector: VoiceDetector,
        judge: TurnJudge,
        *,
        earlier: Sequence[tuple[bytes, bool]] = (),
    ) -> None:
        """`earlier` is the audio just before the student started, with whether each chunk was
        speech. Conversation mode passes it, and the detector, which already heard the start,
        keeps its state. Otherwise each question starts the detector afresh."""
        self.id = question_id
        self._detector = detector
        self._judge = judge
        self._chunks: list[bytes] = []
        self._bytes = 0
        self._heard_speech = bool(earlier)
        self._last_state = VADState.SPEAKING if earlier else VADState.QUIET
        if not earlier:
            detector.set_params(VAD_PARAMS)
        judge.clear()
        for pcm, speech in earlier:
            self._add(pcm)
            judge.append_audio(pcm, speech)

    @property
    def seconds(self) -> float:
        return self._bytes / 2 / MICROPHONE_SAMPLE_RATE

    @property
    def heard_speech(self) -> bool:
        return self._heard_speech

    async def feed(self, pcm: bytes) -> ListenEndReason | None:
        """Adds microphone audio, and says why listening should end, if it should."""
        self._add(pcm)
        state = await self._detector.analyze_audio(pcm)
        if state in (VADState.SPEAKING, VADState.STOPPING):
            self._heard_speech = True
        # The first quiet chunk after speech is a pause, which the judge looks at once.
        paused = (
            self._heard_speech and state == VADState.QUIET and self._last_state != VADState.QUIET
        )
        self._last_state = state
        # The judge also ends the turn by itself after MAX_SILENCE_S without speech.
        if self._judge.append_audio(pcm, is_speech(state)) == EndOfTurnState.COMPLETE:
            return "silence"
        if paused:
            verdict, _ = await self._judge.analyze_end_of_turn()
            if verdict == EndOfTurnState.COMPLETE:
                return "silence"
        if not self._heard_speech and self.seconds >= NO_SPEECH_TIMEOUT_S:
            return "silence"
        if self.seconds >= MAX_LISTEN_S:
            return "too_long"
        return None

    def audio(self) -> np.ndarray:
        """The whole question as float samples between -1 and 1, as Whisper expects."""
        samples = np.frombuffer(b"".join(self._chunks), dtype="<i2")
        return samples.astype(np.float32) / 32768.0

    def _add(self, pcm: bytes) -> None:
        self._chunks.append(pcm)
        self._bytes += len(pcm)


class ConversationWatch:
    """In conversation mode, waits on the open microphone for the student to start speaking."""

    def __init__(self, detector: VoiceDetector) -> None:
        detector.set_params(VAD_PARAMS)
        self._detector = detector
        self._recent: list[tuple[bytes, bool]] = []
        self._recent_bytes = 0

    async def feed(self, pcm: bytes) -> list[tuple[bytes, bool]] | None:
        """The audio of the turn so far once the student starts speaking, or `None` before."""
        state = await self._detector.analyze_audio(pcm)
        self._recent.append((pcm, is_speech(state)))
        self._recent_bytes += len(pcm)
        if state == VADState.SPEAKING:
            earlier, self._recent, self._recent_bytes = self._recent, [], 0
            return earlier
        while self._recent_bytes / 2 / MICROPHONE_SAMPLE_RATE > EARLIER_S and len(self._recent) > 1:
            self._recent_bytes -= len(self._recent.pop(0)[0])
        return None


@dataclass(frozen=True)
class Heard:
    text: str
    lang: SpokenLanguage


def pick_language(
    whisper: Any,
    audio: np.ndarray,
    spoken_language: Literal["auto", "pt", "en"],
    last_language: SpokenLanguage,
) -> SpokenLanguage:
    """The language set by the student, or the likelier of Portuguese and English."""
    if spoken_language != "auto":
        return spoken_language
    if len(audio) / MICROPHONE_SAMPLE_RATE < SHORT_AUDIO_S:
        return last_language
    _, _, probabilities = whisper.detect_language(audio)
    scores = dict(probabilities)
    return "en" if scores.get("en", 0.0) > scores.get("pt", 0.0) else "pt"


def portuguese_prompt(english_words: Iterable[str]) -> str | None:
    """A Portuguese sentence that names the English words of the conversation, if there are any.

    English words said inside Portuguese come out mangled: "since" became "SimCe". Naming them
    helps, but only inside a Portuguese sentence. As a bare list of English phrases, through
    Whisper's hotwords, they made Whisper translate the whole question into English.
    """
    short = [words for words in english_words if len(words.split()) <= MAX_HINT_WORDS]
    recent = list(dict.fromkeys(reversed(short)))[:MAX_HINTS]
    if not recent:
        return None
    # In the order they came up, so the latest are nearest the question. The other way round,
    # Whisper heard "since e for" as "Cincy e Four".
    words = ", ".join(reversed(recent))
    return f"Aluno brasileiro estudando inglês, usando palavras como {words}."


def transcribe(
    whisper: Any,
    audio: np.ndarray,
    *,
    spoken_language: Literal["auto", "pt", "en"],
    last_language: SpokenLanguage,
    english_words: Iterable[str] = (),
) -> Heard:
    """What the student said. Blocks while Whisper runs, so call it from a thread."""
    lang = pick_language(whisper, audio, spoken_language, last_language)
    segments, _ = whisper.transcribe(
        audio,
        language=lang,
        beam_size=1,
        vad_filter=True,
        condition_on_previous_text=False,
        initial_prompt=portuguese_prompt(english_words) if lang == "pt" else None,
    )
    text = " ".join(
        segment.text.strip() for segment in segments if segment.no_speech_prob <= MAX_NO_SPEECH_PROB
    ).strip()
    return Heard(text="" if is_hallucination(text) else text, lang=lang)


def is_hallucination(text: str) -> bool:
    """Words Whisper writes for noise, such as the credits of the subtitles it learned from."""
    return re.sub(r"[^\w.\- ]", "", text.lower()).strip(" .") in _HALLUCINATIONS
