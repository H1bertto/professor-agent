"""Speaks the teacher's answers with Kokoro, on this computer.

The answer streams in as text pieces tagged with their language. The speaker cuts it into
sentences, renders each one as soon as it is complete, and sends the audio to the desktop in
order, so the student hears the first sentence while the model still writes the rest.
"""

import asyncio
import re
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from itertools import groupby
from typing import Any, Literal

import numpy as np
from loguru import logger

from professor_core.markup import TextPiece
from professor_core.protocol import (
    AudioKind,
    CoreMessage,
    SpeechEnd,
    SpeechSegment,
    SpeechStart,
    SpokenLanguage,
    encode_audio,
)

SPEECH_SAMPLE_RATE = 24_000
TEACHER_VOICE = "pf_dora"
NATIVE_ENGLISH_VOICE = "af_heart"
KOKORO_LANGUAGES: dict[SpokenLanguage, str] = {"pt": "pt-br", "en": "en-us"}
# About 0.2 s of speech per audio frame, small enough to stop quickly after a cancel.
FRAME_SAMPLES = SPEECH_SAMPLE_RATE // 5
# The first sentence may stop at a comma once it is this long, so speech starts sooner.
FIRST_CLAUSE_MIN_CHARS = 25
# With the native English voice, only English this long, or a whole English sentence, changes
# voice. Rendered alone, a short Portuguese piece came out slower and lower (59 ms per phoneme,
# against 44 in one pass), so single English words stay in the teacher's voice.
NATIVE_MIN_WORDS = 3

EnglishVoice = Literal["teacher", "native"]
StopReason = Literal["cancelled", "error"]
Send = Callable[[CoreMessage], Awaitable[None]]
SendAudio = Callable[[bytes], Awaitable[None]]

# A sentence ends at . ! ? or … followed by a space, or at a line break. Waiting for the space
# keeps "3.5" in one piece while the text streams.
_SENTENCE_END = re.compile(r"[.!?…]+[\"')\]]*\s+|\n+")
_CLAUSE_END = re.compile(r",\s+")
_HAS_WORDS = re.compile(r"\w")


@dataclass(frozen=True)
class Piece:
    text: str
    lang: SpokenLanguage


class SentenceSplitter:
    """Collects streamed pieces and hands out whole sentences, keeping each piece's language."""

    def __init__(self) -> None:
        self._pieces: list[Piece] = []
        self._first = True

    def feed(self, pieces: Iterable[Piece]) -> list[list[Piece]]:
        self._pieces.extend(piece for piece in pieces if piece.text)
        sentences: list[list[Piece]] = []
        while cut := self._next_cut():
            sentence, self._pieces = _split_pieces(self._pieces, cut)
            sentences.append(sentence)
            self._first = False
        return sentences

    def flush(self) -> list[Piece]:
        rest, self._pieces = self._pieces, []
        return rest if any(_HAS_WORDS.search(piece.text) for piece in rest) else []

    def _next_cut(self) -> int | None:
        text = "".join(piece.text for piece in self._pieces)
        if match := _SENTENCE_END.search(text):
            return match.end()
        if self._first and (match := _CLAUSE_END.search(text, FIRST_CLAUSE_MIN_CHARS)):
            return match.end()
        return None


def _split_pieces(pieces: list[Piece], cut: int) -> tuple[list[Piece], list[Piece]]:
    before: list[Piece] = []
    after: list[Piece] = []
    offset = 0
    for piece in pieces:
        end = offset + len(piece.text)
        if end <= cut:
            before.append(piece)
        elif offset >= cut:
            after.append(piece)
        else:
            before.append(Piece(piece.text[: cut - offset], piece.lang))
            after.append(Piece(piece.text[cut - offset :], piece.lang))
        offset = end
    return before, after


@dataclass(frozen=True)
class SpokenPart:
    text: str
    lang: SpokenLanguage
    samples: np.ndarray


