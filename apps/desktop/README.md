# Professor Agent desktop

The Electron app of Professor Agent. It shows the avatar on top of your other apps and will own the microphone, audio playback, and settings.

## What works now

- A transparent avatar window in the bottom-right corner, always on top, without a taskbar entry.
- Clicks pass through everything except the avatar. Drag the avatar to move it, and use the mouse wheel over it to resize it.
- Two built-in avatars: Seed-san (3D, VRM) and Chalk (2D, PNGTuber). You can import your own, see [docs/avatars.md](../../docs/avatars.md).
- The avatar breathes, blinks, and follows the mouse cursor with its eyes and head.
- The tray icon menu: show or hide the avatar (also `Ctrl+Alt+P`), switch or import avatars, try expressions and talking, reset the position, and open the status window.

The design is explained in [ADR 0002](../../docs/adr/0002-avatar-overlay.md).

## Run

```bash
npm install
npm run dev
```

The status window (tray menu > **Status and credits**) checks whether the Python core is running. Start it with the steps in [`core/README.md`](../../core/README.md).

The overlay must run on Windows (or macOS) to appear on top of other apps. On WSL, run the app from a clone on the Windows side.

## Development helpers

These environment variables only work outside the packaged app:

| Variable                               | Effect                                                         |
| -------------------------------------- | -------------------------------------------------------------- |
| `PROFESSOR_AVATAR=builtin:chalk`       | Shows a built-in avatar without changing your settings         |
| `PROFESSOR_CAPTURE_OVERLAY=<file.png>` | Saves what the overlay draws, 2 seconds after the avatar loads |
| `PROFESSOR_CAPTURE_SCREEN=<file.png>`  | Saves the screen area under the overlay, to check transparency |
| `PROFESSOR_CAPTURE_EXIT=1`             | Quits after the captures                                       |

`npm run generate:chalk` redraws the Chalk avatar from [`scripts/generate-chalk-avatar.mts`](scripts/generate-chalk-avatar.mts).

## Checks

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
```

## Security rules

- The renderer runs sandboxed, with context isolation and no Node integration.
- The renderer only sees the small API in [`src/shared/api.ts`](src/shared/api.ts), exposed as `window.professor`. IPC messages from the overlay are validated in the main process.
- Avatars load through `avatar://`, which serves files only from the built-in and imported avatar folders.
- The main process talks to the core. The renderer never opens network connections itself.
- Only `https://` links can leave the app, and they open in the system browser.
