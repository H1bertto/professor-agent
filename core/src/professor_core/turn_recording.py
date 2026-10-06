"""Development helper: saves what the student said in each question, to tune turn detection.

It is off unless PROFESSOR_CORE_RECORD_TURNS names a folder. The recordings stay on this computer.
"""

import os
import wave
from collections.abc import Mapping
from datetime import datetime
from pathlib import Path

import numpy as np
from loguru import logger

from professor_core.protocol import MICROPHONE_SAMPLE_RATE


def recordings_folder(env: Mapping[str, str] = os.environ) -> Path | None:
    folder = env.get("PROFESSOR_CORE_RECORD_TURNS")
    return Path(folder) if folder else None


def save_turn(folder: Path, audio: np.ndarray, reason: str) -> Path:
    """Writes float samples between -1 and 1 as a 16 kHz mono WAV file."""
    folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    path = folder / f"{stamp}-{reason}.wav"
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(MICROPHONE_SAMPLE_RATE)
        file.writeframes(pcm.tobytes())
    logger.info(f"Saved the question audio to {path}")
    return path