def render_sentence(
    kokoro: Any, pieces: list[Piece], english_voice: EnglishVoice
) -> list[SpokenPart]:
    """The audio for one sentence. Blocks while Kokoro runs, so call it from a thread."""
    pieces = _merge_blank_pieces(pieces)
    if not _has_words(pieces):
        return []
    if english_voice == "teacher":
        return [_in_teacher_voice(kokoro, pieces)]
    # The native voice says the longer English runs. Everything between them, short English
    # words included, is one part in the teacher's voice.
    parts = []
    for native, group in groupby(_runs_for_native_voice(pieces), key=lambda run: run[0]):
        run = [piece for _, pieces_of_run in group for piece in pieces_of_run]
        if native:
            text = _text(run)
            samples, _ = kokoro.create(
                text, voice=NATIVE_ENGLISH_VOICE, lang=KOKORO_LANGUAGES["en"]
            )
            parts.append(SpokenPart(text, "en", samples))
        elif _has_words(run):
            parts.append(_in_teacher_voice(kokoro, run))
    return parts


def _in_teacher_voice(kokoro: Any, pieces: list[Piece]) -> SpokenPart:
    """Each piece becomes phonemes in its own language, and they are rendered in one pass, so
    the sentence keeps one rhythm (variant C of the mixed-language spike)."""
    phonemes = " ".join(
        kokoro.tokenizer.phonemize(piece.text, KOKORO_LANGUAGES[piece.lang]).strip()
        for piece in pieces
    )
    samples, _ = kokoro.create(phonemes, voice=TEACHER_VOICE, is_phonemes=True)
    return SpokenPart(_text(pieces), _main(pieces), samples)


def _runs_for_native_voice(pieces: list[Piece]) -> list[tuple[bool, list[Piece]]]:
    """Each run of one language, and whether the native English voice says it."""
    runs = [(lang, list(run)) for lang, run in groupby(pieces, key=lambda piece: piece.lang)]
    has_portuguese = any(lang == "pt" and _has_words(run) for lang, run in runs)
    return [
        (lang == "en" and (not has_portuguese or _word_count(run) >= NATIVE_MIN_WORDS), run)
        for lang, run in runs
    ]


def _text(pieces: list[Piece]) -> str:
    return "".join(piece.text for piece in pieces).strip()


def _has_words(pieces: list[Piece]) -> bool:
    return any(_HAS_WORDS.search(piece.text) for piece in pieces)


def _word_count(pieces: list[Piece]) -> int:
    return sum(1 for word in _text(pieces).split() if _HAS_WORDS.search(word))


def _merge_blank_pieces(pieces: list[Piece]) -> list[Piece]:
    """Joins spaces to the piece before them, so "<en>since</en> <en>for</en>" keeps its space.

    Each part's text is then a piece of the answer as the bubble shows it, for the subtitles.
    """
    merged: list[Piece] = []
    for piece in pieces:
        if piece.text.strip():
            merged.append(piece)
        elif merged:
            merged[-1] = Piece(merged[-1].text + piece.text, merged[-1].lang)
    return merged


def _main(pieces: list[Piece]) -> SpokenLanguage:
    """The language with the most text in the sentence."""
    counts: dict[SpokenLanguage, int] = {}
    for piece in pieces:
        counts[piece.lang] = counts.get(piece.lang, 0) + len(piece.text)
    return max(counts, key=lambda lang: counts[lang])


def _spoken(lang: str | None, main_language: SpokenLanguage) -> SpokenLanguage:
    """A piece's language. Pieces without one are in the answer's main language."""
    if lang == "en":
        return "en"
    if lang == "pt":
        return "pt"
    return main_language


def pcm_frames(samples: np.ndarray) -> list[bytes]:
    """Float samples as 16-bit little-endian PCM, cut into short frames."""
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
    return [pcm[i : i + FRAME_SAMPLES].tobytes() for i in range(0, len(pcm), FRAME_SAMPLES)]


