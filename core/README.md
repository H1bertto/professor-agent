# professor-core

The Python side of Professor Agent. It will run the voice pipeline (voice activity detection, speech-to-text, LLM, text-to-speech) and talk to the desktop app over a WebSocket on `localhost`.

Right now it only exposes a health check.

## Run

```bash
uv sync
uv run professor-core
```

The server listens on `127.0.0.1:8765`. Set `PROFESSOR_CORE_PORT` to use another port. It never listens on other network interfaces.

```bash
curl http://127.0.0.1:8765/health
```

## Checks

```bash
uv run ruff check .
uv run ruff format --check .
uv run pytest
```
