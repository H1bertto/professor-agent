# Voice choices

**Question:** the teacher speaks with Kokoro's Portuguese voice Dora, and the native English voice is Heart. Both are female. Which other Kokoro voices should the settings offer, male ones included?

Kokoro's voice file has three Portuguese voices (Dora, Alex, and Santa, a Santa Claus character voice) and twenty American English ones. This spike renders the same answer with the candidates, to choose them by ear.

## Run

From the repository root, in the core's environment:

```bash
uv run --project core --extra voice python spikes/voice-choices/generate.py [output folder]
```

| File | What |
|---|---|
| `1-teacher-<voice>.wav` | The teacher's voice: Portuguese, with English words in English phonemes, in one pass |
| `2-native-<voice>-with-<teacher>.wav` | The native English voice for the English phrase, after a teacher of the same kind |

The answer is "Boa pergunta! Usamos *since* para o ponto de partida. Por exemplo: *I have lived here since 2020*."

## Results

Waiting for the maintainer to listen and choose.
