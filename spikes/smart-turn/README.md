# Smart Turn

**Question:** in conversation mode, the core has to tell when the student finished speaking. Students pause to think in the middle of a sentence, so a fixed silence either cuts them off or makes every answer wait. Can Smart Turn v3 tell a finished sentence from a pause in the middle of one, in Portuguese and English?

Smart Turn v3.2 comes with Pipecat (`smart-turn-v3.2-cpu.onnx`, 8 MB, CPU). It listens to the last 8 seconds of audio and gives the probability that the speaker finished.

## Run

From the repository root, in the core's environment:

```bash
uv run --project core --extra voice python spikes/smart-turn/run.py
```

It renders each case with Kokoro and asks Smart Turn about it, 0.2 s after the speech ends, which is when a voice detector would ask. To judge real recordings instead, pass 16 kHz mono WAV files that end at the pause:

```bash
uv run --project core --extra voice python spikes/smart-turn/run.py pause-1.wav pause-2.wav
```

## Results

### Round 1 (2026-10-06, synthetic speech, Ryzen 5 3600XT)

| Case | Said | Finished? | Smart Turn | Right | ms |
|---|---|---|---|---|---|
| pt-question | Qual é a diferença entre since e for? | yes | 0.99 | yes | 158 |
| pt-statement | Ontem eu estudei frações com a minha irmã. | yes | 0.74 | yes | 137 |
| pt-mixed | Eu queria saber como usar o present perfect. | yes | 0.99 | yes | 125 |
| pt-short | Sim, entendi. | yes | 0.87 | yes | 112 |
| pt-conjunction | Ontem eu fui ao mercado e | no | 0.90 | NO | 111 |
| pt-preposition | Eu queria saber se você pode me explicar o | no | 0.63 | NO | 121 |
| pt-comma | Quando eu era criança, | no | 0.98 | NO | 128 |
| pt-filler | Então, é... | no | 0.96 | NO | 149 |
| en-question | What is the difference between since and for? | yes | 0.99 | yes | 142 |
| en-statement | I have lived here since twenty twenty. | yes | 0.99 | yes | 138 |
| en-short | Yes, I got it. | yes | 0.96 | yes | 140 |
| en-conjunction | Yesterday I went to the store and | no | 0.01 | yes | 138 |
| en-preposition | I would like to know if you can explain the | no | 0.85 | NO | 146 |
| en-comma | When I was a kid, | no | 0.79 | NO | 140 |
| en-filler | So, um... | no | 0.53 | NO | 124 |

- Every finished sentence was right, in both languages.
- Almost every unfinished one was taken as finished. This says little about real pauses: Kokoro reads any text as a whole sentence, with the falling tone of an ending, and Smart Turn listens to the tone more than to the words.
- A check takes about 140 ms on one CPU core, once per pause, which is fast enough.

### Round 2 (2026-10-06, the maintainer's voice)

Ten questions said through the app with the hotkey, saved by the core with `PROFESSOR_CORE_RECORD_TURNS` (see [`core/README.md`](../../core/README.md)). In the unfinished ones the speaker stopped as if thinking, until the core cut the question after 1.5 s of silence. The recordings stay on the maintainer's computer.

| What was said | Finished? | Smart Turn | Right |
|---|---|---|---|
| Qual é a diferença entre since e for? | yes | 0.95 | yes |
| Ontem eu estudei frações com a minha irmã. | yes | 0.35 | NO |
| What does since mean? | yes | 0.82 | yes |
| I went to the beach last weekend. | yes | 0.29 | NO |
| Ontem eu fui ao mercado e... | no | 0.01 | yes |
| Eu queria saber se... | no | 0.07 | yes |
| Quando eu era criança, eu... | no | 0.02 | yes |
| Yesterday I went to the... um... | no | 0.01 | yes |
| I would like to know if... | no | 0.34 | yes |
| So, I think that... | no | 0.04 | yes |

- Every unfinished sentence was right: Smart Turn never took a thinking pause for an ending.
- Two of the four finished statements were taken as unfinished. That mistake only costs time: the core waits for more silence before it answers.

## Decision

Smart Turn decides the end of a turn, in conversation mode and with the hotkey:

- after a short pause, Smart Turn checks the speech. If the student finished, the turn ends at once;
- if not, the core keeps listening, and the turn ends anyway after 3 seconds of silence.

So finished questions get an answer sooner than with the fixed 1.5 seconds, and a student who stops to think is not cut off.
