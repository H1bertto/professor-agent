"""Phase 0 spike: how fast are local speech-to-text and text-to-speech on this machine?

1. Kokoro (CPU) speaks Portuguese and English test sentences.
2. faster-whisper transcribes them, and we compare three ways to pick the language:
   forced (we know it), free auto-detection, and detection limited to the lesson languages.

The audio is synthetic and clean, so accuracy here is optimistic. The latency and memory
numbers are what this spike is about.
"""

from __future__ import annotations

import argparse
import os
import platform
import re
import site
import sys
import time
import unicodedata
import urllib.request
from dataclasses import dataclass
from importlib.metadata import version
from pathlib import Path

HERE = Path(__file__).parent
MODELS = HERE / "models"
OUTPUT = HERE / "output"
ECHO_SAMPLE = HERE.parent / "echo-cancellation" / "speech-sample.wav"

KOKORO_URL = (
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
)
KOKORO_FILES = ("kokoro-v1.0.onnx", "voices-v1.0.bin")
KOKORO_VOICES = {"pt": ("pf_dora", "pt-br"), "en": ("af_heart", "en-us")}
LESSON_LANGUAGES = ("pt", "en")


@dataclass(frozen=True)
class Sample:
    id: str
    language: str
    text: str


SAMPLES = (
    Sample("pt-greeting", "pt", "Oi, eu queria praticar inglês hoje."),
    Sample("pt-mixed", "pt", "Você pode me explicar a diferença entre since e for?"),
    Sample("pt-study", "pt", "Ontem eu estudei frações e ainda fiquei com dúvida."),
    Sample("pt-short", "pt", "Sim."),
    Sample("en-story", "en", "Yesterday I went to the market and bought some apples."),
    Sample("en-pronounce", "en", "How do you pronounce the word though?"),
    Sample("en-since", "en", "I have been living here since twenty twenty."),
    Sample("en-short", "en", "Yes."),
)
ECHO_SAMPLE_IDS = ("pt-greeting", "pt-mixed", "en-story", "en-pronounce")


def ensure_cuda_libraries_on_path() -> None:
    """ctranslate2 loads cuBLAS and cuDNN with dlopen, so they must be on LD_LIBRARY_PATH
    before the process starts. Re-run this script once with the pip-installed libs added."""
    if sys.platform != "linux" or os.environ.get("_SPEECH_BENCHMARK_LIBS") == "1":
        return
    lib_dirs = [
        str(Path(root) / "nvidia" / package / "lib")
        for root in site.getsitepackages()
        for package in ("cublas", "cudnn")
        if (Path(root) / "nvidia" / package / "lib").is_dir()
    ]
    env = dict(os.environ, _SPEECH_BENCHMARK_LIBS="1")
    env["LD_LIBRARY_PATH"] = os.pathsep.join(
        [*lib_dirs, env.get("LD_LIBRARY_PATH", "")]
    )
    os.execve(sys.executable, [sys.executable, *sys.argv], env)


def download_kokoro() -> None:
    MODELS.mkdir(exist_ok=True)
    for name in KOKORO_FILES:
        target = MODELS / name
        if not target.exists():
            print(f"Downloading {name}...", file=sys.stderr)
            urllib.request.urlretrieve(f"{KOKORO_URL}/{name}", target)


def normalize(text: str) -> list[str]:
    text = unicodedata.normalize("NFKC", text).lower()
    return re.sub(r"[^\w\s']", " ", text).split()


def word_error_rate(reference: str, hypothesis: str) -> float:
    ref, hyp = normalize(reference), normalize(hypothesis)
    previous = list(range(len(hyp) + 1))
    for i, ref_word in enumerate(ref, start=1):
        current = [i]
        for j, hyp_word in enumerate(hyp, start=1):
            cost = 0 if ref_word == hyp_word else 1
            current.append(
                min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
            )
        previous = current
    return previous[-1] / max(len(ref), 1)


def synthesize(report: list[str]) -> dict[str, Path]:
    import numpy as np
    import soundfile as sf
    from kokoro_onnx import Kokoro

    download_kokoro()
    OUTPUT.mkdir(exist_ok=True)

    started = time.perf_counter()
    kokoro = Kokoro(str(MODELS / KOKORO_FILES[0]), str(MODELS / KOKORO_FILES[1]))
    load_s = time.perf_counter() - started

    report += [
        "## Text-to-speech: Kokoro on CPU",
        "",
        f"Model load: {load_s:.2f} s",
        "",
        "| Sample | Voice | Audio (s) | Synthesis (s) | Real-time factor |",
        "|---|---|---|---|---|",
    ]
    paths: dict[str, Path] = {}
    clips: dict[str, tuple] = {}
    for index, sample in enumerate(SAMPLES):
        voice, lang = KOKORO_VOICES[sample.language]
        started = time.perf_counter()
        audio, sample_rate = kokoro.create(sample.text, voice=voice, lang=lang)
        synth_s = time.perf_counter() - started
        duration_s = len(audio) / sample_rate
        path = OUTPUT / f"{sample.id}.wav"
        sf.write(path, audio, sample_rate)
        paths[sample.id] = path
        clips[sample.id] = (audio, sample_rate)
        cold = " (first call)" if index == 0 else ""
        report.append(
            f"| {sample.id}{cold} | {voice} | {duration_s:.2f} | {synth_s:.2f} "
            f"| {synth_s / duration_s:.2f} |"
        )

    # A longer clip for the echo cancellation spike.
    sample_rate = clips[ECHO_SAMPLE_IDS[0]][1]
    pause = np.zeros(int(0.4 * sample_rate), dtype=np.float32)
    parts = [
        part for sample_id in ECHO_SAMPLE_IDS for part in (clips[sample_id][0], pause)
    ]
    ECHO_SAMPLE.parent.mkdir(exist_ok=True)
    sf.write(ECHO_SAMPLE, np.concatenate(parts), sample_rate, subtype="PCM_16")

    report += [
        "",
        "A real-time factor below 1 means the audio is generated faster than it plays.",
        "",
    ]
    return paths


