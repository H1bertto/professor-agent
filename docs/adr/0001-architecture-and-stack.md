# ADR 0001: Architecture and stack

- **Status:** accepted
- **Date:** 2026-09-28

## Context

Professor Agent is a desktop study tutor. An avatar sits on top of other apps, listens to the student, and answers by voice. It must:

- run on the user's computer, with the user's own AI provider;
- keep a real-time voice conversation, including interruptions;
- support Brazilian Portuguese and English from the start, because language practice is a main use case;
- show either a 3D or a 2D avatar, chosen by the user;
- be open source and easy to install for people who are not developers.

Before deciding, we studied two open source projects in the same space: [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) and [AIRI](https://github.com/moeru-ai/airi). Both are companion apps. Neither has custom wake words, avatar generation from an image, or a teaching focus.

## Decisions

### 1. Two local processes

- `apps/desktop`: Electron app. It owns the overlay window, avatar rendering, microphone capture, audio playback, and settings.
- `core`: Python process. It owns the voice pipeline and talks to the AI provider.

They communicate over a WebSocket bound to `localhost`. Events are JSON text frames. Audio is sent as binary frames (PCM 16-bit).

The microphone is captured in the Electron renderer so we get Chromium's echo cancellation for free. Open-LLM-VTuber relies on the same approach for interruptions without headphones.

### 2. Desktop: Electron, React, TypeScript

Electron gives us a transparent, always-on-top, click-through window with a mature API (`setIgnoreMouseEvents` with `forward: true`). Both projects we studied use Electron, and AIRI moved to it from Tauri. We scaffold with electron-vite.

### 3. Core: Python with Pipecat and FastAPI

[Pipecat](https://github.com/pipecat-ai/pipecat) (BSD-2-Clause) already implements the pieces of a voice agent: Silero VAD, faster-whisper, Kokoro and Piper TTS, Smart Turn detection, LLM services for many providers, interruption handling, and WebSocket transports. Writing this pipeline by hand would roughly double the work of phases 3 and 4.

To avoid lock-in, the desktop app only knows our own WebSocket protocol, never Pipecat types.

### 4. LLM: bring your own cloud provider first

The first versions connect only to hosted providers, using the user's API key:

- an OpenAI-compatible adapter (OpenAI, Google Gemini, OpenRouter, Groq, and others);
- a native Anthropic adapter.

Local LLMs come in a later phase. Running the LLM in the cloud also leaves the local GPU free for speech recognition and synthesis.

API keys are stored in the operating system credential store, never in plain text files.

### 5. Speech runs locally

- Voice activity detection: Silero VAD.
- Speech-to-text: faster-whisper (large-v3-turbo, int8 on GPU, smaller models on CPU).
- Text-to-speech: Kokoro, which has Portuguese and English voices. Provider TTS can be added as an option.

We prefer ONNX and CTranslate2 runtimes over PyTorch to keep the installer small.

### 6. Avatar: one interface, several renderers

The app talks to the avatar through one interface: load, set emotion, set mouth shape, look at a point, set state (listening, thinking, speaking). The core ships two renderers:

- **VRM (3D)** with [`@pixiv/three-vrm`](https://github.com/pixiv/three-vrm) (MIT, actively maintained).
- **PNGTuber (2D)**: one image per emotion plus mouth frames. Free of licensing issues, and the natural output format for the future "avatar from an image" feature.

Live2D comes later. Its Cubism runtime is proprietary (a paid license is needed above a revenue threshold), and the most used web library, `pixi-live2d-display`, has had no release since September 2022.

All renderers share one emotion vocabulary, and each maps it to its own format. This idea comes from AIRI.

### 7. Two languages from the start

- Speech-to-text detects the language only among the lesson's languages (for example Portuguese and English). Free auto-detection often fails on short sentences.
- The LLM marks spans in another language, for example `<en>though</en>`, and the TTS switches voice for that span.

### 8. MIT license

A permissive license keeps the project easy to use and to contribute to. It matches the licenses of our main dependencies.

## Consequences

- We must ship and update a Python runtime inside the Windows installer (phase 6). This is the biggest packaging risk.
- Development happens in WSL, but the overlay only works on Windows. The desktop app runs from a Windows-side clone when we test the overlay.
- Echo cancellation must be validated early (phase 0 spike). If it fails, conversation mode needs a fallback: a higher VAD threshold while the avatar speaks, or a headphones mode.
- Pipecat is a large dependency with its own abstractions. We keep it behind our protocol so we can replace it.
