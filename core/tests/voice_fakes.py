"""Stand-ins for the speech models and the voice detector, so voice tests need no GPU."""

from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
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
    """Says the student speaks for the first `speaking` chunks, then that they are quiet."""

    def __init__(self, speaking: int = 3) -> None:
        self.speaking = speaking
        self.resets = 0
        self._chunks = 0

    def set_params(self, params: VADParams) -> None:
        self.resets += 1
        self._chunks = 0

    async def analyze_audio(self, buffer: bytes) -> VADState:
        self._chunks += 1
        return VADState.SPEAKING if self._chunks <= self.speaking else VADState.QUIET


def chunk(seconds: float = 0.032) -> bytes:
    """Microphone audio of this length, as the desktop sends it."""
    return b"\x00\x00" * int(16_000 * seconds)


async def ready_engine(folder: Path, whisper: FakeWhisper | None = None) -> VoiceEngine:
    engine = VoiceEngine(
        folder,
        check=lambda: None,
        downloader=lambda folder, *, progress: None,
        loader=lambda folder: SpeechModels(whisper=whisper or FakeWhisper(), kokoro=None),
    )
    engine.start()
    await engine.wait()
    return engine


def types(messages: Iterable[Any]) -> list[str]:
    return [message.type for message in messages]
