# Professor Agent desktop

The Electron app of Professor Agent. It shows the avatar on top of your other apps, lets you ask the teacher questions by text or by voice, and owns the microphone and the speakers.

## What works now

- A transparent avatar window in the bottom-right corner, always on top, without a taskbar entry.
- Clicks pass through everything except the avatar. Drag the avatar to move it, and use the mouse wheel over it to resize it.
- Two built-in avatars: Seed-san (3D, VRM) and Chalk (2D, PNGTuber). You can import your own, see [docs/avatars.md](../../docs/avatars.md).
- The avatar breathes, blinks, and follows the mouse cursor with its eyes and head.
- **Text chat with your AI provider.** Click the avatar (without dragging it) or press `Ctrl+Alt+Space` to ask a question. The answer streams into a bubble beside the avatar, which looks up while it thinks, moves its mouth while the text streams, and shows the teacher's emotion. The bubble has Stop, Pin, and Close, and hides by itself a while after the answer ends.
- **Voice.** Turn it on in the settings, then press `Ctrl+Shift` with the key below Esc (`'` on a Brazilian keyboard) and ask out loud. Press it again when you finish, or just stop talking. The teacher answers out loud while the text streams, the bubble highlights the sentence being said, and the avatar's mouth follows the voice. Speech runs on this computer and needs the core's voice extra, see [`core/README.md`](../../core/README.md#voice). If Windows has more than one keyboard layout, `Ctrl+Shift` on its own switches between them, and in the other layout the hotkey may not work. Remove the layout you do not use, or turn off that shortcut in the Windows keyboard settings (Input language hot keys).
- **Settings** (tray menu > **Settings and credits**): pick a provider (Anthropic, OpenAI, OpenRouter, Groq, Google Gemini, or any OpenAI-compatible API), paste your API key, test the connection, choose a model, name the teacher, and set up voice.
- The tray icon menu: ask a question, talk to the teacher, show or hide the avatar (also `Ctrl+Alt+P`), switch or import avatars, try expressions and talking, reset the position, and open the settings.

The design is explained in [ADR 0002](../../docs/adr/0002-avatar-overlay.md) (overlay), [ADR 0003](../../docs/adr/0003-text-chat.md) (text chat), and [ADR 0004](../../docs/adr/0004-voice-with-a-hotkey.md) (voice).

## Run

```bash
npm install
npm run dev
```

Start the Python core first, with the steps in [`core/README.md`](../../core/README.md). The settings window shows whether the app is connected to it.

To chat, you need an API key from your provider. For Claude, create one at [console.anthropic.com](https://console.anthropic.com/settings/keys). A Claude.ai or Claude Code subscription does not include API credit.

The overlay must run on Windows (or macOS) to appear on top of other apps. On WSL, run the app from a clone on the Windows side. It reaches the core in WSL through `localhost`.

## Development helpers

These environment variables only work outside the packaged app:

| Variable                                      | Effect                                                            |
| --------------------------------------------- | ----------------------------------------------------------------- |
| `PROFESSOR_AVATAR=builtin:chalk`              | Shows a built-in avatar without changing your settings            |
| `PROFESSOR_DEV_PROVIDER=<json>`               | Uses this provider instead of the saved one (see below)           |
| `PROFESSOR_DEV_ASK=<question>`                | Asks the question once the avatar is on screen and the core is up |
| `PROFESSOR_CAPTURE_OVERLAY=<file.png>`        | Saves what the overlay draws, 2 seconds after the avatar loads    |
| `PROFESSOR_CAPTURE_SCREEN=<file.png>`         | Saves the screen area under the overlay, to check transparency    |
| `PROFESSOR_CAPTURE_BUBBLE=<file.png>`         | Saves what the answer bubble draws                                |
| `PROFESSOR_CAPTURE_DELAY_MS=<ms>`             | Waits this long after the avatar loads before the captures        |
| `PROFESSOR_CAPTURE_EXIT=1`                    | Quits after the captures                                          |
| `PROFESSOR_DEV_VOICE=teacher` or `native`     | Turns voice on, with that English voice, without saving it        |
| `PROFESSOR_DEV_MIC_FILE=<file.wav>`           | Plays a 16 kHz mono WAV in place of the microphone                |
| `PROFESSOR_DEV_TALK=1`                        | Presses the talk hotkey once voice is ready                       |
| `PROFESSOR_CAPTURE_SPEECH=<file.wav>`         | Saves the spoken answer and logs what the overlay played          |
| `PROFESSOR_CORE_PORT`, `PROFESSOR_CORE_TOKEN` | Must match the core, see [`core/README.md`](../../core/README.md) |

To try the chat without a real provider or credit, run the fake provider of the core tests and point the app at it:

```bash
# In core/
uv run python tests/fake_provider.py 8790
```

```powershell
$env:PROFESSOR_DEV_PROVIDER = '{"kind":"openai-compatible","baseUrl":"http://127.0.0.1:8790/v1","model":"gpt-fake","apiKey":"fake"}'
npm run dev
```

The model `slow-model` streams a longer answer slowly, to watch the streaming.

With the core's voice extra, the same fake provider checks the whole voice path without a microphone: set `PROFESSOR_DEV_VOICE=teacher`, `PROFESSOR_DEV_MIC_FILE` to a recorded question, `PROFESSOR_DEV_TALK=1`, and `PROFESSOR_CAPTURE_SPEECH` to the WAV file to save.

`npm run generate:chalk` redraws the Chalk avatar from [`scripts/generate-chalk-avatar.mts`](scripts/generate-chalk-avatar.mts).

## Checks

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
```

## Security rules

- The renderers run sandboxed, with context isolation and no Node integration.
- The renderers only see the small API in [`src/shared/api.ts`](src/shared/api.ts), exposed as `window.professor`. The main process validates every IPC message and checks which window sent it.
- The main process is the only part that talks to the core. The renderers never open network connections.
- The API key is encrypted with Electron `safeStorage` and decrypted only in the main process. The settings window sees only its last characters. The saved key is reused only for the same provider at the same address.
- Answers from the model are shown as text, never as HTML.
- Avatars load through `avatar://`, which serves files only from the built-in and imported avatar folders.
- Only `https://` links can leave the app, and they open in the system browser.
