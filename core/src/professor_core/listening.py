"""Hears a spoken question: collects microphone audio until the student stops, then turns it
into text with faster-whisper.

Push-to-talk gives clear edges, so this runs next to the conversation pipeline rather than
inside it: the text it hears goes to the same conversation as a typed question.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, Literal, Protocol

import numpy as np
from pipecat.audio.vad.vad_analyzer import VADParams, VADState

from professor_core.protocol import MICROPHONE_SAMPLE_RATE, SpokenLanguage

ListenEndReason = Literal["silence", "stopped", "too_long", "cancelled"]

# A pause this long after speech ends the question.
SILENCE_AFTER_SPEECH_S = 0.8
# Stop waiting when nothing that sounds like speech arrives for this long.
NO_SPEECH_TIMEOUT_S = 8.0
MAX_LISTEN_S = 30.0
# Language detection is wrong too often on less audio than this, as the phase 0 spike found.
SHORT_AUDIO_S = 1.0
# Whisper invents words for silence and noise. Segments it rates this likely to be silence go.
MAX_NO_SPEECH_PROB = 0.6
VAD_PARAMS = VADParams(stop_secs=SILENCE_AFTER_SPEECH_S)


class VoiceDetector(Protocol):
    def set_params(self, params: VADParams) -> None: ...

    async def analyze_audio(self, buffer: bytes) -> VADState: ...


class Listening:
    """One spoken question in progress."""

    def __init__(self, question_id: str, detector: VoiceDetector) -> None:
        self.id = question_id
        self._detector = detector
        # New parameters also reset the detector, so each question starts fresh.
        detector.set_params(VAD_PARAMS)
        self._chunks: list[bytes] = []
        self._bytes = 0
        self._heard_speech = False

    @property
    def seconds(self) -> float:
        return self._bytes / 2 / MICROPHONE_SAMPLE_RATE

    @property
    def heard_speech(self) -> bool:
        return self._heard_speech

    async def feed(self, pcm: bytes) -> ListenEndReason | None:
        """Adds microphone audio, and says why listening should end, if it should."""
        self._chunks.append(pcm)
        self._bytes += len(pcm)
        state = await self._detector.analyze_audio(pcm)
        if state in (VADState.SPEAKING, VADState.STOPPING):
            self._heard_speech = True
        if self._heard_speech and state == VADState.QUIET:
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
    # English words said inside Portuguese come out mangled ("since" became "SimCe" in the
    # spike). The English words of the conversation so far help Whisper hear them.
    hotwords = " ".join(english_words) if lang == "pt" else ""
    segments, _ = whisper.transcribe(
        audio,
        language=lang,
        beam_size=1,
        vad_filter=True,
        condition_on_previous_text=False,
        hotwords=hotwords or None,
    )
    text = " ".join(
        segment.text.strip() for segment in segments if segment.no_speech_prob <= MAX_NO_SPEECH_PROB
    )
    return Heard(text=text.strip(), lang=lang)
