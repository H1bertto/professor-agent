# Echo cancellation spike

**Question:** when the avatar talks through the speakers, does Chromium's echo cancellation keep its voice out of the microphone?

This decides how conversation mode works (phase 4). If the echo leaks, the voice activity detector hears the avatar and interrupts it all the time.

## Run

1. On Windows, open `index.html` in Edge or Chrome. Electron uses the same Chromium audio stack.
2. Use speakers, not headphones, at a normal conversation volume.
3. Choose `speech-sample.wav` from this folder.
4. Click **Run test** and stay quiet. It plays the sample three times, with different microphone settings.
5. Click **Talk over it** and speak while the sample plays. Listen to the recording: your voice must still be clear.
6. Click **Copy results** and paste them in the issue or conversation.

The page records only in memory. Nothing is saved or sent anywhere.

## How it measures

- **Noise floor:** microphone level during 1.5 s of silence.
- **Echo:** microphone level while the sample plays, only in frames where the sample itself has speech.
- **Frames a VAD would hear:** share of those frames more than 10 dB above the noise floor. It is shown for the first second (while the canceller adapts) and after.

The test passes when, with the app setting, the echo stays less than 10 dB above the noise floor and fewer than 5% of frames after the first second would trigger a VAD.

## Results

### Round 1 (2026-09-28, Chrome 154 on Windows 11)

The microphone was very close to the speakers, so the echo was louder than a normal setup would produce.

| Setting | Noise floor | Echo p90 | Echo above noise | VAD frames (first s / after) |
|---|---|---|---|---|
| No processing | -50.9 dB | -35.6 dB | 15.3 dB | 79% / 38% |
| Echo cancellation only | -51.7 dB | -27.0 dB | 24.7 dB | 15% / 28% |
| Echo cancellation + noise suppression + auto gain | -58.3 dB | -15.7 dB | 42.5 dB | 0% / 56% |

- Talking over the sample worked: the student's voice stayed clear in the recording.
- The echo got louder with processing on. That is not what weak cancellation looks like, so the result is inconclusive. Possible causes:
  - Chromium's canceller does not use Web Audio playback as its reference. Routing playback through a local WebRTC loopback is a known workaround.
  - Auto gain raises the microphone level during silence and then amplifies the leftover echo.
  - The microphone was so close that the echo overloaded the canceller.

### Decision

- Conversation mode (phase 4) targets **headphones first**, which is how the maintainer uses it.
- Without headphones, conversation mode uses a fallback: a higher VAD threshold while the avatar speaks, or half duplex (the microphone ignores speech while the avatar talks, except for a clear interruption).
- Later, retest speakers with a normal microphone distance, auto gain off, and WebRTC loopback playback. If the browser still leaks, run echo cancellation in the core, where the TTS audio is already available as the reference signal.
