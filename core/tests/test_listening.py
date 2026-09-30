import numpy as np
import pytest
from voice_fakes import FakeSegment, FakeWhisper, ScriptedDetector, chunk

from professor_core.listening import (
    MAX_LISTEN_S,
    NO_SPEECH_TIMEOUT_S,
    Listening,
    pick_language,
    transcribe,
)


@pytest.mark.anyio
async def test_ends_on_the_pause_after_speech() -> None:
    detector = ScriptedDetector(speaking=3)
    listening = Listening("q1", detector)
    reasons = [await listening.feed(chunk()) for _ in range(4)]

    assert reasons == [None, None, None, "silence"]
    assert listening.heard_speech
    assert detector.resets == 1


@pytest.mark.anyio
async def test_gives_up_when_nobody_speaks() -> None:
    listening = Listening("q1", ScriptedDetector(speaking=0))
    reason = None
    while reason is None:
        reason = await listening.feed(chunk(0.5))
    assert reason == "silence"
    assert not listening.heard_speech
    assert listening.seconds == pytest.approx(NO_SPEECH_TIMEOUT_S)


@pytest.mark.anyio
async def test_stops_a_question_that_goes_on_too_long() -> None:
    listening = Listening("q1", ScriptedDetector(speaking=10_000))
    reason = None
    while reason is None:
        reason = await listening.feed(chunk(1.0))
    assert reason == "too_long"
    assert listening.seconds == pytest.approx(MAX_LISTEN_S)


@pytest.mark.anyio
async def test_gives_whisper_float_samples() -> None:
    listening = Listening("q1", ScriptedDetector())
    await listening.feed(np.array([0, 16384, -32768], dtype="<i2").tobytes())
    assert listening.audio().tolist() == [0.0, 0.5, -1.0]


def test_uses_the_language_the_student_chose() -> None:
    audio = np.zeros(32_000, dtype=np.float32)
    english = FakeWhisper(probabilities=(("en", 0.9), ("pt", 0.1)))
    assert pick_language(english, audio, "pt", "en") == "pt"
    assert pick_language(english, audio, "auto", "pt") == "en"


def test_keeps_the_last_language_for_short_answers() -> None:
    english = FakeWhisper(probabilities=(("en", 0.9), ("pt", 0.1)))
    one_word = np.zeros(8_000, dtype=np.float32)
    assert pick_language(english, one_word, "auto", "pt") == "pt"


def test_chooses_only_between_portuguese_and_english() -> None:
    spanish = FakeWhisper(probabilities=(("es", 0.7), ("pt", 0.2), ("en", 0.1)))
    assert pick_language(spanish, np.zeros(32_000, dtype=np.float32), "auto", "en") == "pt"


def test_uses_english_words_as_hints_only_for_portuguese() -> None:
    whisper = FakeWhisper()
    audio = np.zeros(32_000, dtype=np.float32)

    heard = transcribe(
        whisper, audio, spoken_language="pt", last_language="pt", english_words=["since"]
    )
    assert (heard.text, heard.lang) == ("since vs for?", "pt")
    assert whisper.calls[-1]["hotwords"] == "since"
    assert whisper.calls[-1]["language"] == "pt"

    transcribe(whisper, audio, spoken_language="en", last_language="pt", english_words=["since"])
    assert whisper.calls[-1]["hotwords"] is None


def test_drops_what_whisper_invents_for_silence() -> None:
    class Hallucinating(FakeWhisper):
        def transcribe(self, audio, **options):  # type: ignore[no-untyped-def]
            return iter([FakeSegment(" E aí", no_speech_prob=0.9), FakeSegment(" ok")]), None

    heard = transcribe(
        Hallucinating(),
        np.zeros(32_000, dtype=np.float32),
        spoken_language="pt",
        last_language="pt",
    )
    assert heard.text == "ok"
