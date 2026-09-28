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

Not run yet.
