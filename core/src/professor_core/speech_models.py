"""The local speech models: faster-whisper for speech-to-text and Kokoro for text-to-speech.

They are optional. Install them with `uv sync --extra voice`. The first time voice is turned on,
the core downloads about 2 GB of model files into the models folder, checks each one against
its SHA-256, and loads them once for every connection.
"""

import asyncio
import ctypes
import hashlib
import os
import site
import sys
import urllib.error
import urllib.request
from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from loguru import logger

from professor_core.protocol import VoiceStatus

VoiceState = Literal["off", "downloading", "loading", "ready", "unavailable", "error"]

_WHISPER_URL = (
    "https://huggingface.co/mobiuslabsgmbh/faster-whisper-large-v3-turbo/resolve/"
    "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf"
)
_KOKORO_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
WHISPER_FOLDER = "whisper-large-v3-turbo"
KOKORO_FOLDER = "kokoro-v1.0"
KOKORO_MODEL = f"{KOKORO_FOLDER}/kokoro-v1.0.onnx"
KOKORO_VOICES = f"{KOKORO_FOLDER}/voices-v1.0.bin"

DOWNLOAD_TIMEOUT_S = 60.0
DOWNLOAD_CHUNK_BYTES = 1024 * 1024
# The desktop shows the download in steps of a percent, so smaller changes are not reported.
PROGRESS_STEP = 0.01


@dataclass(frozen=True)
class ModelFile:
    url: str
    # Where the file goes, relative to the models folder.
    path: str
    size: int
    sha256: str


# The exact files, pinned to one revision and checked by SHA-256, so a changed or tampered
# download never runs.
MODEL_FILES = (
    ModelFile(
        f"{_WHISPER_URL}/config.json",
        f"{WHISPER_FOLDER}/config.json",
        2263,
        "b0253ea6c0d3bea6b1e19e91a02acfd3b53f4467362efcb5a3e6b16c9b3a9b7e",
    ),
    ModelFile(
        f"{_WHISPER_URL}/preprocessor_config.json",
        f"{WHISPER_FOLDER}/preprocessor_config.json",
        340,
        "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711",
    ),
    ModelFile(
        f"{_WHISPER_URL}/tokenizer.json",
        f"{WHISPER_FOLDER}/tokenizer.json",
        2710337,
        "297b13372ac43916285644fb9687add3cc62ee2a1adb60da3dc25cc94c1871fd",
    ),
    ModelFile(
        f"{_WHISPER_URL}/vocabulary.json",
        f"{WHISPER_FOLDER}/vocabulary.json",
        1068114,
        "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1",
    ),
    ModelFile(
        f"{_WHISPER_URL}/model.bin",
        f"{WHISPER_FOLDER}/model.bin",
        1617884929,
        "e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da",
    ),
    ModelFile(
        f"{_KOKORO_URL}/kokoro-v1.0.onnx",
        KOKORO_MODEL,
        325532387,
        "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
    ),
    ModelFile(
        f"{_KOKORO_URL}/voices-v1.0.bin",
        KOKORO_VOICES,
        28214398,
        "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
    ),
)


class ModelDownloadError(Exception):
    """A model file could not be downloaded, or did not match its checksum."""


def models_folder(env: Mapping[str, str] = os.environ) -> Path:
    if folder := env.get("PROFESSOR_CORE_MODELS"):
        return Path(folder)
    data = env.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(data) / "professor-agent" / "models"


def missing_files(folder: Path, files: Iterable[ModelFile] = MODEL_FILES) -> list[ModelFile]:
    """Files that are absent or have the wrong size. Checksums run only after a download."""
    return [
        file
        for file in files
        if not (folder / file.path).is_file() or (folder / file.path).stat().st_size != file.size
    ]


def download_models(
    folder: Path,
    files: Iterable[ModelFile] = MODEL_FILES,
    progress: Callable[[float], None] = lambda _: None,
    opener: Callable[..., Any] = urllib.request.urlopen,
) -> None:
    """Downloads the missing files. Raises ModelDownloadError when one fails."""
    missing = missing_files(folder, files)
    total = sum(file.size for file in missing) or 1
    done = 0
    for file in missing:
        target = folder / file.path
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_name(f"{target.name}.part")
        digest = hashlib.sha256()
        try:
            with (
                opener(file.url, timeout=DOWNLOAD_TIMEOUT_S) as response,
                partial.open("wb") as out,
            ):
                while chunk := response.read(DOWNLOAD_CHUNK_BYTES):
                    out.write(chunk)
                    digest.update(chunk)
                    done += len(chunk)
                    progress(min(done / total, 1.0))
        except (urllib.error.URLError, OSError) as error:
            partial.unlink(missing_ok=True)
            raise ModelDownloadError(f"Could not download {file.path}: {error}") from error
        if digest.hexdigest() != file.sha256:
            partial.unlink(missing_ok=True)
            raise ModelDownloadError(f"{file.path} did not match its checksum")
        partial.replace(target)
    progress(1.0)


