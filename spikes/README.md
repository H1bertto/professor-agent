# Spikes

Short experiments that answer one technical question before we build on top of it. They are not part of the app, and their code does not need to meet the app's standards.

| Spike | Question | Status |
|---|---|---|
| [speech-benchmark](speech-benchmark) | Are local speech-to-text and text-to-speech fast enough on a mid-range GPU, in Portuguese and English? | Done, see [results](speech-benchmark/RESULTS.md) |
| [echo-cancellation](echo-cancellation) | Does Chromium's echo cancellation keep the avatar's voice out of the microphone? | Inconclusive with speakers, so headphones come first. See [results](echo-cancellation/README.md#results) |
| [mixed-language-tts](mixed-language-tts) | How should the teacher's voice say English words inside a Portuguese answer? | Done: a setting between the teacher's voice with English phonemes and a native English voice. See [results](mixed-language-tts/README.md#results) |
