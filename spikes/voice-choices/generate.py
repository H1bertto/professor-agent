"""Samples of the Kokoro voices the settings could offer, to choose them by ear.

Writes WAV files to the folder given as the first argument, or to `output/`.
"""

import sys
import wave
from pathlib import Path

import numpy as np
from kokoro_onnx import Kokoro

from professor_core import speaking
from professor_core.speaking import Piece, Voices, render_sentence
from professor_core.speech_models import KOKORO_MODEL, KOKORO_VOICES, models_folder

TEACHERS = {"dora": "pf_dora", "alex": "pm_alex"}
# Each native English voice is heard after a teacher of the same kind.
NATIVE = {
    "heart": ("af_heart", "dora"),
    "bella": ("af_bella", "dora"),
    "michael": ("am_michael", "alex"),
    "fenrir": ("am_fenrir", "alex"),
    "puck": ("am_puck", "alex"),
    "adam": ("am_adam", "alex"),
}
ANSWER = [
    Piece("Boa pergunta! Usamos ", "pt"),
    Piece("since", "en"),
    Piece(" para o ponto de partida. Por exemplo: ", "pt"),
    Piece("I have lived here since 2020", "en"),
    Piece(".", "pt"),
]


def save(path: Path, samples: np.ndarray) -> None:
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(speaking.SPEECH_SAMPLE_RATE)
        file.writeframes(pcm.tobytes())


def speak(kokoro: Kokoro, teacher: str, native: str, english_voice: str) -> np.ndarray:
    voices = Voices(teacher=teacher, native=native)
    parts = render_sentence(kokoro, ANSWER, english_voice, voices)  # type: ignore[arg-type]
    return np.concatenate([part.samples for part in parts])


def main() -> None:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "output"
    output.mkdir(parents=True, exist_ok=True)
    folder = models_folder()
    kokoro = Kokoro(str(folder / KOKORO_MODEL), str(folder / KOKORO_VOICES))

    for name, voice in TEACHERS.items():
        path = output / f"1-teacher-{name}.wav"
        save(path, speak(kokoro, voice, "af_heart", "teacher"))
        print(path)
    for name, (voice, teacher) in NATIVE.items():
        path = output / f"2-native-{name}-with-{teacher}.wav"
        save(path, speak(kokoro, TEACHERS[teacher], voice, "native"))
        print(path)


if __name__ == "__main__":
    main()
