# ADR 0004: Voice with a hotkey

- **Status:** accepted
- **Date:** 2026-09-30

## Context

Phase 3 lets the student ask out loud and hear the teacher answer. A hotkey starts and ends each question. Conversation mode, without the hotkey, is phase 4. The constraints:

- speech runs on the student's computer, for privacy. Only the text of the question goes to the AI provider;
- the student practices English inside Portuguese, so answers mix the two languages, often in one sentence;
- the first words must come quickly, while the model still writes the rest;
- the core can run in WSL2 while the app runs on Windows, so the microphone and the speakers are on the app's side.

## Decisions

### 1. The hotkey starts the question, and silence ends it

`Ctrl+Shift` with the key below Esc starts listening, and a second press ends it. That key types `'` on the Brazilian ABNT2 layout and `` ` `` on the US layout. Electron names keys by the US layout, so the accelerator is ``CommandOrControl+Shift+` ``. Pressing it while the teacher speaks interrupts the teacher. The tray menu has the same action.

The core also ends the question by itself: after 1.5 seconds of silence once the student spoke, after 8 seconds without speech, or after 30 seconds. Pipecat's Silero voice detector decides what is speech. The silence was 0.8 seconds at first, which cut short the sentences of a student who stops to think.

Listening runs outside the Pipecat pipeline. With a hotkey, the turn is already known, so the pipeline from phase 2 keeps only the text conversation, and the transcript enters it like a typed question. Phase 4 will revisit this, since turn detection there is the pipeline's job.

### 2. faster-whisper on the GPU, with hints from the teacher's own words

Speech-to-text is faster-whisper large-v3-turbo on CUDA, with int8 weights and float16 math, in 1.1 GB of GPU memory. The student sets the language in the settings: Portuguese, English, or detected between those two only. Detection across all languages got one-word questions wrong in the phase 0 spike.

English words inside a Portuguese question are the hard part: "since" came out as "Sensei" or "SimCe". The core names the short English words of the teacher's recent answers, which are the words the student practices, in a Portuguese sentence that Whisper reads before the question. It has to be a Portuguese sentence. The first version passed them through Whisper's hotwords, as a bare list of English phrases, and after a few answers Whisper translated whole Portuguese questions into English. The first question of a session has no hints yet.

### 3. Kokoro on the CPU, sentence by sentence

Text-to-speech is Kokoro, through kokoro-onnx, on the CPU, which leaves the GPU to Whisper. The core cuts the answer into sentences while it streams and speaks each one as soon as it is complete. The first sentence may stop at a comma after 25 characters, so speech starts sooner. Audio goes to the desktop in frames of 0.2 seconds, small enough to stop quickly.

The answer is spoken in the language of the question, and text inside `<en>...</en>` is English. The student chooses who says the English parts, after the [mixed-language spike](../../spikes/mixed-language-tts/README.md):

- **the teacher's voice** (the default): each piece becomes phonemes in its own language, and the sentence is rendered in one pass with the Portuguese voice `pf_dora`, so it keeps one rhythm;
- **a native English voice**: English runs of three words or more, and whole English sentences, are rendered apart with the American voice `af_heart`. Shorter English inside Portuguese stays in the teacher's voice. At first every English run changed voice, but then the Portuguese around a single word was rendered alone, and short pieces came out slower and lower: 59 ms per phoneme, against 44 in one pass.

Speech often lasts longer than the text. Stop, the hotkey, or a new question silences it, even after the text is complete.

### 4. Protocol version 2 carries audio

[Protocol version 2](../protocol.md) adds binary frames: one byte for the kind, `0x01` for the microphone and `0x02` for speech, followed by 16-bit mono PCM. Microphone audio is at 16 kHz, and speech at the rate `speech.start` gives, 24 kHz for Kokoro. New messages start and stop listening and report the transcript, the spoken parts for the subtitles, the state of the speech models, and the time of each step.

### 5. Pinned models, downloaded on first use

Voice is an optional extra of the core (`uv sync --extra voice`), so the text chat stays small. The first time voice is turned on, the core downloads about 2 GB. Each file is pinned to one release and checked against its SHA-256, and the settings window shows the progress. The CUDA libraries come from pip wheels and are loaded when voice starts, so no system CUDA or `LD_LIBRARY_PATH` is needed.

While the status still says loading, each model runs once. The first Whisper run on the GPU took about a second longer than the runs after it, which made the first question the slowest.

### 6. The overlay owns the microphone and the speakers

The main process stays the only client of the core and passes audio between it and the overlay over IPC.

- The microphone opens only while the teacher listens, with Chromium's echo cancellation, noise suppression, and gain control. An AudioWorklet in an audio context at 16 kHz cuts it into blocks of 512 samples: 32 ms, the window the voice detector reads. The device is released after each question, so the system shows the microphone in use only then.
- Only the overlay may use the microphone. Every other permission, the camera included, is refused for every window.
- Speech frames play back to back through Web Audio. The overlay tells the main process when each part starts and when the last one has played, which drives the subtitles. If the overlay never says so, the main process stops waiting 5 seconds after the audio should have ended.
- The mouth follows the loudness of the speech. Both avatars have a listening pose: they face the student, tilt the head, and lean in a little.
- The bubble shows the question as the core heard it, highlights the sentence the student hears now, and starts to hide only after the speech ends.

### 7. Latency is measured per step

After each turn, the core logs and sends `turn.metrics`: how long the student spoke, the transcription, the time to the first words, and the time from the first words to the first speech. The log has no text from the conversation.

The Windows check used an RTX 2060 SUPER, a 3.3-second question played from a file, and the fake provider, which answers at once:

| Step                                             | Cold models | After the warm-up |
| ------------------------------------------------ | ----------- | ----------------- |
| Transcription                                    | 1.36 s      | 0.74 s            |
| From the end of the question to the first words  | 1.43 s      | 0.75 s            |
| From the first words to the first speech         | 0.44 s      | 0.37 s            |
| From the end of the question to the first speech | 1.87 s      | 1.12 s            |

A real provider adds its own time before the first words.

### 8. Checking voice without speaking

In development builds, `PROFESSOR_DEV_VOICE`, `PROFESSOR_DEV_MIC_FILE`, `PROFESSOR_DEV_TALK`, and `PROFESSOR_CAPTURE_SPEECH` turn voice on, play a WAV in place of the microphone, press the hotkey once voice is ready, and save the spoken answer with a log of what the overlay played. With the fake provider, the whole voice path runs on Windows from WSL without a microphone or credit.

## Consequences

- With more than one keyboard layout, Windows switches layouts with `Ctrl+Shift` on its own. In the other layout the key below Esc can send another key code, and the hotkey stops working until the layout comes back. This happened in the first manual test, with the Brazilian and the Portuguese layouts. The README tells how to avoid it, and a hotkey the student can change would remove it.
- Voice needs an NVIDIA graphics card for now. Without one, the settings window says so. A CPU fallback is planned for phase 6.
- English words in the first question of a session can come out wrong, until the teacher's answers give Whisper hints.
- Echo does not matter yet, because the hotkey silences the teacher before it listens. Conversation mode in phase 4 needs echo cancellation that holds up with speakers, or headphones.
- The models take about 1.1 GB of GPU memory, loaded once and shared by every connection.
