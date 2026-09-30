"""Phase 3 spike: how should the teacher say English words inside a Portuguese answer?

Kokoro speaks each voice best in its own language. The teacher marks English words with
<en>...</en>, so the text-to-speech can pronounce them in English. This script renders the same
sentences in a few ways, so we can listen and pick one:

- 0-baseline: everything with Portuguese pronunciation, what happens without the spans;
- A-same-voice-per-span: the teacher's voice, each span rendered on its own and joined;
- B-switch-voice-per-span: the teacher's voice for Portuguese, an English voice for the spans;
- C-same-voice-one-pass: each span turned into phonemes in its own language, and the whole
  sentence rendered at once with the teacher's voice.

It also renders a fully English answer, as in English practice, with both voices.
"""

from __future__ import annotations

import argparse
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = Path(__file__).parent
DEFAULT_MODELS = HERE.parent / "speech-benchmark" / "models"
TEACHER_VOICE = "pf_dora"
ENGLISH_VOICE = "af_heart"
LANGUAGES = {"pt": "pt-br", "en": "en-us"}
SAMPLE_RATE = 24_000
# A short pause between spans rendered on their own, so they do not run into each other.
JOIN_PAUSE_S = 0.04


@dataclass(frozen=True)
class Sample:
    id: str
    # Each piece is (text, language), as the core gets them from the <en> markup.
    pieces: tuple[tuple[str, str], ...]


MIXED = (
    Sample(
        "1-since-for",
        (
            ("Boa pergunta! Em inglês, usamos", "pt"),
            ("since", "en"),
            ("para o ponto de partida, e", "pt"),
            ("for", "en"),
            ("para a duração.", "pt"),
        ),
    ),
    Sample(
        "2-correction",
        (
            ("Quase lá! O certo é", "pt"),
            ("I have lived here since 2020", "en"),
            (", e não", "pt"),
            ("I live here since 2020", "en"),
            (".", "pt"),
        ),
    ),
    Sample(
        "3-minimal-pair",
        (
            ("Tente dizer", "pt"),
            ("thought", "en"),
            ("e depois", "pt"),
            ("though", "en"),
            (". O som muda bastante.", "pt"),
        ),
    ),
)

ENGLISH_PRACTICE = (
    "Great job! You used the present perfect correctly. Can you give me another example?"
)


def text_of(sample: Sample) -> str:
    return " ".join(text for text, _ in sample.pieces).replace(" ,", ",").replace(" .", ".")


def render(kokoro: Kokoro, text: str, voice: str, lang: str) -> np.ndarray:
    audio, _ = kokoro.create(text, voice=voice, lang=LANGUAGES[lang])
    return audio


def join(parts: list[np.ndarray]) -> np.ndarray:
    pause = np.zeros(int(JOIN_PAUSE_S * SAMPLE_RATE), dtype=np.float32)
    joined: list[np.ndarray] = []
    for index, part in enumerate(parts):
        if index:
            joined.append(pause)
        joined.append(part)
    return np.concatenate(joined)


def variants(kokoro: Kokoro, sample: Sample) -> dict[str, Callable[[], np.ndarray]]:
    # Punctuation alone has nothing to say when rendered on its own.
    speakable = [(text, lang) for text, lang in sample.pieces if text.strip(" .,")]

    def one_pass() -> np.ndarray:
        phonemes = " ".join(
            kokoro.tokenizer.phonemize(text, LANGUAGES[lang]).strip()
            for text, lang in sample.pieces
        )
        return kokoro.create(phonemes, voice=TEACHER_VOICE, is_phonemes=True)[0]

    return {
        "0-baseline": lambda: render(kokoro, text_of(sample), TEACHER_VOICE, "pt"),
        "A-same-voice-per-span": lambda: join(
            [render(kokoro, text, TEACHER_VOICE, lang) for text, lang in speakable]
        ),
        "B-switch-voice-per-span": lambda: join(
            [
                render(kokoro, text, TEACHER_VOICE if lang == "pt" else ENGLISH_VOICE, lang)
                for text, lang in speakable
            ]
        ),
        "C-same-voice-one-pass": one_pass,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--models", type=Path, default=DEFAULT_MODELS)
    parser.add_argument("--output", type=Path, default=HERE / "output")
    args = parser.parse_args()

    kokoro = Kokoro(str(args.models / "kokoro-v1.0.onnx"), str(args.models / "voices-v1.0.bin"))
    args.output.mkdir(parents=True, exist_ok=True)
    render(kokoro, "Olá.", TEACHER_VOICE, "pt")  # Warm up, so the timings are fair.

    print("| File | Audio (s) | Synthesis (s) |")
    print("|---|---|---|")

    def save(name: str, make: Callable[[], np.ndarray]) -> None:
        start = time.perf_counter()
        audio = make()
        elapsed = time.perf_counter() - start
        sf.write(args.output / f"{name}.wav", audio, SAMPLE_RATE)
        print(f"| {name}.wav | {len(audio) / SAMPLE_RATE:.2f} | {elapsed:.2f} |")

    for sample in MIXED:
        for variant, make in variants(kokoro, sample).items():
            save(f"{sample.id}__{variant}", make)

    for voice in (TEACHER_VOICE, ENGLISH_VOICE):
        save(
            f"4-english-practice__{voice}",
            lambda voice=voice: render(kokoro, ENGLISH_PRACTICE, voice, "en"),
        )


if __name__ == "__main__":
    main()
