# Professor Agent desktop

The Electron app of Professor Agent. It will own the avatar overlay, microphone capture, audio playback, and settings.

Right now it opens a small window that checks whether the Python core is running.

## Run

Start the core first (see [`core/README.md`](../../core/README.md)), then:

```bash
npm install
npm run dev
```

## Checks

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
```

## Security rules

- The renderer runs sandboxed, with context isolation and no Node integration.
- The renderer only sees the small API in [`src/shared/api.ts`](src/shared/api.ts), exposed as `window.professor`.
- The main process talks to the core. The renderer never opens network connections itself.
- Only `https://` links can leave the app, and they open in the system browser.
