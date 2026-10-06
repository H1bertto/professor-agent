"""Does Smart Turn v3 tell a finished sentence from a pause in the middle of one?

Each case is rendered with Kokoro, followed by 0.2 s of silence, which is when a voice detector
would ask Smart Turn whether the student finished. Pass WAV files (16 kHz mono, 16-bit) to
classify your own recordings instead.
"""

import statistics
import sys
import time
import wave
from pathlib import Path

import numpy as np
from kokoro_onnx import Kokoro
from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3

from professor_core.speech_models import KOKORO_MODEL, KOKORO_VOICES, models_folder

RATE = 16_000
PAUSE_S = 0.2
VOICES = {"pt": ("pf_dora", "pt-br"), "en": ("af_heart", "en-us")}

# (id, language, what the student says, whether they finished)
CASES = [
    ("pt-question", "pt", "Qual é a diferença entre since e for?", True),
    ("pt-statement", "pt", "Ontem eu estudei frações com a minha irmã.", True),
    ("pt-mixed", "pt", "Eu queria saber como usar o present perfect.", True),
    ("pt-short", "pt", "Sim, entendi.", True),
    ("pt-conjunction", "pt", "Ontem eu fui ao mercado e", False),
    ("pt-preposition", "pt", "Eu queria saber se você pode me explicar o", False),
    ("pt-comma", "pt", "Quando eu era criança,", False),
    ("pt-filler", "pt", "Então, é...", False),
    ("en-question", "en", "What is the difference between since and for?", True),
    ("en-statement", "en", "I have lived here since twenty twenty.", True),
    ("en-short", "en", "Yes, I got it.", True),
    ("en-conjunction", "en", "Yesterday I went to the store and", False),
    ("en-preposition", "en", "I would like to know if you can explain the", False),
    ("en-comma", "en", "When I was a kid,", False),
    ("en-filler", "en", "So, um...", False),
]


def to_16k(samples: np.ndarray, rate: int) -> np.ndarray:
    if rate == RATE:
        return samples.astype(np.float32)
    positions = np.arange(0, len(samples), rate / RATE)
    return np.interp(positions, np.arange(len(samples)), samples).astype(np.float32)


def read_wav(path: Path) -> np.ndarray:
    """A recording up to the end of its last sound, since the pause is what Smart Turn judges."""
    with wave.open(str(path)) as file:
        rate, raw = file.getframerate(), file.readframes(file.getnframes())
    audio = to_16k(np.frombuffer(raw, "<i2").astype(np.float32) / 32768, rate)
    frame = RATE // 50
    loud = [
        index
        for index in range(0, len(audio) - frame, frame)
        if np.sqrt(np.mean(audio[index : index + frame] ** 2)) > 0.01
    ]
    return audio[: loud[-1] + frame] if loud else audio


def judge(analyzer: LocalSmartTurnAnalyzerV3, audio: np.ndarray) -> tuple[float, float]:
    """The probability that the speaker finished, and how long the model took in ms."""
    padded = np.concatenate([audio, np.zeros(int(PAUSE_S * RATE), dtype=np.float32)])
    start = time.perf_counter()
    result = analyzer._predict_endpoint(padded)
    return result["probability"], (time.perf_counter() - start) * 1000


def main() -> None:
    analyzer = LocalSmartTurnAnalyzerV3()
    analyzer.set_sample_rate(RATE)

    if len(sys.argv) > 1:
        for path in map(Path, sys.argv[1:]):
            probability, ms = judge(analyzer, read_wav(path))
            print(f"{path.name}: finished {probability:.2f} ({ms:.0f} ms)")
        return

    folder = models_folder()
    kokoro = Kokoro(str(folder / KOKORO_MODEL), str(folder / KOKORO_VOICES))
    judge(analyzer, np.zeros(RATE, dtype=np.float32))  # The first run is slower.

    print("| Case | Said | Finished? | Smart Turn | Right | ms |")
    print("|---|---|---|---|---|---|")
    right, times = 0, []
    for case_id, lang, text, finished in CASES:
        voice, kokoro_lang = VOICES[lang]
        samples, rate = kokoro.create(text, voice=voice, lang=kokoro_lang)
        probability, ms = judge(analyzer, to_16k(samples, rate))
        ok = (probability > 0.5) == finished
        right += ok
        times.append(ms)
        expected = "yes" if finished else "no"
        print(f"| {case_id} | {text} | {expected} | {probability:.2f} | {'yes' if ok else 'NO'} | {ms:.0f} |")
    print(f"\n{right} of {len(CASES)} right, median {statistics.median(times):.0f} ms per check")


if __name__ == "__main__":
    main()
