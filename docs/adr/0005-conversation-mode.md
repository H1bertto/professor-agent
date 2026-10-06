# ADR 0005: Conversation mode

- **Status:** accepted
- **Date:** 2026-10-06

## Context

Phase 4 lets the student talk with the teacher without pressing a key for each question, and speak over the teacher to interrupt. With an open microphone the core has to find each turn by itself:

- students practicing a language stop to think in the middle of a sentence, so a fixed silence either cuts them off or makes every answer wait;
- a cough, the keyboard, or a short "uhum" must not stop the teacher for good;
- when the student cuts off an answer, the teacher should remember only what the student heard;
- the phase 0 spike could not show that Chromium's echo cancellation keeps the teacher's voice out of the microphone with speakers. Conversation mode starts with headphones, and speakers come later.

## Decisions

### 1. Smart Turn decides when a turn ends

Smart Turn v3.2 comes with Pipecat and runs on the CPU. It listens to the last seconds of speech and says whether the speaker finished. The voice detector now reports a pause after 0.2 seconds, Smart Turn judges it once, and a turn ends anyway after 3 seconds of silence. This replaces the fixed 1.5 seconds of phase 3, with the hotkey too.

The [spike](../../spikes/smart-turn/README.md) decided it. With synthetic speech, Smart Turn was wrong on most unfinished sentences, because Kokoro says any text with the tone of an ending. With the maintainer's voice, it never took a thinking pause for an ending, and it took two of four finished statements for unfinished ones. That mistake only makes the core wait until the 3 seconds. In the Windows check, a finished question ended about 0.2 seconds after the speech.

### 2. The core watches the open microphone, outside the pipeline

Conversation mode keeps the listening of phase 3 outside the Pipecat pipeline. Between `conversation.start` and `conversation.stop`, the desktop sends all the microphone audio. The core runs the voice detector on it and, when it hears speech, starts a turn with the audio from just before (0.5 seconds plus the detector's 0.2), so the first syllable is not lost. It sends `turn.start` with a new id, and the turn then goes like a question asked with the hotkey: `listen.end`, the transcript, and the answer.

Watching the microphone costs about 1.2% of one CPU core.

### 3. The teacher holds first, and stops only for a question

At `turn.start` the desktop pauses the teacher's speech, which can be undone. Then:

- if the turn turns out to be a question, the core cancels the answer and answers the new question, and the desktop drops the paused speech;
- if the turn has no words, the core ends it with `no_speech`, which conversation mode does not show, and the teacher goes on where it stopped.

Whisper sometimes writes words for noise, mostly subtitle credits it learned from, such as "Legendas pela comunidade Amara.org". The core drops those as no speech.

### 4. The history keeps only what the student heard

The desktop sends `speech.heard` as each part of an answer starts playing, and once more when all of it has played. When the student cuts off a spoken answer, with the hotkey, a typed question, or by speaking, the core replaces that answer in the history with the parts the student heard, marked `[interrupted]`, before the next question goes to the provider. The teacher prompt explains the mark. An answer that played to the end stays whole.

The core decides this when the transcript comes, not the desktop, so the history is right before the new question goes out.

### 5. Headphones first

Conversation mode asks for headphones. With speakers, the teacher would hear its own voice and interrupt itself. Half duplex for speakers, or echo cancellation in the core with the speech as reference, comes in a later phase.

### 6. Controls

- **The settings** choose how the student talks: the hotkey for each question, or conversation mode. They also choose the teacher's voice (Dora or Alex) and the native English voice (Heart, Bella, Michael, Fenrir, Puck, or Adam), picked by ear in the [voice spike](../../spikes/voice-choices/README.md).
- **The hotkey** is Ctrl and the key below Esc by default, which types `'` on the Brazilian layout. The student can record another one. The settings record the Windows key code, because Electron registers shortcuts by key code, so a shortcut works on any layout. Without Shift, the default no longer meets the Ctrl+Shift that Windows uses to switch keyboard layouts. A new hotkey replaces the old one only if no other app uses it.
- **In conversation mode** the hotkey pauses and resumes the listening. The listening also pauses by itself after a silence the student chooses, 3 minutes by default, with a calm note in the bubble.
- **The tray** turns conversation mode on and off. A red dot on the avatar shows when the microphone is open.

### 7. A busy provider gets more retries

The free Gemini tier answered half the requests with 503 for minutes at a time during the tests. The core now retries a busy provider three times with growing waits, and logs how an answer that came back empty ended, without its text.

### 8. Checking without speaking

In development, `PROFESSOR_DEV_CONVERSATION` turns conversation mode on, and `PROFESSOR_DEV_MIC_FILE` plays several WAV files with `PROFESSOR_DEV_MIC_GAP_MS` of silence between them, so a second file can speak over the teacher. `PROFESSOR_DEV_PROFILE` keeps the settings and the single-instance lock apart, so a check runs from its own clone while the student's app stays open. The core saves each spoken question with `PROFESSOR_CORE_RECORD_TURNS`, to tune turn detection with real voices.

In the Windows check, the second file interrupted the first answer, the teacher stopped, and the history sent with the next question held the interrupted answer marked `[interrupted]`.

## Consequences

- Conversation mode needs headphones until a later phase handles speakers.
- Some finished statements wait the full 3 seconds of silence before the teacher answers.
- Protocol version 3 replaces version 2, so the desktop and the core must be updated together.
- The default hotkey takes Ctrl and the key below Esc from other apps while Professor Agent runs. In VS Code that shortcut opens the terminal, so a developer may want to record another one.
