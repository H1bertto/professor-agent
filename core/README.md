# professor-core

The Python side of Professor Agent. It talks to the student's AI provider and streams the teacher's answers to the desktop app over a WebSocket on `localhost`. Voice (speech-to-text and text-to-speech) comes in phase 3.

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
