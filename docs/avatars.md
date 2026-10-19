# Avatars

Professor Agent shows either a 3D avatar (VRM) or a 2D avatar (PNGTuber). Pick one in the settings window under **Avatar**, or in the tray menu under **Avatar**. The change shows at once.

## Built-in avatars

| Avatar | Type | Author | License |
|---|---|---|---|
| Professor | 3D (VRM 1.0) | Hinttz, made with VRoid Studio | [VRM Public License 1.0](https://vrm.dev/licenses/1.0/): may be shared as it is, but changed copies may not be shared ([details](../THIRD_PARTY_NOTICES.md#professor-3d-avatar)) |
| Hoot | 3D (VRM 1.0) | Professor Agent contributors | MIT, and the VRM Public License 1.0 with every use allowed |
| Seed-san | 3D (VRM 1.0) | VirtualCast, Inc. | [VRM Public License 1.0](https://vrm.dev/licenses/1.0/), credit required |
| Hoot | 2D (PNGTuber) | Professor Agent contributors | MIT |
| Lia | 2D (PNGTuber) | Professor Agent contributors | MIT |
| Theo | 2D (PNGTuber) | Professor Agent contributors | MIT |
| Chalk | 2D (PNGTuber) | Professor Agent contributors | MIT |

Hoot is the project mascot, an owl teacher with round glasses and a graduation cap. Hoot, Lia, Theo, and Chalk are drawn by code, so they have no license questions:

- [`scripts/avatars`](../apps/desktop/scripts/avatars) draws the 2D characters as SVG, one image for each expression, with the mouth open and the eyes closed.
- [`scripts/generate-hoot-vrm.mts`](../apps/desktop/scripts/generate-hoot-vrm.mts) builds Hoot 3D from simple shapes, as a VRM 1.0 file of about 800 KB. The expressions are morph targets, the eyes turn with the eye bones, and the tassel swings with spring bones.

`npm run generate:avatars`, in `apps/desktop`, writes them all again after a change.

## Use your own VRM avatar

1. Make a character in [VRoid Studio](#make-a-3d-avatar-in-vroid-studio), or get a VRM file whose license allows your use.
2. In the settings window, choose **Import a VRM file...** under **Avatar**. The tray menu has the same option under **Avatar**.

The app copies the file into its data folder, so you can move or delete the original. VRM 1.0 and 0.x files work. The avatar uses:

- the standard expressions `happy`, `sad`, `angry`, `surprised`, and `relaxed`, the mouth shape `aa`, and `blink`;
- the eye movement of the model, to look at the mouse;
- the humanoid bones `head`, `neck`, `chest`, `spine`, the shoulders, and the upper arms, for the pose and the breathing.

## Make a 3D avatar in VRoid Studio

[VRoid Studio](https://vroid.com/en/studio) is free, for Windows and macOS, and exports VRM files ready for the app.

1. **Install it** from the official site or from [Steam](https://store.steampowered.com/app/1486350/). The official download comes from a server in Japan and cannot resume when the connection drops, so if it is slow for you, Steam is faster.
2. **Create** a new model from one of the samples, and change the face, hair, body, and outfit. Starting from a sample is faster than starting from scratch.
3. **Save** it. The `.vroid` file is the project, which VRoid Studio opens to edit it later. Keep it.
4. **Export** it:
   1. Click **Camera/Exporter** in the top right corner, then **Export**, then **Export as VRM**.
   2. Choose **VRM 1.0**.
   3. Turn on the polygon reduction and set the texture atlas to 2048, so the file stays between 10 and 20 MB.
   4. Click **Export**, and fill in the model information: the title, the author, and the license. To share the avatar, allow everyone to use it and allow redistribution.
5. **Import** the `.vrm` file in the app, as above.
6. **Check** each expression with **Try an expression** in the tray menu.

## Make a PNGTuber avatar

A PNGTuber avatar is a folder with images and an `avatar.json` file:

```text
my-tutor/
├── avatar.json
├── neutral.png
├── neutral-talking.png
├── neutral-blinking.png
└── happy.png
```

```json
{
  "format": "professor-agent/pngtuber",
  "version": 1,
  "name": "My Tutor",
  "emotions": {
    "neutral": {
      "idle": "neutral.png",
      "talking": "neutral-talking.png",
      "blinking": "neutral-blinking.png"
    },
    "happy": { "idle": "happy.png" }
  }
}
```

Rules:

- `neutral.idle` is required. Every other image is optional.
- A missing emotion uses the neutral images. A missing `talking` or `blinking` image uses the `idle` image of the same emotion.
- Emotions: `neutral`, `happy`, `sad`, `angry`, `surprised`, `relaxed`.
- Images can be PNG, JPEG, WebP, GIF, or SVG, up to 20 MB each. Paths are relative to `avatar.json` and cannot leave the folder.
- Use a transparent background and the same size for every image. A 3:4 bust shot fits the overlay best.
- The settings window shows the `neutral` idle image as the avatar's picture.

In the settings window, choose **Import a PNGTuber folder...** and pick the folder. Only `avatar.json` and the images it lists are copied.

The built-in 2D avatars are examples: see [`apps/desktop/resources/avatars`](../apps/desktop/resources/avatars), such as [`lia`](../apps/desktop/resources/avatars/lia).

## Add a built-in avatar

To ship an avatar with the app:

1. Its license must allow anyone to share it. A test reads the license of every built-in VRM file and fails without it.
2. Put the files in [`apps/desktop/resources/avatars`](../apps/desktop/resources/avatars) and add the avatar to `BUILTIN_AVATARS` in [`avatar-library.ts`](../apps/desktop/src/main/avatar-library.ts). A VRM file needs a thumbnail, which the settings window shows.
3. Credit it in [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md), here, and in the settings window footer.
4. Check every expression without the tray menu. In development, these variables open the app with the avatar and save a picture of it with each expression:

```powershell
$env:PROFESSOR_AVATAR = 'builtin:hoot-3d'
$env:PROFESSOR_CAPTURE_OVERLAY = "$env:TEMP\avatar.png"
$env:PROFESSOR_CAPTURE_POSES = 'happy,sad,angry,surprised,relaxed,talking'
$env:PROFESSOR_CAPTURE_EXIT = '1'
npm run dev
```

The pictures are `avatar-happy.png` and so on, next to `avatar.png`. While it captures, the avatar looks straight ahead instead of at the mouse.
