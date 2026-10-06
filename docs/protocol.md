# Core protocol, version 3

The desktop app and the Python core talk over a WebSocket on `ws://127.0.0.1:8765/ws`. Text frames carry JSON messages, each with a `type` field and camelCase field names. Binary frames carry audio.

Example messages live in [`protocol/fixtures`](../protocol/fixtures). The Python and TypeScript test suites both check them, so a change to the protocol must update the fixtures, the Python models ([`core/src/professor_core/protocol.py`](../core/src/professor_core/protocol.py)), and the TypeScript types ([`apps/desktop/src/shared/core-protocol.ts`](../apps/desktop/src/shared/core-protocol.ts)) together.

Version 2 added voice: audio frames, the `voice` settings in `configure`, listening, and speech. Version 3 adds conversation mode, where the core finds each turn by itself, and the choice of voices. The desktop and the core must speak the same version.

## Security

- The core listens on `127.0.0.1` only.
- The core refuses any connection that sends an `Origin` header. Browsers always send one, so web pages cannot reach the core. The desktop app connects from the Electron main process, which does not.
- When the core runs with `PROFESSOR_CORE_TOKEN`, the `hello` message must carry the same token. The desktop app starts the core with a fresh token. In development, set the same variable on both sides, or leave it unset.
- The API key travels only inside `configure` and `provider.test`, over this local connection. The core keeps it in memory and never logs it.
- Microphone audio goes only to the core, which turns it into text on this computer. Only the text goes to the AI provider.

## Lifecycle

1. The desktop sends `hello`. The core answers `ready`, or closes the connection.
2. The desktop sends `configure` with the provider, the persona, and the voice settings. It sends it again whenever the settings change. With voice enabled, the core loads its speech models and reports progress with `voice.status`.
3. A typed question is a `user.text`. The core answers with `response.start`, any number of `response.delta` and `response.emotion`, and one `response.end`.
4. A spoken question starts with `listen.start` and microphone frames. The core stops listening when the student is silent, when the desktop sends `listen.stop`, or after a time limit, and says so with `listen.end`. It then sends the `transcript` and answers like a typed question.
5. With `speakAnswers` on, the answer also comes as speech: `speech.start`, then for each part a `speech.segment` followed by its speech frames, and one `speech.end`.
6. Only one response runs at a time. A new question cancels the running one, which ends with `response.end` and reason `cancelled`. `response.cancel` does the same without a new question, and also stops a listening in progress.

