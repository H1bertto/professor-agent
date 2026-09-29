# Contributing to Professor Agent

Thanks for your interest. The project is in early development, so the best way to help right now is to try things, open issues, and discuss ideas.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Repository layout

```text
apps/desktop/   Electron + React + TypeScript app (overlay, avatar, microphone, settings)
core/           Python voice pipeline and local WebSocket server
docs/           Roadmap and architecture decision records (ADRs)
spikes/         Short experiments that answer one technical question
```

## Setup

You need Node.js 22.12 or newer and [uv](https://docs.astral.sh/uv/).

```bash
# Python core
cd core
uv sync
uv run ruff check .
uv run ruff format --check .
uv run pytest

# Desktop app
cd apps/desktop
npm install
npm run lint
npm run typecheck
npm test
npm run dev
```

### Windows and WSL

The overlay window has to run on Windows to appear on top of Windows apps. If you work inside WSL, you can run the Python core in WSL (CUDA works there) and run the desktop app from a clone on the Windows side.

## Issues

- Search the existing issues first.
- Use the issue templates. For bugs, include your OS, the app version or commit, and the AI provider you use.
- Never paste API keys in issues or logs.
- Issues in English or Portuguese are both fine.

## Pull requests

1. Open an issue first for anything bigger than a small fix, so we can agree on the approach.
2. Create a branch from `main`, for example `feat/avatar-hit-test` or `fix/ws-reconnect`.
3. Keep each pull request focused on one change.
4. Add or update tests for the behavior you change.
5. Make sure lint, type checks, and tests pass for every part you touched.
6. Update the docs in the same pull request when behavior changes.

### Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat(core): add sentence splitter for streaming TTS
fix(desktop): keep click-through when the avatar is hidden
docs: explain the provider settings
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`. The scope is usually `core`, `desktop`, or `spikes`.

## Architecture decisions

Significant technical decisions are recorded as ADRs in [`docs/adr`](docs/adr). If your change alters one of them, add a new ADR that explains what changed and why.

## Code and docs language

Code, comments, commit messages, and docs are written in English. User-facing text is translated, starting with English and Brazilian Portuguese.
