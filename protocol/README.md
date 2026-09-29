# Protocol fixtures

Example messages of the [core protocol](../docs/protocol.md). The Python and TypeScript test suites load every file here, so both sides agree on the format.

- `client/`: messages the desktop app sends to the core.
- `core/`: messages the core sends to the desktop app.
- `emotions.json`: the emotion vocabulary shared by both sides.
