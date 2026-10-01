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

# A pause this long after speech ends the question. Students often stop to think in the middle
# of a sentence, and 0.8 s cut those sentences short. The hotkey still ends a question at once.
SILENCE_AFTER_SPEECH_S = 1.5
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
    )
    return Heard(text=text.strip(), lang=lang)
