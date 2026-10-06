"""Stand-ins for the speech models and the voice detector, so voice tests need no GPU."""

import threading
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from pipecat.audio.turn.base_turn_analyzer import EndOfTurnState
from pipecat.audio.vad.vad_analyzer import VADParams, VADState

from professor_core.speech_models import SpeechModels, VoiceEngine


@dataclass
class FakeSegment:
    text: str
    no_speech_prob: float = 0.1


@dataclass
class FakeWhisper:
    """Hears `text` in every question, and detects the language from `probabilities`."""

    text: str = "since vs for?"
    probabilities: tuple[tuple[str, float], ...] = (("pt", 0.8), ("en", 0.2))
    calls: list[dict[str, Any]] = field(default_factory=list)

    def detect_language(self, audio: np.ndarray) -> tuple[str, float, list[tuple[str, float]]]:
        best = max(self.probabilities, key=lambda item: item[1])
        return best[0], best[1], list(self.probabilities)

    def transcribe(self, audio: np.ndarray, **options: Any) -> tuple[Iterator[FakeSegment], None]:
        self.calls.append(options)
        return iter([FakeSegment(self.text)] if self.text else []), None


class ScriptedDetector:
    """Says the student speaks for the first `speaking` chunks, then that they are quiet.

    With `script`, it gives those states in order instead, and repeats the last one.
    """

    def __init__(self, speaking: int = 3, script: list[VADState] | None = None) -> None:
        self.speaking = speaking
        self.script = script
        self.resets = 0
        self._chunks = 0

    def set_params(self, params: VADParams) -> None:
        self.resets += 1
        self._chunks = 0

    async def analyze_audio(self, buffer: bytes) -> VADState:
        self._chunks += 1
        if self.script is not None:
            return self.script[min(self._chunks, len(self.script)) - 1]
        return VADState.SPEAKING if self._chunks <= self.speaking else VADState.QUIET


class FakeJudge:
    """Smart Turn stand-in: it says the student finished at each pause when `finished`, and
    ends the turn after `max_silence` quiet chunks in a row."""

    def __init__(self, finished: bool = True, max_silence: int = 1_000) -> None:
        self.finished = finished
        self.max_silence = max_silence
        self.pauses = 0
        self.speech_chunks = 0
        self._silence = 0

    def clear(self) -> None:
        self._silence = 0
        self.speech_chunks = 0

    def append_audio(self, buffer: bytes, is_speech: bool) -> EndOfTurnState:
        if is_speech:
            self.speech_chunks += 1
            self._silence = 0
            return EndOfTurnState.INCOMPLETE
        self._silence += 1
        if self.speech_chunks and self._silence >= self.max_silence:
            return EndOfTurnState.COMPLETE
        return EndOfTurnState.INCOMPLETE

    async def analyze_end_of_turn(self) -> tuple[EndOfTurnState, None]:
        self.pauses += 1
        verdict = EndOfTurnState.COMPLETE if self.finished else EndOfTurnState.INCOMPLETE
        return verdict, None


class FakeTokenizer:
    def phonemize(self, text: str, lang: str) -> str:
        return f"<{lang}:{text.strip()}>"


@dataclass
class FakeKokoro:
    """Renders 100 samples per character, and remembers each call.

    With `hold_from`, that call and the ones after it wait for `release`, so speech can still be
    running when a test acts.
    """

    calls: list[dict[str, Any]] = field(default_factory=list)
    tokenizer: FakeTokenizer = field(default_factory=FakeTokenizer)
    hold_from: int | None = None
    release: threading.Event = field(default_factory=threading.Event)

    def create(
        self, text: str, *, voice: str, lang: str = "en-us", is_phonemes: bool = False
    ) -> tuple[np.ndarray, int]:
        self.calls.append({"text": text, "voice": voice, "lang": lang, "is_phonemes": is_phonemes})
        if self.hold_from is not None and len(self.calls) > self.hold_from:
            self.release.wait(timeout=5)
        return np.full(len(text) * 100, 0.1, dtype=np.float32), 24_000


def chunk(seconds: float = 0.032) -> bytes:
    """Microphone audio of this length, as the desktop sends it."""
    return b"\x00\x00" * int(16_000 * seconds)


async def ready_engine(
    folder: Path, whisper: FakeWhisper | None = None, kokoro: FakeKokoro | None = None
) -> VoiceEngine:
    engine = VoiceEngine(
        folder,
        check=lambda: None,
        downloader=lambda folder, *, progress: None,
        loader=lambda folder: SpeechModels(whisper=whisper or FakeWhisper(), kokoro=kokoro),
    )
    engine.start()
    await engine.wait()
    return engine


def types(messages: Iterable[Any]) -> list[str]:
    return [message.type for message in messages]