7. In conversation mode the microphone stays open, see [Conversation mode](#conversation-mode).

Responses, listening, and speech all use the id of the question that started them: the `user.text` id, the `listen.start` id, or the `turn.start` id.

## Audio frames

Every binary frame starts with one byte for its kind, followed by 16-bit little-endian mono PCM:

| First byte | Direction | Sample rate | Content |
|---|---|---|---|
| `0x01` | desktop to core | 16 kHz | Microphone audio for the listening in progress, or all the time in conversation mode |
| `0x02` | core to desktop | `sampleRate` of `speech.start` | Speech for the answer in progress |

Frames carry no id. Microphone frames belong to the listening between `listen.start` and `listen.end`, or to the conversation between `conversation.start` and `conversation.stop`. Speech frames belong to the `speech.segment` sent before them. When the desktop cancels an answer, it drops the speech frames still arriving for it.

## Desktop to core

| Type | Fields | Purpose |
|---|---|---|
| `hello` | `protocol`, `client`, `token` | Opens the session. `token` is `null` when the core has none |
| `configure` | `provider`, `persona`, `voice` | Sets the AI provider (or `null`), the teacher persona, and the voice settings |
| `provider.test` | `requestId`, `provider` | Checks a provider without saving it, by listing its models |
| `user.text` | `id`, `text` | A typed question |
| `listen.start` | `id` | The student started a spoken question. Microphone frames follow |
| `listen.stop` | `id` | The student finished speaking, for example by pressing the hotkey again |
| `response.cancel` | `id` | Stops the listening or the response for this id |
| `conversation.start` | | Starts conversation mode: microphone frames follow without a listening id |
| `conversation.stop` | | Ends conversation mode, for example when the student pauses it |
| `speech.heard` | `id`, `parts` | How many parts of this answer's speech the student has started to hear |

`provider` is `{ kind, baseUrl, model, apiKey }`. `kind` is `anthropic` or `openai-compatible`. `baseUrl` is required for `openai-compatible`. For `anthropic` it is usually `null`, which means the official API. It must use `https`, or `http` on localhost.

`persona` is `{ name, instructions }`. `instructions` adds to the built-in teacher prompt.

`voice` is `{ enabled, speakAnswers, spokenLanguage, englishVoice, teacherVoice, nativeVoice }`:

- `enabled` loads the speech models and allows spoken questions.
- `speakAnswers` also speaks the answers, including answers to typed questions.
- `spokenLanguage` is `auto`, `pt`, or `en`: the language the student speaks. `auto` detects it, choosing only between Portuguese and English.
- `englishVoice` is `teacher` (the teacher's own voice says English words with English pronunciation) or `native` (a native English voice says English phrases and sentences).
- `teacherVoice` is `dora` or `alex`, the teacher's Portuguese voice.
- `nativeVoice` is `heart`, `bella`, `michael`, `fenrir`, `puck`, or `adam`, the native English voice.

## Core to desktop

| Type | Fields | Purpose |
|---|---|---|
| `ready` | `protocol`, `core` | The session is open. `core` is the core version |
| `turn.start` | `id` | In conversation mode, the student started speaking. The id names the question that follows |
| `voice.status` | `state`, `progress`, `message` | Where the speech models are: `off`, `downloading`, `loading`, `ready`, `unavailable`, or `error`. `progress` goes from 0 to 1 while downloading, and is `null` otherwise |
| `listen.end` | `id`, `reason` | The core stopped listening: `silence`, `stopped`, `too_long`, or `cancelled` |
| `transcript` | `id`, `text`, `lang` | What the student said, and in which language (`pt` or `en`) |
| `response.start` | `id` | The model started answering |
| `response.delta` | `id`, `segments` | New text, as `[{ text, lang }]` |
| `response.emotion` | `id`, `emotion` | The avatar should show this emotion |
| `response.end` | `id`, `reason` | `complete`, `cancelled`, or `error` |
| `speech.start` | `id`, `sampleRate` | Speech for this answer begins |
| `speech.segment` | `id`, `index`, `text`, `lang` | The part of the answer that the next speech frames say, for subtitles |
| `speech.end` | `id`, `reason` | `complete`, `cancelled`, or `error` |
| `turn.metrics` | `id`, `listenedMs`, `transcribeMs`, `firstTextMs`, `firstAudioMs`, `totalMs` | How long each step took. Any of them can be `null` |
| `provider.test.result` | `requestId`, `ok`, `models`, `code`, `message` | Result of `provider.test` |
| `error` | `id`, `code`, `message` | Something failed. `id` is `null` when no question is involved |

Error codes: `invalid_key`, `rate_limited`, `insufficient_credit`, `model_not_found`, `provider_unavailable`, `not_configured`, `no_speech`, `voice_unavailable`, `bad_request`, `internal`. The `message` is safe to show to the student.

In `turn.metrics`:

- `listenedMs` is how long the student spoke;
- `transcribeMs` is the time to turn that speech into text;
- `firstTextMs` is the time from the question to the first words of the model;
- `firstAudioMs` is the time from the first words to the first speech frame;
- `totalMs` is the time from the end of the question to the first speech frame, or to the first words when the answer is not spoken.

## Conversation mode

1. The desktop sends `conversation.start` and keeps sending microphone frames, until `conversation.stop`.
2. When the student starts speaking, the core sends `turn.start` with a new id. When the student finishes, it sends `listen.end`, then the `transcript` and the answer, as for a question asked with the hotkey.
3. A turn without words, such as a cough or keys, ends with an `error` coded `no_speech`. In conversation mode the desktop shows nothing for it.
4. While the desktop plays an answer, it sends `speech.heard` each time a part starts. If the student starts speaking during the answer, the desktop pauses it at `turn.start`. When the turn turns out to be a question, the core cancels the answer, keeps in the history only the parts the student heard, and answers the new question. The cancelled answer ends with `response.end` and `speech.end`, reason `cancelled`, and the desktop drops the paused speech. When the turn has no words, the desktop resumes the answer where it stopped.

## Text segments and emotions

The teacher persona asks the model to mark its answer:

- `[happy]`, `[sad]`, `[angry]`, `[surprised]`, `[relaxed]`, and `[neutral]` change the avatar's expression.
- `<en>though</en>` marks words in another language, so the speech can say them with the right pronunciation.

The core removes these marks from the text. Emotions become `response.emotion` messages, and language marks become the `lang` of each segment. In `response.delta`, `lang` is `null` for text in the main language of the conversation. In `speech.segment`, `lang` is always `pt` or `en`, because the core has already decided which language each part is spoken in.
