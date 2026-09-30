import functools
import hashlib
import threading
from collections.abc import Iterator
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from professor_core.protocol import VoiceStatus
from professor_core.speech_models import (
    ModelDownloadError,
    ModelFile,
    SpeechModels,
    VoiceEngine,
    cuda_load_order,
    download_models,
    missing_files,
    models_folder,
)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        pass


@pytest.fixture
def served(tmp_path: Path) -> Iterator[tuple[Path, str]]:
    """A folder of files served over HTTP on localhost, like a model release page."""
    source = tmp_path / "release"
    source.mkdir()
    handler = functools.partial(QuietHandler, directory=str(source))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield source, f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def publish(source: Path, base_url: str, name: str, content: bytes) -> ModelFile:
    (source / name).write_bytes(content)
    return ModelFile(
        f"{base_url}/{name}", f"models/{name}", len(content), hashlib.sha256(content).hexdigest()
    )


def test_downloads_checks_and_reports_progress(served: tuple[Path, str], tmp_path: Path) -> None:
    source, url = served
    files = [publish(source, url, "a.bin", b"a" * 3000), publish(source, url, "b.bin", b"b" * 1000)]
    target = tmp_path / "target"
    progress: list[float] = []

    download_models(target, files, progress=progress.append)

    assert (target / "models/a.bin").read_bytes() == b"a" * 3000
    assert (target / "models/b.bin").read_bytes() == b"b" * 1000
    assert progress == sorted(progress)
    assert progress[-1] == 1.0
    assert not list(target.rglob("*.part"))
    assert missing_files(target, files) == []


def test_skips_files_that_are_already_there(served: tuple[Path, str], tmp_path: Path) -> None:
    source, url = served
    present = ModelFile(f"{url}/gone.bin", "models/present.bin", 4, "not-checked-again")
    (tmp_path / "models").mkdir()
    (tmp_path / "models/present.bin").write_bytes(b"1234")
    fresh = publish(source, url, "fresh.bin", b"fresh")

    download_models(tmp_path, [present, fresh])

    assert (tmp_path / "models/fresh.bin").read_bytes() == b"fresh"


def test_refuses_a_file_that_does_not_match_its_checksum(
    served: tuple[Path, str], tmp_path: Path
) -> None:
    source, url = served
    good = publish(source, url, "model.bin", b"real content")
    tampered = ModelFile(good.url, good.path, good.size, "0" * 64)
    target = tmp_path / "target"

    with pytest.raises(ModelDownloadError, match="checksum"):
        download_models(target, [tampered])
    assert not list(target.rglob("model.bin*"))


def test_reports_a_missing_file(served: tuple[Path, str], tmp_path: Path) -> None:
    _, url = served
    with pytest.raises(ModelDownloadError, match="Could not download"):
        download_models(tmp_path, [ModelFile(f"{url}/nothing.bin", "models/x.bin", 1, "0" * 64)])


def test_the_models_folder_follows_the_environment(tmp_path: Path) -> None:
    assert models_folder({"PROFESSOR_CORE_MODELS": str(tmp_path)}) == tmp_path
    assert models_folder({"XDG_DATA_HOME": "/data"}) == Path("/data/professor-agent/models")


def test_loads_cuda_libraries_in_dependency_order() -> None:
    names = [
        "libcudnn_ops.so.9",
        "libnvblas.so.12",
        "libcublas.so.12",
        "libcudnn.so.9",
        "libcublasLt.so.12",
    ]
    ordered = [path.name for path in cuda_load_order(Path(name) for name in names)]
    assert ordered == ["libcublasLt.so.12", "libcublas.so.12", "libcudnn.so.9", "libcudnn_ops.so.9"]


class StatusLog:
    def __init__(self) -> None:
        self.statuses: list[VoiceStatus] = []

    async def __call__(self, status: VoiceStatus) -> None:
        self.statuses.append(status)

    def states(self) -> list[str]:
        return [status.state for status in self.statuses]


@pytest.mark.anyio
async def test_downloads_then_loads_the_models(tmp_path: Path) -> None:
    def downloader(folder: Path, *, progress) -> None:  # type: ignore[no-untyped-def]
        progress(0.5)
        progress(1.0)

    engine = VoiceEngine(
        tmp_path,
        check=lambda: None,
        downloader=downloader,
        loader=lambda folder: SpeechModels(whisper="whisper", kokoro="kokoro"),
    )
    log = StatusLog()
    engine.subscribe(log)
    engine.start()
    engine.start()

    assert (await engine.wait()).state == "ready"
    assert log.states() == ["downloading", "downloading", "downloading", "loading", "ready"]
    assert [s.progress for s in log.statuses[:3]] == [0.0, 0.5, 1.0]
    assert engine.models == SpeechModels(whisper="whisper", kokoro="kokoro")


@pytest.mark.anyio
async def test_explains_why_voice_is_unavailable(tmp_path: Path) -> None:
    loaded: list[Path] = []
    engine = VoiceEngine(
        tmp_path,
        check=lambda: "Voice needs an NVIDIA graphics card for now.",
        loader=lambda folder: loaded.append(folder),  # type: ignore[func-returns-value,return-value]
    )
    engine.start()

    status = await engine.wait()
    assert status == VoiceStatus(
        state="unavailable", message="Voice needs an NVIDIA graphics card for now."
    )
    assert loaded == []


@pytest.mark.anyio
async def test_reports_a_failed_download_and_tries_again(tmp_path: Path) -> None:
    attempts: list[int] = []

    def downloader(folder: Path, *, progress) -> None:  # type: ignore[no-untyped-def]
        attempts.append(1)
        raise ModelDownloadError("model.bin did not match its checksum")

    engine = VoiceEngine(tmp_path, check=lambda: None, downloader=downloader)
    engine.start()
    status = await engine.wait()
    assert (status.state, status.message) == ("error", "model.bin did not match its checksum")

    engine.start()
    await engine.wait()
    assert len(attempts) == 2