class Speaker:
    """Speaks one answer. Text goes in with `add`, and `finish` or `stop` ends it."""

    def __init__(
        self,
        question_id: str,
        kokoro: Any,
        *,
        main_language: SpokenLanguage,
        english_voice: EnglishVoice,
        send: Send,
        send_audio: SendAudio,
    ) -> None:
        self._id = question_id
        self._kokoro = kokoro
        self._main_language = main_language
        self._english_voice = english_voice
        self._send = send
        self._send_audio = send_audio
        self._splitter = SentenceSplitter()
        self._sentences: asyncio.Queue[list[Piece] | None] = asyncio.Queue()
        self._started = False
        self._next_index = 0
        self._stop_reason: StopReason = "cancelled"
        self.first_audio_at: float | None = None
        self._task = asyncio.create_task(self._speak())

    def add(self, pieces: Iterable[TextPiece]) -> None:
        """Adds streamed text, which gets spoken sentence by sentence."""
        resolved = [Piece(piece.text, _spoken(piece.lang, self._main_language)) for piece in pieces]
        for sentence in self._splitter.feed(resolved):
            self._sentences.put_nowait(sentence)

    def finish(self) -> None:
        """The answer is complete. What is left gets spoken, then speech ends."""
        if rest := self._splitter.flush():
            self._sentences.put_nowait(rest)
        self._sentences.put_nowait(None)

    def stop(self, reason: StopReason = "cancelled") -> None:
        """Stops speaking at once, for example when the student interrupts."""
        self._stop_reason = reason
        self._task.cancel()

    async def done(self) -> None:
        """Waits until the last audio went out, or the speaker stopped."""
        await asyncio.gather(self._task, return_exceptions=True)

    async def _speak(self) -> None:
        try:
            while (sentence := await self._sentences.get()) is not None:
                parts = await asyncio.to_thread(
                    render_sentence, self._kokoro, sentence, self._english_voice
                )
                for part in parts:
                    await self._send_part(part)
            await self._end("complete")
        except asyncio.CancelledError:
            await self._end(self._stop_reason)
            raise
        except Exception:
            logger.exception("Could not speak the answer")
            await self._end("error")

    async def _send_part(self, part: SpokenPart) -> None:
        if not self._started:
            self._started = True
            await self._send(SpeechStart(id=self._id, sample_rate=SPEECH_SAMPLE_RATE))
        await self._send(
            SpeechSegment(id=self._id, index=self._next_index, text=part.text, lang=part.lang)
        )
        self._next_index += 1
        for frame in pcm_frames(part.samples):
            if self.first_audio_at is None:
                self.first_audio_at = asyncio.get_running_loop().time()
            await self._send_audio(encode_audio(AudioKind.SPEECH, frame))

    async def _end(self, reason: Literal["complete", "cancelled", "error"]) -> None:
        if self._started:
            await self._send(SpeechEnd(id=self._id, reason=reason))


_PORTUGUESE_WORDS = frozenset(
    [
        "de",
        "que",
        "não",
        "nao",
        "é",
        "você",
        "voce",
        "como",
        "uma",
        "um",
        "eu",
        "para",
        "em",
        "os",
        "as",
        "da",
        "qual",
        "quando",
        "porque",
        "por",
        "com",
        "isso",
        "está",
        "esta",
        "o",
        "me",
        "minha",
        "meu",
        "se",
        "mais",
        "já",
        "ja",
        "também",
        "tambem",
    ]
)
_ENGLISH_WORDS = frozenset(
    [
        "the",
        "is",
        "are",
        "what",
        "how",
        "you",
        "i",
        "to",
        "and",
        "does",
        "in",
        "of",
        "when",
        "why",
        "can",
        "it",
        "my",
        "this",
        "that",
        "me",
        "with",
    ]
)
_PORTUGUESE_LETTERS = re.compile(r"[ãõçâêôáéíóú]")


def guess_language(text: str) -> SpokenLanguage | None:
    """Portuguese or English for a typed question, or `None` when it is not clear."""
    lowered = text.lower()
    words = re.findall(r"[\wà-ú']+", lowered)
    portuguese = sum(word in _PORTUGUESE_WORDS for word in words)
    portuguese += 2 if _PORTUGUESE_LETTERS.search(lowered) else 0
    english = sum(word in _ENGLISH_WORDS for word in words)
    if portuguese == english:
        return None
    return "pt" if portuguese > english else "en"
