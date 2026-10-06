import numpy as np
import pytest
from pipecat.audio.turn.base_turn_analyzer import EndOfTurnState
from pipecat.audio.vad.vad_analyzer import VADState
from voice_fakes import FakeJudge, FakeSegment, FakeWhisper, ScriptedDetector, chunk

from professor_core.listening import (
    EARLIER_S,
    MAX_LISTEN_S,
    NO_SPEECH_TIMEOUT_S,
    ConversationWatch,
    Listening,
    is_hallucination,
    pick_language,
    portuguese_prompt,
    smart_turn_judge,
    transcribe,
)


@pytest.mark.anyio
async def test_ends_on_the_pause_after_speech() -> None:
    detector = ScriptedDetector(speaking=3)
    listening = Listening("q1", detector, FakeJudge())
    reasons = [await listening.feed(chunk()) for _ in range(4)]

    assert reasons == [None, None, None, "silence"]
    assert listening.heard_speech
    assert detector.resets == 1


@pytest.mark.anyio
async def test_keeps_listening_through_a_thinking_pause() -> None:
    quiet, speaking = VADState.QUIET, VADState.SPEAKING
    detector = ScriptedDetector(script=[speaking, speaking, quiet, quiet, speaking, quiet])
    judge = FakeJudge(finished=False, max_silence=5)
    listening = Listening("q1", detector, judge)

    reasons = [await listening.feed(chunk()) for _ in range(10)]

    # Smart Turn hears an unfinished sentence at both pauses, so only the silence limit ends it.
    assert judge.pauses == 2
    assert reasons[:9] == [None] * 9
    assert reasons[9] == "silence"


@pytest.mark.anyio
async def test_gives_up_when_nobody_speaks() -> None:
    listening = Listening("q1", ScriptedDetector(speaking=0), FakeJudge())
    reason = None
    while reason is None:
        reason = await listening.feed(chunk(0.5))
    assert reason == "silence"
    assert not listening.heard_speech
    assert listening.seconds == pytest.approx(NO_SPEECH_TIMEOUT_S)


@pytest.mark.anyio
async def test_stops_a_question_that_goes_on_too_long() -> None:
    listening = Listening("q1", ScriptedDetector(speaking=10_000), FakeJudge())
    reason = None
    while reason is None:
        reason = await listening.feed(chunk(1.0))
    assert reason == "too_long"
    assert listening.seconds == pytest.approx(MAX_LISTEN_S)


@pytest.mark.anyio
async def test_gives_whisper_float_samples() -> None:
    listening = Listening("q1", ScriptedDetector(), FakeJudge())
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


def test_names_the_english_words_in_a_portuguese_prompt_only_for_portuguese() -> None:
    whisper = FakeWhisper()
    audio = np.zeros(32_000, dtype=np.float32)

    heard = transcribe(
        whisper, audio, spoken_language="pt", last_language="pt", english_words=["since"]
    )
    assert (heard.text, heard.lang) == ("since vs for?", "pt")
    assert whisper.calls[-1]["initial_prompt"] == (
        "Aluno brasileiro estudando inglês, usando palavras como since."
    )
    assert whisper.calls[-1]["language"] == "pt"
    # A bare list of English phrases made Whisper translate Portuguese questions into English.
    assert "hotwords" not in whisper.calls[-1]

    transcribe(whisper, audio, spoken_language="en", last_language="pt", english_words=["since"])
    assert whisper.calls[-1]["initial_prompt"] is None


def test_the_prompt_keeps_recent_short_english_words() -> None:
    words = ["for", "I have been living here since 2020", "since", "for"]
    assert portuguese_prompt(words) == (
        "Aluno brasileiro estudando inglês, usando palavras como since, for."
    )
    assert portuguese_prompt([]) is None
    assert portuguese_prompt(["a sentence that is far too long"]) is None

    many = [f"word{index}" for index in range(30)]
    prompt = portuguese_prompt(many) or ""
    assert "word29" in prompt and "word10" in prompt and "word9," not in prompt


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


@pytest.mark.anyio
async def test_the_watch_hands_over_the_turn_with_the_audio_just_before_it() -> None:
    quiet, starting, speaking = VADState.QUIET, VADState.STARTING, VADState.SPEAKING
    detector = ScriptedDetector(script=[quiet] * 40 + [starting, speaking])
    watch = ConversationWatch(detector)

    found = [await watch.feed(chunk()) for _ in range(42)]

    assert found[:41] == [None] * 41
    earlier = found[41]
    assert earlier is not None
    # Only the latest audio is kept, and the last chunks are marked as speech.
    assert len(earlier) * 0.032 <= EARLIER_S + 0.032
    assert [speech for _, speech in earlier[-2:]] == [True, True]

    listening = Listening("t1", detector, FakeJudge(), earlier=earlier)
    assert listening.heard_speech
    assert detector.resets == 1, "the turn keeps the detector that heard it start"


def test_drops_the_words_whisper_writes_for_noise() -> None:
    assert is_hallucination("Legendas pela comunidade Amara.org")
    assert is_hallucination("Thank you for watching.")
    assert not is_hallucination("Obrigado, professor!")
    assert not is_hallucination("Qual a diferença entre since e for?")


@pytest.mark.anyio
async def test_the_real_smart_turn_is_ready_out_of_a_pipeline() -> None:
    pytest.importorskip("onnxruntime")
    judge = smart_turn_judge()
    judge.append_audio(chunk(), True)
    judge.append_audio(chunk(), False)
    verdict, _ = await judge.analyze_end_of_turn()
    assert verdict in (EndOfTurnState.COMPLETE, EndOfTurnState.INCOMPLETE)
