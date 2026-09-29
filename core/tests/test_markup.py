import random

import pytest

from professor_core.markup import EmotionChange, MarkupEvent, MarkupParser, TextPiece

SAMPLES = [
    "[happy] Boa pergunta! Usamos <en>since</en> para o ponto de partida.",
    "Muito bem [relaxed] continue assim.",
    "Great![surprised] <pt>Saudade</pt> has no direct <en>translation</en>.",
    "Math: a < b and b > c, and [1] is a citation.",
    "Unclosed <en>sentence at the end",
    "Almost a tag [hap",
    "Emoji <3 and HTML <b>bold</b> stay as text.",
]


def parse(chunks: list[str]) -> list[MarkupEvent]:
    parser = MarkupParser()
    events: list[MarkupEvent] = []
    for chunk in chunks:
        events += parser.feed(chunk)
    return normalize(events + parser.finish())


def normalize(events: list[MarkupEvent]) -> list[MarkupEvent]:
    """Joins neighboring text pieces in the same language, so chunking does not matter."""
    merged: list[MarkupEvent] = []
    for event in events:
        last = merged[-1] if merged else None
        if isinstance(event, TextPiece) and isinstance(last, TextPiece) and last.lang == event.lang:
            merged[-1] = TextPiece(last.text + event.text, event.lang)
        else:
            merged.append(event)
    return merged


def test_emotions_and_language_spans() -> None:
    assert parse([SAMPLES[0]]) == [
        EmotionChange("happy"),
        TextPiece("Boa pergunta! Usamos ", None),
        TextPiece("since", "en"),
        TextPiece(" para o ponto de partida.", None),
    ]


def test_removing_a_tag_does_not_leave_double_spaces() -> None:
    assert parse([SAMPLES[1]]) == [
        TextPiece("Muito bem ", None),
        EmotionChange("relaxed"),
        TextPiece("continue assim.", None),
    ]


def test_space_after_punctuation_is_kept() -> None:
    events = parse([SAMPLES[2]])
    assert events[:3] == [
        TextPiece("Great!", None),
        EmotionChange("surprised"),
        TextPiece(" ", None),
    ]
    assert TextPiece("Saudade", "pt") in events


def test_text_that_only_looks_like_markup_stays_as_text() -> None:
    for sample in (SAMPLES[3], SAMPLES[6]):
        assert parse([sample]) == [TextPiece(sample, None)]


def test_unfinished_markup_at_the_end() -> None:
    assert parse([SAMPLES[4]]) == [
        TextPiece("Unclosed ", None),
        TextPiece("sentence at the end", "en"),
    ]
    assert parse([SAMPLES[5]]) == [TextPiece("Almost a tag [hap", None)]


def test_tags_are_case_insensitive() -> None:
    assert parse(["[Happy] <EN>Hi</EN>"]) == [EmotionChange("happy"), TextPiece("Hi", "en")]


@pytest.mark.parametrize("sample", SAMPLES)
def test_any_single_split_gives_the_same_result(sample: str) -> None:
    expected = parse([sample])
    for cut in range(1, len(sample)):
        assert parse([sample[:cut], sample[cut:]]) == expected, f"split at {cut}"


@pytest.mark.parametrize("sample", SAMPLES)
def test_random_multi_splits_give_the_same_result(sample: str) -> None:
    expected = parse([sample])
    rng = random.Random(42)
    for _ in range(200):
        cuts = sorted(rng.sample(range(1, len(sample)), k=min(5, len(sample) - 1)))
        chunks = [sample[a:b] for a, b in zip([0, *cuts], [*cuts, len(sample)], strict=True)]
        assert parse(chunks) == expected


def test_one_character_at_a_time() -> None:
    for sample in SAMPLES:
        assert parse(list(sample)) == parse([sample])
