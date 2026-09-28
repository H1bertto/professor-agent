# Speech benchmark spike

Measures local text-to-speech (Kokoro on CPU) and speech-to-text (faster-whisper) on your machine, in Portuguese and English. The findings are in [RESULTS.md](RESULTS.md).

## Run

```bash
uv sync
uv run python benchmark.py                 # GPU, large-v3-turbo
uv run python benchmark.py --skip-tts \
  --device cpu --model small --compute-type int8   # CPU fallback
```

The first run downloads about 2 GB of models into `models/`. Generated audio and reports go to `output/`. Both folders are ignored by git.

The script also writes `../echo-cancellation/speech-sample.wav`, the clip used by the echo cancellation spike.

On Linux and WSL, the CUDA libraries come from the `nvidia-cublas-cu12` and `nvidia-cudnn-cu12` packages. The script adds them to `LD_LIBRARY_PATH` and restarts itself.
