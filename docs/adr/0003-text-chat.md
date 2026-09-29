# ADR 0003: Text chat with the student's AI provider

- **Status:** accepted
- **Date:** 2026-09-29

## Context

Phase 2 makes the avatar answer questions. The student types a question, the teacher answers with the AI provider the student chose, and the avatar reacts while the answer streams. Voice comes in phase 3, so everything here must also work for spoken answers later:

- each student brings their own provider and API key;
- the key must stay safe on the student's computer;
- answers must stream, so the first words appear quickly;
- the answer must carry the teacher's emotion and mark words in other languages, which the text-to-speech of phase 3 will need.

## Decisions

### 1. Pipecat already runs the text chat

ADR 0001 picked Pipecat for the voice pipeline. We tried it for text first, with a decision gate: if Pipecat got in the way of plain text, we would call the provider SDKs directly and bring Pipecat in with voice. It stayed. A pipeline of the user aggregator, the LLM service, and the assistant aggregator (`LLMContextAggregatorPair`) streams the answer, keeps the history, and handles interruption with `InterruptionFrame`, which is exactly what voice needs next.

Three problems came up and are handled in [`conversation.py`](../../core/src/professor_core/conversation.py) and [`providers.py`](../../core/src/professor_core/providers.py):

- A new question could reach the history before the previous answer was saved. The next question now waits for `on_assistant_turn_stopped`, for at most one second.
- The Anthropic and OpenAI services left their HTTP clients open. Small subclasses close them in `cleanup`.
- Only one answer runs at a time. A new question cancels the running one.

The core keeps the last 20 messages in memory. A new provider or persona rebuilds the pipeline and keeps the history. Nothing is saved to disk yet: lessons and memory are phase 5.

### 2. A small protocol over the local WebSocket

The desktop and the core talk with [protocol version 1](../protocol.md) over `ws://127.0.0.1:8765/ws`. The core refuses connections with an `Origin` header, which every browser sends, so web pages cannot reach it. It also accepts a launch token in `hello`. Example messages in [`protocol/fixtures`](../../protocol/fixtures) are checked by both test suites, so the Python and TypeScript sides cannot drift apart.

Only the Electron main process connects, with the `ws` library, which sends no `Origin`. The windows talk to the main process over IPC and never open network connections.

### 3. The desktop keeps the API key, encrypted by the system

The key is encrypted with Electron `safeStorage`: DPAPI on Windows, the Keychain on macOS, and the desktop keyring on Linux. On Linux without a keyring, Electron falls back to a fixed password, so the app refuses to save keys there instead of pretending they are protected. The settings file holds only the encrypted key.

The main process decrypts the key once and sends it to the core inside `configure` and `provider.test`, over the local connection. The core keeps it in memory and never logs it. The settings window sees only a hint such as `...a1b2`.

Two rules keep the key from going somewhere the student did not choose:

- the saved key is reused only for the same kind of provider at the same address. Changing the address asks for the key again;
- only the settings window may call the settings handlers.

We chose `safeStorage` over entries in the system credential manager because it needs no native module and works the same way on all three systems.

### 4. Provider presets

The settings window offers Anthropic, OpenAI, OpenRouter, Groq, Google Gemini, and any OpenAI-compatible API. Plain `http` is allowed only for a provider on this computer (`localhost`, `127.0.0.1`, or `::1`), and the host is parsed, not matched by prefix. "Test connection" lists the models the key can use, without saving anything.

For Anthropic, the default model is `claude-opus-5`, and the student can pick a faster one such as `claude-haiku-4-5`. The core also sets:

- `effort: "low"` on models that support it, because a spoken tutor needs fast first words more than deep reasoning;
- `max_tokens` from the model's own limit, capped at 64,000. Answers stream, so a generous cap costs nothing;
- server-side refusal fallbacks (`fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta) on `claude-opus-5` and `claude-fable-5-1`. When the model declines a request, the API can finish the answer on another Claude model instead of leaving the student without one.

### 5. Emotion tags and language spans

The teacher prompt ([`persona.py`](../../core/src/professor_core/persona.py)) asks for short plain-text answers that start with an emotion tag such as `[happy]` and mark words in another language with `<en>...</en>`. The core parses them while the answer streams ([`markup.py`](../../core/src/professor_core/markup.py)), so the desktop receives clean text segments with a `lang` field and separate emotion messages. Phase 3 will use `lang` to switch voices.

### 6. A question box and an answer bubble beside the avatar

Clicking the avatar without dragging it, `Ctrl+Alt+Space`, or the tray menu opens a small question box beside the avatar. The answer streams into a bubble above it. Both are separate windows, as ADR 0002 planned, and they follow the avatar when it moves.

- The question box takes focus, so the student can type at once, and closes when it loses focus.
- The bubble never takes focus. Its window takes the height of its content, so the rest of the screen stays clickable. It has Stop, Pin, and Close, and hides by itself a while after the answer ends, unless it is pinned or under the mouse.
- The avatar looks up and tilts its head while it waits, nods and moves its mouth while the text streams, shows the emotion the teacher chose, and relaxes back to neutral a few seconds later.

### 7. Checking the flow without a real provider

The core tests run against a fake OpenAI and Anthropic server ([`fake_provider.py`](../../core/tests/fake_provider.py)), which can also run alone. In development builds, `PROFESSOR_DEV_PROVIDER`, `PROFESSOR_DEV_ASK`, and `PROFESSOR_CAPTURE_BUBBLE` point the app at it, ask one question, and save the bubble, so the whole flow can be checked on Windows from WSL without credit.

## Consequences

- Answers are text only until phase 3.
- The conversation is lost when the core restarts, until the memory of phase 5.
- On Linux, saving a key needs an unlocked keyring such as GNOME Keyring or KWallet.
- The interface is in English for now. Translations come later.
- With refusal fallbacks on, some Anthropic answers may come from a different Claude model than the one the student picked.
