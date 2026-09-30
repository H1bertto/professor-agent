import asyncio
from typing import Any

import numpy as np
import pytest
from voice_fakes import FakeKokoro

from professor_core.markup import TextPiece
from professor_core.protocol import (
    AudioKind,
    CoreMessage,
    SpeechEnd,
    SpeechSegment,
    SpeechStart,
    decode_audio,
)
from professor_core.speaking import (
    FRAME_SAMPLES,
    NATIVE_ENGLISH_VOICE,
    TEACHER_VOICE,
    Piece,
    SentenceSplitter,
    Speaker,
    guess_language,
    pcm_frames,
    render_sentence,
)


def texts(sentences: list[list[Piece]]) -> list[str]:
    return ["".join(piece.text for piece in sentence) for sentence in sentences]


def test_hands_out_whole_sentences_as_the_text_streams() -> None:
    splitter = SentenceSplitter()
    text = "Boa pergunta! Usamos since. O resto"
    sentences: list[list[Piece]] = []
    for letter in text:
        sentences += splitter.feed([Piece(letter, "pt")])

    assert texts(sentences) == ["Boa pergunta! ", "Usamos since. "]
    assert texts([splitter.flush()]) == ["O resto"]


def test_keeps_numbers_and_languages_together() -> None:
    splitter = SentenceSplitter()
    sentences = splitter.feed(
        [
            Piece("Custa 3.5 reais e se diz ", "pt"),
            Piece("three point five", "en"),
            Piece(". Ok", "pt"),
        ]
    )
    assert texts(sentences) == ["Custa 3.5 reais e se diz three point five. "]
    assert [piece.lang for piece in sentences[0]] == ["pt", "en", "pt"]


def test_the_first_sentence_can_stop_at_a_long_first_clause() -> None:
    splitter = SentenceSplitter()
    assert splitter.feed([Piece("Em inglês, usamos", "pt")]) == []
    first = splitter.feed([Piece(" o present perfect com since, e o passado com", "pt")])
    assert texts(first) == ["Em inglês, usamos o present perfect com since, "]
    # Only the first sentence stops at commas.
    assert splitter.feed([Piece(" ago, veja", "pt")]) == []


def test_drops_a_leftover_without_words() -> None:
    splitter = SentenceSplitter()
    splitter.feed([Piece("Ótimo! ", "pt")])
    splitter.feed([Piece(" ", "pt")])
    assert splitter.flush() == []


def test_the_teachers_voice_renders_a_mixed_sentence_in_one_pass() -> None:
    kokoro = FakeKokoro()
    sentence = [Piece("Usamos ", "pt"), Piece("since", "en"), Piece(" aqui.", "pt")]

    parts = render_sentence(kokoro, sentence, "teacher")

    assert kokoro.calls == [
        {
            "text": "<pt-br:Usamos> <en-us:since> <pt-br:aqui.>",
            "voice": TEACHER_VOICE,
            "lang": "en-us",
            "is_phonemes": True,
        }
    ]
    assert [(part.text, part.lang) for part in parts] == [("Usamos since aqui.", "pt")]


def test_the_native_voice_says_english_runs_in_an_english_voice() -> None:
    kokoro = FakeKokoro()
    sentence = [Piece("Usamos ", "pt"), Piece("since", "en"), Piece(".", "pt")]

    parts = render_sentence(kokoro, sentence, "native")

    assert [(call["text"], call["voice"], call["lang"]) for call in kokoro.calls] == [
        ("Usamos", TEACHER_VOICE, "pt-br"),
        ("since", NATIVE_ENGLISH_VOICE, "en-us"),
    ]
    assert [(part.text, part.lang) for part in parts] == [("Usamos", "pt"), ("since", "en")]


def test_sends_speech_as_short_16_bit_frames() -> None:
    frames = pcm_frames(np.array([0.5, -2.0] + [0.0] * FRAME_SAMPLES, dtype=np.float32))
    assert [len(frame) for frame in frames] == [FRAME_SAMPLES * 2, 4]
    assert np.frombuffer(frames[0][:4], dtype="<i2").tolist() == [16383, -32767]


class Wire:
    """Everything the speaker sends, messages and audio, in order."""

    def __init__(self) -> None:
        self.sent: list[Any] = []

    async def send(self, message: CoreMessage) -> None:
        self.sent.append(message)

    async def send_audio(self, frame: bytes) -> None:
        self.sent.append(decode_audio(frame))

    def kinds(self) -> list[str]:
        return [item.type if hasattr(item, "type") else "audio" for item in self.sent]


def speaker(wire: Wire, kokoro: FakeKokoro, english_voice: str = "teacher") -> Speaker:
    return Speaker(
        "q1",
        kokoro,
        main_language="pt",
        english_voice=english_voice,  # type: ignore[arg-type]
        send=wire.send,
        send_audio=wire.send_audio,
    )


@pytest.mark.anyio
async def test_speaks_each_sentence_with_its_subtitle_first() -> None:
    wire = Wire()
    voice = speaker(wire, FakeKokoro())
    voice.add([TextPiece("Boa pergunta! Usamos ", None), TextPiece("since", "en")])
    voice.add([TextPiece(".", None)])
    voice.finish()
    await voice.done()

    kinds = wire.kinds()
    assert kinds[0] == "speech.start"
    assert kinds[-1] == "speech.end"
    segments = [item for item in wire.sent if isinstance(item, SpeechSegment)]
    assert [(s.index, s.text, s.lang) for s in segments] == [
        (0, "Boa pergunta!", "pt"),
        (1, "Usamos since.", "pt"),
    ]
    # Audio follows the segment it belongs to.
    assert kinds.index("audio") > kinds.index("speech.segment")
    assert all(item[0] == AudioKind.SPEECH for item in wire.sent if isinstance(item, tuple))
    assert wire.sent[0] == SpeechStart(id="q1", sample_rate=24_000)
    assert wire.sent[-1] == SpeechEnd(id="q1", reason="complete")
    assert voice.first_audio_at is not None


@pytest.mark.anyio
async def test_stops_speaking_when_interrupted() -> None:
    wire = Wire()
    voice = speaker(wire, FakeKokoro())
    voice.add([TextPiece("Primeira frase. Segunda frase. ", None)])
    await asyncio.sleep(0.05)
    voice.stop()
    await voice.done()
    sent_before = len(wire.sent)
    await asyncio.sleep(0.05)

    assert wire.sent[-1] == SpeechEnd(id="q1", reason="cancelled")
    assert len(wire.sent) == sent_before


@pytest.mark.anyio
async def test_says_nothing_for_an_empty_answer() -> None:
    wire = Wire()
    voice = speaker(wire, FakeKokoro())
    voice.finish()
    await voice.done()
    assert wire.sent == []


def test_guesses_the_language_of_a_typed_question() -> None:
    assert guess_language("Qual a diferença entre since e for?") == "pt"
    assert guess_language("What is the difference between since and for?") == "en"
    assert guess_language("since?") is None
