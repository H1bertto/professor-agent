# Core protocol, version 1

The desktop app and the Python core talk over a WebSocket on `ws://127.0.0.1:8765/ws`. Every message is a JSON object with a `type` field. Field names use camelCase.

Example messages live in [`protocol/fixtures`](../protocol/fixtures). The Python and TypeScript test suites both check them, so a change to the protocol must update the fixtures, the Python models ([`core/src/professor_core/protocol.py`](../core/src/professor_core/protocol.py)), and the TypeScript types ([`apps/desktop/src/shared/core-protocol.ts`](../apps/desktop/src/shared/core-protocol.ts)) together.

## Security

- The core listens on `127.0.0.1` only.
- The core refuses any connection that sends an `Origin` header. Browsers always send one, so web pages cannot reach the core. The desktop app connects from the Electron main process, which does not.
- When the core runs with `PROFESSOR_CORE_TOKEN`, the `hello` message must carry the same token. The desktop app starts the core with a fresh token. In development, set the same variable on both sides, or leave it unset.
- The API key travels only inside `configure` and `provider.test`, over this local connection. The core keeps it in memory and never logs it.

## Lifecycle

1. The desktop sends `hello`. The core answers `ready`, or closes the connection.
2. The desktop sends `configure` with the provider and the persona. It sends it again whenever the settings change.
3. For each question, the desktop sends `user.text`. The core answers with `response.start`, any number of `response.delta` and `response.emotion`, and one `response.end`.
4. Only one response runs at a time. A new `user.text` cancels the running one, which ends with `response.end` and reason `cancelled`. `response.cancel` does the same without a new question.

Responses use the id of the `user.text` message that started them.

## Desktop to core

| Type | Fields | Purpose |
|---|---|---|
| `hello` | `protocol`, `client`, `token` | Opens the session. `token` is `null` when the core has none |
| `configure` | `provider`, `persona` | Sets the AI provider (or `null`) and the teacher persona |
| `provider.test` | `requestId`, `provider` | Checks a provider without saving it, by listing its models |
| `user.text` | `id`, `text` | A question from the student |
| `response.cancel` | `id` | Stops the response for this id |

`provider` is `{ kind, baseUrl, model, apiKey }`. `kind` is `anthropic` or `openai-compatible`. `baseUrl` is required for `openai-compatible` and `null` for `anthropic`.

`persona` is `{ name, instructions }`. `instructions` adds to the built-in teacher prompt.

## Core to desktop

| Type | Fields | Purpose |
|---|---|---|
| `ready` | `protocol`, `core` | The session is open. `core` is the core version |
| `response.start` | `id` | The model started answering |
| `response.delta` | `id`, `segments` | New text, as `[{ text, lang }]` |
| `response.emotion` | `id`, `emotion` | The avatar should show this emotion |
| `response.end` | `id`, `reason` | `complete`, `cancelled`, or `error` |
| `provider.test.result` | `requestId`, `ok`, `models`, `code`, `message` | Result of `provider.test` |
| `error` | `id`, `code`, `message` | Something failed. `id` is `null` when no response is involved |

Error codes: `invalid_key`, `rate_limited`, `insufficient_credit`, `model_not_found`, `provider_unavailable`, `not_configured`, `bad_request`, `internal`. The `message` is safe to show to the student.

## Text segments and emotions

The teacher persona asks the model to mark its answer:

- `[happy]`, `[sad]`, `[angry]`, `[surprised]`, `[relaxed]`, and `[neutral]` change the avatar's expression.
- `<en>though</en>` marks words in another language, so the text-to-speech of phase 3 can switch voices.

The core removes these marks from the text. Emotions become `response.emotion` messages, and language marks become the `lang` of each segment. `lang` is `null` for text in the main language of the conversation.
