"""Turns the teacher's streamed text into clean text pieces and emotion changes.

The persona asks the model to mark its answers with emotion tags such as `[happy]` and with
language spans such as `<en>though</en>`. A tag can arrive split across stream chunks, so the
parser holds back only the few characters that can still become a tag.
"""

import re
from dataclasses import dataclass

from professor_core.protocol import EMOTIONS, Emotion

# Long enough for "[surprised]" and "</pt-br>".
_MAX_TAG_LENGTH = 12
_LANGUAGE_TAG = re.compile(r"<(/?)([a-z]{2}(?:-[a-z]{2})?)>", re.IGNORECASE)
_PARTIAL_EMOTION_TAG = re.compile(r"\[[a-zA-Z]*")
_PARTIAL_LANGUAGE_TAG = re.compile(r"</?[a-zA-Z-]*")


@dataclass(frozen=True)
class TextPiece:
    text: str
    lang: str | None


@dataclass(frozen=True)
class EmotionChange:
    emotion: Emotion


MarkupEvent = TextPiece | EmotionChange


class MarkupParser:
    """Parses one answer. Call `feed` for each chunk and `finish` at the end."""

    def __init__(self) -> None:
        self._pending = ""
        self._lang: str | None = None
        self._last_char = ""
        self._drop_next_space = False

    def feed(self, chunk: str) -> list[MarkupEvent]:
        self._pending += chunk
        return self._drain(final=False)

    def finish(self) -> list[MarkupEvent]:
        """Flushes what is left. An unfinished tag at the very end becomes plain text."""
        return self._drain(final=True)

    def _drain(self, *, final: bool) -> list[MarkupEvent]:
        events: list[MarkupEvent] = []
        text: list[str] = []
        buffer = self._pending
        index = 0

        def flush_text() -> None:
            if text:
                self._append_text(events, "".join(text))
                text.clear()

        while index < len(buffer):
            char = buffer[index]
            if char not in "[<":
                text.append(char)
                index += 1
                continue
            closing = "]" if char == "[" else ">"
            end = buffer.find(closing, index + 1, index + _MAX_TAG_LENGTH)
            if end == -1:
                if not final and self._may_become_tag(buffer[index:]):
                    break
                text.append(char)
                index += 1
                continue
            tag = buffer[index : end + 1]
            if not self._is_tag(tag):
                text.append(char)
                index += 1
                continue
            flush_text()
            self._apply_tag(tag, events)
            index = end + 1

        flush_text()
        self._pending = buffer[index:]
        return events

    def _is_tag(self, tag: str) -> bool:
        if tag.startswith("["):
            return tag[1:-1].strip().lower() in EMOTIONS
        return _LANGUAGE_TAG.fullmatch(tag) is not None

    def _apply_tag(self, tag: str, events: list[MarkupEvent]) -> None:
        if tag.startswith("["):
            events.append(EmotionChange(tag[1:-1].strip().lower()))  # type: ignore[arg-type]
            # "Muito bem [happy] continue" must not become "Muito bem  continue".
            self._drop_next_space = not self._last_char or self._last_char.isspace()
            return
        match = _LANGUAGE_TAG.fullmatch(tag)
        assert match is not None
        closing, code = match.groups()
        self._lang = None if closing else code.lower()

    def _may_become_tag(self, rest: str) -> bool:
        if len(rest) >= _MAX_TAG_LENGTH:
            return False
        pattern = _PARTIAL_EMOTION_TAG if rest[0] == "[" else _PARTIAL_LANGUAGE_TAG
        return pattern.fullmatch(rest) is not None

    def _append_text(self, events: list[MarkupEvent], text: str) -> None:
        if self._drop_next_space:
            self._drop_next_space = False
            if text.startswith(" "):
                text = text[1:]
        if not text:
            return
        self._last_char = text[-1]
        last = events[-1] if events else None
        if isinstance(last, TextPiece) and last.lang == self._lang:
            events[-1] = TextPiece(last.text + text, self._lang)
        else:
            events.append(TextPiece(text, self._lang))
