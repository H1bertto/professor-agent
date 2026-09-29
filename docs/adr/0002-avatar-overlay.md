# ADR 0002: Avatar overlay window

- **Status:** accepted
- **Date:** 2026-09-29

## Context

Phase 1 puts the avatar on top of the student's other apps, like the sign language interpreter box on a TV broadcast. It must:

- stay above other windows without stealing focus or clicks;
- let clicks reach the apps behind it, except on the avatar itself;
- support 3D (VRM) and 2D (PNGTuber) avatars, chosen by the student;
- run all day without draining the machine.

## Decisions

### 1. A compact window around the avatar

The overlay is a small frameless window (3:4, 420 px tall by default) in the bottom-right corner, not a transparent window over the whole screen. A full-screen transparent window costs a lot of GPU time on large monitors and can confuse games and full-screen apps. Dragging the avatar moves the window. Later panels, such as the answer bubble and the board, get their own windows.

The window is always on top (`screen-saver` level), skips the taskbar, and is not focusable, so clicking the avatar never takes focus from the app the student is typing in.

### 2. Pixel hit test for click-through

The window starts with `setIgnoreMouseEvents(true, { forward: true })`. Electron still forwards mouse moves, so the renderer knows where the cursor is. After each frame, the renderer reads the alpha of the pixel under the cursor:

- VRM: one `gl.readPixels` right after rendering;
- PNGTuber: `getImageData` on a CPU-backed 2D canvas.

When the pixel belongs to the avatar, the main process lets the window catch the mouse. A 150 ms release delay avoids flicker at the edges. The main process also sends whether the cursor is inside the window, because leaving the window does not always fire a mouse event.

### 3. The main process moves the window

Dragging and resizing run in the main process, using `screen.getCursorScreenPoint()`. Coordinates from the renderer can be off on monitors with different scaling. The final bounds are clamped to the work area and saved in the settings.

### 4. One renderer interface

`AvatarRenderer` (`load`, `frame`, `setEmotion`, `setMouthOpen`, `lookAt`, `setState`, `hitTest`, `resize`, `dispose`) hides the avatar format from the rest of the app. The VRM renderer uses three.js and three-vrm. The PNGTuber renderer draws images on a 2D canvas. Both share the blink, breathing, and smoothing helpers, and the emotion vocabulary (`neutral`, `happy`, `sad`, `angry`, `surprised`, `relaxed`), which matches the VRM 1.0 expression presets.

Switching avatars loads the new one on a detached canvas and swaps it in, so the window never shows an empty frame.

### 5. An `avatar://` protocol

The sandboxed renderer loads avatars through a privileged `avatar://` scheme. It serves files only from two roots: the avatars shipped in `resources/avatars`, and the imported avatars in the app data folder. Imports copy files into that folder: a `.vrm` after checking its glTF 2.0 header, or a PNGTuber folder limited to `avatar.json` and the images it lists.

### 6. Built-in avatars

- **Seed-san** (VRM 1.0, by VirtualCast, VRM Public License 1.0) is the default 3D avatar. It allows redistribution and commercial use with credit.
- **Chalk** is our own 2D teacher, drawn as SVG by `scripts/generate-chalk-avatar.mts`, so it has no license questions.

### 7. Checking the overlay without watching the screen

In development, `PROFESSOR_CAPTURE_OVERLAY` and `PROFESSOR_CAPTURE_SCREEN` save PNGs of the overlay and of the screen area under it, and `PROFESSOR_AVATAR` picks a built-in avatar. This lets us verify rendering on Windows from WSL.

## Consequences

- Idle cost measured on an RTX 2060 SUPER and a Ryzen 5 3600XT: about 0.8% CPU, 3.7% GPU, and 460 MB of memory with Seed-san at 30 frames per second.
- Exclusive full-screen games still hide the overlay. Borderless windowed mode works.
- The procedural idle pose is simple. VRM animation files (`.vrma`) can replace it later.
- Seed-san adds 11 MB to the repository and the installer.
