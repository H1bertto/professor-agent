# Professor Agent

A local, open source study tutor that lives on your desktop. It appears as a 2D or 3D avatar on top of your other apps, and you talk to it by voice to learn a language or any other subject.

[Leia em português](README.pt-BR.md)

> **Status:** early development. The avatar overlay, text chat with your own AI provider, voice with a hotkey, and conversation mode work in development builds, and lessons with memory come next. There is nothing to install yet. Follow the progress in the [roadmap](docs/roadmap.md).

## Why another AI avatar?

Most open source AI avatar projects are companions. Professor Agent is built to teach. It knows your level, corrects you without breaking the flow of the conversation, writes on a board when voice is not enough, and remembers what you studied last time.

## Planned features

- **Avatar overlay.** A VRM (3D) or PNGTuber-style (2D) character on top of any app. Clicks pass through everything except the avatar.
- **Voice conversation** in Brazilian Portuguese and English, and you can interrupt it at any time.
- **Language practice.** Immersion conversations, corrections shown as cards on the side, answers adjusted to your level (CEFR A1 to C2).
- **Tutor mode for any subject**, with a board panel for notes, formulas, and code.
- **Progress memory** stored on your machine: sessions, new vocabulary, recurring mistakes.
- **Bring your own AI provider.** OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, and other OpenAI-compatible APIs. Support for local LLMs comes later.
- **Local speech.** Speech recognition and speech synthesis run on your computer.

## How it works

Two processes run on your machine:

| Part | Stack | Role |
|---|---|---|
| [`apps/desktop`](apps/desktop) | Electron, React, TypeScript | Overlay window, avatar rendering, microphone capture, settings |
| [`core`](core) | Python, FastAPI, Pipecat | Voice pipeline: voice activity detection, speech-to-text, LLM, text-to-speech |

They talk over a WebSocket on `localhost`. The reasons behind these choices are in [ADR 0001](docs/adr/0001-architecture-and-stack.md).

## Privacy

Your audio and transcripts stay on your computer. The only data that leaves it is what goes to the AI provider you configured, with your own API key.

## Development

You need Node.js 22.12 or newer and [uv](https://docs.astral.sh/uv/). uv installs the right Python version for you.

```bash
# Python core
cd core
uv sync
uv run pytest

# Desktop app
cd apps/desktop
npm install
npm run dev
```

Windows is the first target platform. Linux and macOS can work, but they are not tested yet.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

[MIT](LICENSE)
