# Speech benchmark results

- **Date:** 2026-09-28
- **Machine:** RTX 2060 SUPER (8 GB), Ryzen 5 3600XT, Windows 11 with WSL2
- **Versions:** faster-whisper 1.2.1, ctranslate2 4.8.2, kokoro-onnx 0.6.1, onnxruntime 1.30.0
- **Audio:** synthetic sentences from Kokoro. They are clean, so accuracy is optimistic. Latency and memory are the point.

## Text-to-speech: Kokoro on CPU

| Sentence length | Audio | Synthesis time | Real-time factor |
|---|---|---|---|
| One word ("Sim.", "Yes.") | 0.6 to 0.7 s | 0.20 to 0.37 s | 0.33 to 0.51 |
| Normal sentence | 1.7 to 3.3 s | 0.55 to 1.0 s | 0.27 to 0.33 |

- The model loads in about 1 s.
- Portuguese (`pf_dora`) and English (`af_heart`) have the same speed.
- Kokoro on CPU is fast enough. The GPU stays free.

## Speech-to-text: faster-whisper large-v3-turbo on GPU (int8_float16)

| Mode | Time per sentence |
|---|---|
| Language forced, beam 1 | 0.21 to 0.25 s |
| Language forced, beam 5 | 0.23 to 0.30 s |
| Auto-detection | 0.41 to 0.45 s |
| Detection limited to pt/en | 0.41 to 0.46 s |

- GPU memory: 1.1 GB for the model, 1.16 GB peak. About 6.5 GB of the 8 GB stay free.
- Warm model load: 5 to 7 s. Load it once when the app starts.
- Every full sentence came out right, in both languages.
- Detecting the language always costs about 0.2 s more, even inside `transcribe`, because it runs one more encoder pass.

### Problems found

1. **One-word answers get the wrong language.** "Sim." was detected as English (0.86) and transcribed as "Sing.", even with detection limited to pt/en.
2. **English words inside a Portuguese sentence get mangled.** With Portuguese forced, "since" became "SimCe".

## Speech-to-text on CPU (fallback without GPU)

`small` with int8 on the Ryzen 5 3600XT: 1.7 to 2.0 s per sentence, and 5.5 s for "Sim." (the model looped on it). This is too slow for a conversation.

## Decisions for phase 3

- **Model:** large-v3-turbo, int8_float16, beam 1. Beam 5 adds about 0.04 s, so we can switch if accuracy needs it.
- **Language:** do not detect on every turn. Force the language from the lesson:
  - immersion lessons use the target language;
  - tutor lessons use the student's native language;
  - a free-talk mode can pay the 0.2 s for detection.
- **Short answers:** reuse the language of the conversation, never trust detection on less than about one second of audio.
- **Code-switching:** try the `hotwords` or `initial_prompt` options with the lesson vocabulary (for example "since", "for") and measure with real microphone audio.
- **CPU fallback (phase 6):** offer the provider's speech-to-text API (for example Whisper on OpenAI or Groq), or a smaller streaming model. Whisper `small` on CPU is not enough.

## Latency budget

From the moment the student stops talking to the first sound of the answer, with a cloud LLM:

| Step | Estimate |
|---|---|
| End-of-turn detection (VAD silence) | 0.3 to 0.8 s, tuned in phase 4 |
| Speech-to-text | 0.25 s |
| LLM until the first sentence is complete | 0.5 to 1.2 s, depends on the provider |
| Text-to-speech of the first sentence | 0.2 to 0.7 s |
| **Total** | **about 1.3 to 3 s** |

Ways to cut it: split the first sentence at the first comma, so the TTS starts on a short chunk. Use Smart Turn so the silence wait can be shorter. Pick fast models (for example Claude Haiku, Gemini Flash, Groq).
