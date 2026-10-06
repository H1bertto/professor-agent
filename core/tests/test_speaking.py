import asyncio
from typing import Any, get_args

import numpy as np
import pytest
from voice_fakes import FakeKokoro

from professor_core.markup import TextPiece
from professor_core.protocol import (
    VOICE_OFF,
    AudioKind,
    CoreMessage,
    NativeVoice,
    SpeechEnd,
    SpeechSegment,
    SpeechStart,
    TeacherVoice,
    decode_audio,
)
from professor_core.speaking import (
    FRAME_SAMPLES,
    NATIVE_ENGLISH_VOICE,
    NATIVE_VOICES,
    TEACHER_VOICE,
    TEACHER_VOICES,
    Piece,
    SentenceSplitter,
    Speaker,
    Voices,
    guess_language,
    pcm_frames,
    render_sentence,
    voices_for,
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


def test_the_native_voice_says_longer_english_runs() -> None:
    kokoro = FakeKokoro()
    sentence = [
        Piece("Em inglês dizemos ", "pt"),
        Piece("I have been living here", "en"),
        Piece(".", "pt"),
    ]

    parts = render_sentence(kokoro, sentence, "native")

    assert [(call["text"], call["voice"], call["lang"]) for call in kokoro.calls] == [
        ("<pt-br:Em inglês dizemos>", TEACHER_VOICE, "en-us"),
        ("I have been living here", NATIVE_ENGLISH_VOICE, "en-us"),
    ]
    assert [(part.text, part.lang) for part in parts] == [
        ("Em inglês dizemos", "pt"),
        ("I have been living here", "en"),
    ]


def test_the_native_voice_leaves_single_english_words_to_the_teacher() -> None:
    kokoro = FakeKokoro()
    sentence = [Piece("Usamos ", "pt"), Piece("since", "en"), Piece(" aqui.", "pt")]

    parts = render_sentence(kokoro, sentence, "native")

    # One pass, as in the teacher's voice, so the Portuguese around the word keeps its pace.
    assert [(call["text"], call["voice"]) for call in kokoro.calls] == [
        ("<pt-br:Usamos> <en-us:since> <pt-br:aqui.>", TEACHER_VOICE)
    ]
    assert [(part.text, part.lang) for part in parts] == [("Usamos since aqui.", "pt")]


def test_the_native_voice_says_a_whole_english_sentence_however_short() -> None:
    kokoro = FakeKokoro()

    parts = render_sentence(kokoro, [Piece("Great job!", "en")], "native")

    assert [(call["text"], call["voice"]) for call in kokoro.calls] == [
        ("Great job!", NATIVE_ENGLISH_VOICE)
    ]
    assert [(part.text, part.lang) for part in parts] == [("Great job!", "en")]


def test_a_space_between_two_english_spans_is_kept() -> None:
    sentence = [
        Piece("since", "en"),
        Piece(" ", "pt"),
        Piece("for", "en"),
        Piece(" são diferentes.", "pt"),
    ]

    native = FakeKokoro()
    parts = render_sentence(native, sentence, "native")
    assert [call["text"] for call in native.calls] == [
        "<en-us:since> <en-us:for> <pt-br:são diferentes.>"
    ]
    assert [part.text for part in parts] == ["since for são diferentes."]

    teacher = FakeKokoro()
    parts = render_sentence(teacher, sentence, "teacher")
    assert [part.text for part in parts] == ["since for são diferentes."]


def test_speaks_with_the_chosen_voices() -> None:
    sentence = [Piece("Em inglês dizemos ", "pt"), Piece("I have been living here", "en")]
    voices = Voices(teacher="pm_alex", native="am_michael")

    teacher = FakeKokoro()
    render_sentence(teacher, sentence, "teacher", voices)
    assert [call["voice"] for call in teacher.calls] == ["pm_alex"]

    native = FakeKokoro()
    render_sentence(native, sentence, "native", voices)
    assert [call["voice"] for call in native.calls] == ["pm_alex", "am_michael"]


def test_every_voice_in_the_protocol_has_a_kokoro_voice() -> None:
    assert set(TEACHER_VOICES) == set(get_args(TeacherVoice))
    assert set(NATIVE_VOICES) == set(get_args(NativeVoice))
    config = VOICE_OFF.model_copy(update={"teacher_voice": "alex", "native_voice": "puck"})
    assert voices_for(config) == Voices(teacher="pm_alex", native="am_puck")


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
