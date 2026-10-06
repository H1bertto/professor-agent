# professor-core

The Python side of Professor Agent. It talks to the student's AI provider, hears spoken questions and speaks the answers on this computer, and streams everything to the desktop app over a WebSocket on `localhost`.

## How it works

- `connection.py` serves `ws://127.0.0.1:8765/ws` with the [core protocol](../docs/protocol.md).
- `session.py` handles one desktop connection: provider settings, questions, and cancellations.
- `conversation.py` runs a [Pipecat](https://github.com/pipecat-ai/pipecat) pipeline that streams one answer at a time.
- `providers.py` connects to Anthropic or to any OpenAI-compatible API, and maps provider errors to protocol codes.
- `markup.py` turns the teacher's `[emotion]` tags and `<en>...</en>` spans into emotions and language-tagged text.
- `persona.py` builds the teacher's system prompt.

## Run

```bash
uv sync
uv run professor-core
```

| Variable | Default | Purpose |
|---|---|---|
| `PROFESSOR_CORE_PORT` | `8765` | Port on `127.0.0.1`. The core never listens on other interfaces. |
| `PROFESSOR_CORE_TOKEN` | unset | When set, the desktop app must send the same token in `hello`. |
| `PROFESSOR_CORE_LOG_LEVEL` | `INFO` | `DEBUG` logs whole conversations, so use it only for debugging. |
| `PROFESSOR_CORE_MODELS` | `~/.local/share/professor-agent/models` | Where the speech models are kept. |
| `PROFESSOR_CORE_RECORD_TURNS` | not set | A folder where the core saves each spoken question as a WAV file, to tune turn detection. For development only: it keeps the student's voice on disk. |

## Voice

Local speech needs the `voice` extra and, for now, an NVIDIA graphics card:

```bash
uv sync --extra voice
```

The first time the desktop turns voice on, the core downloads about 2 GB into the models folder: faster-whisper large-v3-turbo for speech-to-text, and Kokoro for text-to-speech. Each file is pinned to one release and checked against its SHA-256 before it is used. The core loads the models once and shares them between connections.

On Linux, the CUDA libraries come from the `nvidia-cublas-cu12` and `nvidia-cudnn-cu12` wheels, and the core loads them by path before the first use of the GPU, so nothing needs to be on `LD_LIBRARY_PATH`.

```bash
curl http://127.0.0.1:8765/health
```

## Checks

```bash
uv run ruff check .
uv run ruff format --check .
uv run pytest
```

The tests run against a local fake of the OpenAI and Anthropic APIs (`tests/fake_provider.py`), so they never use the network or credit.

The fake also runs alone, to try the desktop app without a real provider. See the development helpers in [`apps/desktop/README.md`](../apps/desktop/README.md#development-helpers).

```bash
uv run python tests/fake_provider.py 8790
```
