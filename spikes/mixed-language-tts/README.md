# Mixed-language speech

**Question:** the teacher marks English words inside Portuguese answers with `<en>...</en>`. How should Kokoro say them?

## Run

```bash
uv run python generate.py
```

It reuses the Kokoro files downloaded by [speech-benchmark](../speech-benchmark) and writes WAV files to `output/`.

## What it compares

Three sentences in Portuguese with English words, each rendered four ways, with the teacher voice `pf_dora`:

| Variant | How |
|---|---|
| 0-baseline | The whole sentence with Portuguese pronunciation, as if there were no spans |
| A-same-voice-per-span | Each span rendered on its own in its language, then joined |
| B-switch-voice-per-span | Portuguese spans with `pf_dora`, English spans with `af_heart` |
| C-same-voice-one-pass | Each span turned into phonemes in its own language, and the sentence rendered at once with `pf_dora` |

And one answer fully in English, with `pf_dora` and with `af_heart`.

## Results

Synthesis time with kokoro-onnx on the Ryzen 5 3600XT (CPU), for 3 to 6 seconds of audio:

| Sentence | 0 | A | B | C |
|---|---|---|---|---|
| since / for | 1.33 s | 1.78 s | 2.10 s | 1.21 s |
| correction | 1.48 s | 1.80 s | 1.94 s | 1.47 s |
| thought / though | 0.91 s | 1.43 s | 1.94 s | 1.16 s |

The English answer took 1.14 s with `pf_dora` and 1.34 s with `af_heart`.

A and B come out 0.7 to 1.7 s longer than C for the same sentence (for example 5.96 s and 6.28 s against 4.63 s), because every span is rendered as its own utterance and joined with a short pause. C renders the sentence once, so it keeps one rhythm and is the fastest.

On 2026-09-30 the maintainer listened to all of them and liked **B** and **C**: B for hearing a native voice while practicing, C for keeping one speaker.

## Decision

Both, as a voice setting:

- **Teacher's voice** (C, the default): mixed phonemes in one pass, and `pf_dora` also for answers fully in English.
- **Native English voice** (B): `af_heart` for English spans and for answers fully in English.

Pipecat's Kokoro service takes plain text in one language, so the core renders with kokoro-onnx directly in its own text-to-speech service.
