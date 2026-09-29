# Avatars

Professor Agent shows either a 3D avatar (VRM) or a 2D avatar (PNGTuber). Pick one in the tray menu under **Avatar**.

## Built-in avatars

| Avatar | Type | Author | License |
|---|---|---|---|
| Seed-san | 3D (VRM 1.0) | VirtualCast, Inc. | [VRM Public License 1.0](https://vrm.dev/licenses/1.0/), credit required |
| Chalk | 2D (PNGTuber) | Professor Agent contributors | MIT |

## Use your own VRM avatar

1. Make a character in [VRoid Studio](https://vroid.com/en/studio) (free) or get a VRM file whose license allows your use.
2. In the tray menu, choose **Avatar > Import a VRM file...**.

The app copies the file into its data folder, so you can move or delete the original. VRM 1.0 files work best. The avatar uses the standard expressions `happy`, `sad`, `angry`, `surprised`, and `relaxed`, the mouth shape `aa`, and `blink`.

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

In the tray menu, choose **Avatar > Import a PNGTuber folder...** and pick the folder. Only `avatar.json` and the images it lists are copied.

Chalk is an example: see [`apps/desktop/resources/avatars/chalk`](../apps/desktop/resources/avatars/chalk).