def transcribe(
    report: list[str], paths: dict[str, Path], args: argparse.Namespace
) -> None:
    from faster_whisper import WhisperModel, decode_audio

    gpu = GpuMemory() if args.device == "cuda" else None
    before_mb = gpu.used_mb() if gpu else 0

    started = time.perf_counter()
    model = WhisperModel(
        args.model,
        device=args.device,
        compute_type=args.compute_type,
        download_root=str(MODELS / "whisper"),
    )
    load_s = time.perf_counter() - started
    model_mb = gpu.used_mb() - before_mb if gpu else 0

    audio = {sample.id: decode_audio(str(paths[sample.id])) for sample in SAMPLES}
    # Warm up so the first measured sample does not pay for CUDA kernel setup.
    list(model.transcribe(audio[SAMPLES[0].id], language="pt", beam_size=1)[0])

    def run(samples_audio, **options) -> tuple[str, float, object]:
        started = time.perf_counter()
        segments, info = model.transcribe(samples_audio, **options)
        text = " ".join(segment.text.strip() for segment in segments)
        return text, time.perf_counter() - started, info

    report += [
        f"## Speech-to-text: faster-whisper `{args.model}` on {args.device} ({args.compute_type})",
        "",
        f"Model load: {load_s:.2f} s (includes the download on the first run)",
    ]
    if gpu:
        report.append(f"GPU memory used by the model: {model_mb:.0f} MB")
    report += [
        "",
        (
            "| Sample | Forced, beam 1 (s) | Forced, beam 5 (s) | Auto-detect (s) | Auto pick | "
            "Limited to pt/en (s) | Limited pick | WER (limited) |"
        ),
        "|---|---|---|---|---|---|---|---|",
    ]

    peak_mb = model_mb
    for sample in SAMPLES:
        clip = audio[sample.id]
        _, beam1_s, _ = run(clip, language=sample.language, beam_size=1)
        _, beam5_s, _ = run(clip, language=sample.language, beam_size=5)
        _, auto_s, auto_info = run(clip, language=None, beam_size=1)

        started = time.perf_counter()
        _, _, all_probs = model.detect_language(clip)
        probs = dict(all_probs)
        picked = max(LESSON_LANGUAGES, key=lambda lang: probs.get(lang, 0.0))
        limited_text, _, _ = run(clip, language=picked, beam_size=1)
        limited_s = time.perf_counter() - started

        if gpu:
            peak_mb = max(peak_mb, gpu.used_mb() - before_mb)
        auto = f"{auto_info.language} ({auto_info.language_probability:.2f})"
        auto_mark = "" if auto_info.language == sample.language else " ✗"
        picked_mark = "" if picked == sample.language else " ✗"
        report.append(
            f"| {sample.id} | {beam1_s:.2f} | {beam5_s:.2f} | {auto_s:.2f} | {auto}{auto_mark} "
            f"| {limited_s:.2f} | {picked}{picked_mark} "
            f"| {word_error_rate(sample.text, limited_text):.2f} |"
        )
        print(f"  {sample.id}: {limited_text!r}", file=sys.stderr)

    if gpu:
        report += ["", f"Peak GPU memory for this process: {peak_mb:.0f} MB"]
    report.append("")


class GpuMemory:
    def __init__(self) -> None:
        import pynvml

        pynvml.nvmlInit()
        self._pynvml = pynvml
        self._handle = pynvml.nvmlDeviceGetHandleByIndex(0)

    def name(self) -> str:
        return self._pynvml.nvmlDeviceGetName(self._handle)

    def used_mb(self) -> float:
        return self._pynvml.nvmlDeviceGetMemoryInfo(self._handle).used / 1024**2


def environment(args: argparse.Namespace) -> list[str]:
    gpu = GpuMemory().name() if args.device == "cuda" else "not used"
    return [
        "# Speech benchmark",
        "",
        f"- Date: {time.strftime('%Y-%m-%d')}",
        f"- OS: {platform.platform()}",
        f"- CPU: {platform.processor() or platform.machine()} ({os.cpu_count()} threads)",
        f"- GPU: {gpu}",
        (
            f"- Python {platform.python_version()}, faster-whisper {version('faster-whisper')}, "
            f"ctranslate2 {version('ctranslate2')}, kokoro-onnx {version('kokoro-onnx')}, "
            f"onnxruntime {version('onnxruntime')}"
        ),
        "",
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--model", default="large-v3-turbo")
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu"])
    parser.add_argument("--compute-type", default="int8_float16")
    parser.add_argument(
        "--skip-tts", action="store_true", help="reuse the WAV files in output/"
    )
    args = parser.parse_args()

    if args.device == "cuda":
        ensure_cuda_libraries_on_path()

    report = environment(args)
    if args.skip_tts:
        paths = {sample.id: OUTPUT / f"{sample.id}.wav" for sample in SAMPLES}
    else:
        paths = synthesize(report)
    transcribe(report, paths, args)

    text = "\n".join(report)
    name = f"report-{args.model}-{args.device}.md"
    (OUTPUT / name).write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
