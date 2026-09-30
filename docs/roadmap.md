# Roadmap

Professor Agent is built in small phases. Each phase ends with something that works and can be shown.

## Core

### Phase 0: Foundation and risk checks
- [x] Repository with open source files, CI, and the two apps scaffolded
- [x] Spike: does Chromium echo cancellation remove the avatar's own voice from the microphone? Inconclusive with speakers, so conversation mode starts with headphones ([results](../spikes/echo-cancellation/README.md#results))
- [x] Spike: speech-to-text speed and GPU memory with faster-whisper on a mid-range GPU ([results](../spikes/speech-benchmark/RESULTS.md))
- [x] ADR 0001 with the architecture and stack

### Phase 1: Avatar overlay (no AI yet)
- [x] Transparent, always-on-top, click-through window
- [x] Pixel hit test so only the avatar receives clicks
- [x] Shared avatar interface, with a VRM (3D) renderer and a PNGTuber (2D) renderer
- [x] Idle animation: blink, breathing, look at the cursor
- [x] Drag to move, scroll to resize, tray menu
- [x] Import your own VRM or PNGTuber avatar ([guide](avatars.md), [ADR 0002](adr/0002-avatar-overlay.md))

### Phase 2: Text chat with your AI provider
- [x] Python core with FastAPI and a local WebSocket ([protocol](protocol.md))
- [x] Provider settings screen: OpenAI-compatible APIs and Anthropic
- [x] API keys encrypted by the operating system
- [x] LLM output format with emotion tags and language spans
- [x] Streaming answer bubble and avatar expressions ([ADR 0003](adr/0003-text-chat.md))

### Phase 3: Voice with a hotkey
- [ ] Microphone capture with echo cancellation, streamed as 16 kHz PCM
- [ ] Voice activity detection, speech-to-text, sentence splitting, text-to-speech
- [ ] Portuguese and English: language set by the lesson (detection only in free talk), voice switched per language span
- [ ] Lip sync and subtitles
- [ ] Latency measured per stage

### Phase 4: Conversation mode
- [ ] Always-on microphone with turn detection, headphones first
- [ ] Speaker fallback: higher VAD threshold or half duplex while the avatar speaks
- [ ] Interruptions: stop speaking, cancel generation, keep only what was heard in memory
- [ ] Listening, thinking, and speaking states on the avatar

### Phase 5: Professor v1
- [ ] Student profile: native language, subjects, level, goals, correction style
- [ ] Lesson types: conversation practice and subject tutor
- [ ] Correction cards and a board panel
- [ ] Session summary and local progress memory

### Phase 6: Windows package
- [ ] Installer that bundles the Python core
- [ ] First-run setup: provider, model downloads, microphone test, avatar
- [ ] CPU fallback when there is no GPU

## Later

- Live2D renderer
- Local LLMs (Ollama, LM Studio, llama.cpp)
- Review sessions with spaced repetition
- Pronunciation feedback
- Study from your own material (PDF and notes)
- Screen context: ask about what you are reading or watching
- Custom wake words
- Same voice in every language
- Avatar generated from an image