def preload_cuda_libraries(roots: Iterable[str] | None = None) -> list[str]:
    """Loads cuBLAS and cuDNN from the pip wheels by full path.

    ctranslate2 opens them by name when it first uses the GPU, and the wheels are not on the
    library path. Once loaded, those lookups find them. Only Linux needs this.
    """
    if sys.platform != "linux":
        return []
    loaded: list[str] = []
    for root in roots if roots is not None else site.getsitepackages():
        for package in ("cublas", "cudnn"):
            folder = Path(root) / "nvidia" / package / "lib"
            if not folder.is_dir():
                continue
            for library in cuda_load_order(folder.glob("lib*.so*")):
                ctypes.CDLL(str(library), mode=ctypes.RTLD_GLOBAL)
                loaded.append(library.name)
    return loaded


def cuda_load_order(libraries: Iterable[Path]) -> list[Path]:
    """cuBLAS Lt before cuBLAS, and the main cuDNN library before its parts. No NVBLAS."""
    wanted = [path for path in libraries if not path.name.startswith("libnvblas")]
    first = ("libcublasLt.", "libcublas.", "libcudnn.")
    return sorted(
        wanted,
        key=lambda path: (
            next((i for i, prefix in enumerate(first) if path.name.startswith(prefix)), 3),
            path.name,
        ),
    )


def check_voice_support() -> str | None:
    """Why voice cannot run on this computer, or `None` when it can."""
    try:
        import ctranslate2
        import faster_whisper  # noqa: F401
        import kokoro_onnx  # noqa: F401
    except ImportError:
        return "Voice is not installed in the core. Run: uv sync --extra voice"
    preload_cuda_libraries()
    if ctranslate2.get_cuda_device_count() == 0:
        return "Voice needs an NVIDIA graphics card for now."
    return None


@dataclass(frozen=True)
class SpeechModels:
    whisper: Any
    kokoro: Any


def load_models(folder: Path) -> SpeechModels:
    from faster_whisper import WhisperModel
    from kokoro_onnx import Kokoro

    # int8 weights with float16 math: 1.1 GB of GPU memory, 0.25 s per sentence in the spike.
    whisper = WhisperModel(str(folder / WHISPER_FOLDER), device="cuda", compute_type="int8_float16")
    kokoro = Kokoro(str(folder / KOKORO_MODEL), str(folder / KOKORO_VOICES))
    return SpeechModels(whisper=whisper, kokoro=kokoro)


StatusListener = Callable[[VoiceStatus], Awaitable[None]]


class VoiceEngine:
    """Prepares the speech models once for the whole core, and tells listeners how it goes."""

    def __init__(
        self,
        folder: Path | None = None,
        *,
        check: Callable[[], str | None] = check_voice_support,
        downloader: Callable[..., None] = download_models,
        loader: Callable[[Path], SpeechModels] = load_models,
    ) -> None:
        self._folder = folder or models_folder()
        self._check = check
        self._downloader = downloader
        self._loader = loader
        self._status = VoiceStatus(state="off")
        self._models: SpeechModels | None = None
        self._task: asyncio.Task[None] | None = None
        self._listeners: set[StatusListener] = set()

    @property
    def status(self) -> VoiceStatus:
        return self._status

    @property
    def models(self) -> SpeechModels | None:
        return self._models

    def subscribe(self, listener: StatusListener) -> Callable[[], None]:
        self._listeners.add(listener)
        return lambda: self._listeners.discard(listener)

    def start(self) -> None:
        """Prepares the models in the background. It retries after a failure, and does nothing
        while preparing or once ready."""
        if self._task is None or (self._task.done() and self._status.state != "ready"):
            self._task = asyncio.create_task(self._prepare())

    async def wait(self) -> VoiceStatus:
        """Waits for the preparation started by `start` to finish."""
        if self._task:
            await asyncio.shield(self._task)
        return self._status

    async def _prepare(self) -> None:
        try:
            problem = await asyncio.to_thread(self._check)
            if problem:
                await self._set(VoiceStatus(state="unavailable", message=problem))
                return
            if missing_files(self._folder):
                await self._download()
            await self._set(VoiceStatus(state="loading"))
            self._models = await asyncio.to_thread(self._loader, self._folder)
        except ModelDownloadError as error:
            logger.warning(f"Speech models: {error}")
            await self._set(VoiceStatus(state="error", message=str(error)))
            return
        except Exception:
            logger.exception("Could not load the speech models")
            await self._set(VoiceStatus(state="error", message="Could not load the speech models."))
            return
        await self._set(VoiceStatus(state="ready"))

    async def _download(self) -> None:
        loop = asyncio.get_running_loop()
        reported = -PROGRESS_STEP

        def progress(fraction: float) -> None:
            # Runs on the download thread. Callbacks keep their order on the event loop.
            nonlocal reported
            if fraction - reported >= PROGRESS_STEP or fraction == 1.0:
                reported = fraction
                status = VoiceStatus(state="downloading", progress=round(fraction, 3))
                asyncio.run_coroutine_threadsafe(self._set(status), loop)

        await self._set(VoiceStatus(state="downloading", progress=0.0))
        logger.info(f"Downloading the speech models to {self._folder}")
        await asyncio.to_thread(self._downloader, self._folder, progress=progress)

    async def _set(self, status: VoiceStatus) -> None:
        if status == self._status:
            return
        self._status = status
        for listener in list(self._listeners):
            try:
                await listener(status)
            except Exception:
                logger.exception("Could not report the voice status")
