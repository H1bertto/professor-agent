"""A conversation with the teacher: a Pipecat pipeline that streams answers to questions.

Only one answer runs in the pipeline at a time. A new question interrupts the running answer
and waits for it to end before it starts, so the frames coming out of the pipeline always
belong to one known question.
"""

import asyncio
import contextlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal

from loguru import logger
from pipecat.frames.frames import (
    ErrorFrame,
    Frame,
    InterruptionFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMMessagesAppendFrame,
    LLMTextFrame,
    LLMThoughtTextFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.llm_service import LLMService
from pipecat.workers.runner import WorkerRunner

HISTORY_LIMIT = 20
# Pipecat marks an answer as started before the provider replies, so the limit that matters is
# the time to the first words. Past it, the answer stops and the student sees an error.
FIRST_TEXT_TIMEOUT_S = 45.0
# After stopping a silent answer, how long to wait for the pipeline to confirm it ended.
STOP_GRACE_S = 2.0
# The next question waits until the previous answer is saved in the history, at most this long.
SAVE_TIMEOUT_S = 1.0
# Errors travel up the pipeline while the end of an answer travels down, so an empty answer
# waits this long for an error before it counts as complete.
ERROR_GRACE_S = 0.3


@dataclass(frozen=True)
class ResponseStarted:
    id: str


@dataclass(frozen=True)
class ResponseText:
    id: str
    text: str


@dataclass(frozen=True)
class ResponseFinished:
    id: str
    reason: Literal["complete", "cancelled"]


@dataclass(frozen=True)
class ResponseFailed:
    id: str
    error: BaseException


ConversationEvent = ResponseStarted | ResponseText | ResponseFinished | ResponseFailed
EventHandler = Callable[[ConversationEvent], Awaitable[None]]


@dataclass
class _Response:
    id: str
    question: str
    started: bool = False
    ended: bool = False
    produced_text: bool = False
    cancel_requested: bool = False
    timed_out: bool = False
    error: BaseException | None = None
    # What the student heard of this answer when they cut it off. It replaces the answer in the
    # history once the answer is saved there.
    heard: str | None = None
    heard_saved: bool = False


class Conversation:
    def __init__(
        self,
        llm: LLMService,
        on_event: EventHandler,
        *,
        history: list[Any] | None = None,
        history_limit: int = HISTORY_LIMIT,
        first_text_timeout_s: float = FIRST_TEXT_TIMEOUT_S,
    ) -> None:
        self._llm = llm
        self._on_event = on_event
        self._history_limit = history_limit
        self._first_text_timeout_s = first_text_timeout_s
        self._context = LLMContext(list(history or []))
        aggregators = LLMContextAggregatorPair(self._context)
        assistant = aggregators.assistant()
        assistant.add_event_handler("on_assistant_turn_stopped", self._on_answer_saved)
        self._worker = PipelineWorker(
            Pipeline(
                [
                    aggregators.user(),
                    _ErrorWatcher(self._on_error),
                    llm,
                    _ResponseWatcher(self._on_start, self._on_text, self._on_end),
                    assistant,
                ]
            ),
            # Pipecat stops a pipeline after five minutes without voice frames, which a text
            # conversation never has. The session decides when a conversation ends.
            idle_timeout_secs=None,
        )
        self._runner: asyncio.Task[None] | None = None
        self._active: _Response | None = None
        self._waiting: _Response | None = None
        self._last_finished: _Response | None = None
        # True between the end of an answer and the moment it is saved in the history.
        self._saving = False
        self._timers: set[asyncio.Task[None]] = set()

    @property
    def alive(self) -> bool:
        """False once the pipeline has stopped, after which it can no longer answer."""
        return self._runner is not None and not self._runner.done()

    @property
    def last_ending(self) -> Any:
        """How the provider ended the last answer, when the service tells."""
        return getattr(self._llm, "last_ending", None)

    @property
    def history(self) -> list[Any]:
        """The messages so far, to carry over into a new conversation after a settings change."""
        return list(self._context.get_messages())

    async def start(self) -> None:
        self._runner = asyncio.create_task(WorkerRunner(handle_sigint=False).run(self._worker))

    async def ask(self, message_id: str, question: str) -> None:
        replaced, self._waiting = self._waiting, _Response(message_id, question)
        if replaced:
            await self._emit(ResponseFinished(replaced.id, "cancelled"))
        if self._active is not None:
            await self._cancel_active()
        elif not self._saving:
            await self._send_waiting()

    async def cancel(self, message_id: str) -> None:
        if self._waiting and self._waiting.id == message_id:
            waiting, self._waiting = self._waiting, None
            await self._emit(ResponseFinished(waiting.id, "cancelled"))
        elif self._active and self._active.id == message_id:
            await self._cancel_active()

    def keep_only_heard(self, message_id: str, heard: str) -> None:
        """The student cut this answer off, so the history keeps only what they heard."""
        for response in (self._active, self._last_finished):
            if response is not None and response.id == message_id:
                response.heard = heard
                if response is self._last_finished and not self._saving:
                    self._save_heard(response)
                return

    async def close(self) -> None:
        unfinished = [response for response in (self._active, self._waiting) if response]
        self._active = self._waiting = None
        for timer in self._timers:
            timer.cancel()
        await self._worker.cancel()
        if self._runner:
            with contextlib.suppress(asyncio.CancelledError):
                await self._runner
        for response in unfinished:
            await self._emit(ResponseFinished(response.id, "cancelled"))

    async def _send_waiting(self) -> None:
        response, self._waiting = self._waiting, None
        if response is None:
            return
        self._active = response
        self._trim_history()
        self._after(self._first_text_timeout_s, lambda: self._first_text_timed_out(response))
        message = {"role": "user", "content": response.question}
        await self._worker.queue_frames([LLMMessagesAppendFrame([message], run_llm=True)])

    async def _cancel_active(self) -> None:
        response = self._active
        if response is None or response.cancel_requested:
            return
        response.cancel_requested = True
        # Before the answer starts there is nothing to interrupt. _on_start does it then.
        if response.started:
            await self._worker.queue_frames([InterruptionFrame()])

    def _trim_history(self) -> None:
        messages = list(self._context.get_messages())
        if len(messages) <= self._history_limit:
            return
        kept = messages[-self._history_limit :]
        # Providers expect the history to start with a question from the student.
        while kept and kept[0].get("role") != "user":
            kept.pop(0)
        self._context.set_messages(kept)

    async def _on_start(self) -> None:
        response = self._active
        if response is None or response.started:
            return
        response.started = True
        await self._emit(ResponseStarted(response.id))
        if response.cancel_requested:
            await self._worker.queue_frames([InterruptionFrame()])

    async def _on_text(self, text: str) -> None:
        response = self._active
        if (
            response
            and response.started
            and not response.cancel_requested
            and not response.timed_out
        ):
            response.produced_text = True
            await self._emit(ResponseText(response.id, text))

    async def _on_end(self) -> None:
        response = self._active
        if response is None or response.ended:
            return
        response.ended = True
        if response.cancel_requested:
            await self._finish(response, ResponseFinished(response.id, "cancelled"))
        elif response.error is not None:
            await self._finish(response, ResponseFailed(response.id, response.error))
        elif response.produced_text:
            await self._finish(response, ResponseFinished(response.id, "complete"))
        else:
            self._after(ERROR_GRACE_S, lambda: self._finish_after_grace(response))

    async def _on_error(self, error: BaseException) -> None:
        response = self._active
        if response is None:
            logger.warning(f"Provider error with no active answer: {type(error).__name__}")
            return
        if response.timed_out:
            # The timeout already explains this answer. Stopping it can raise errors of its own.
            return
        response.error = error
        if response.ended and not response.cancel_requested:
            await self._finish(response, ResponseFailed(response.id, error))

    async def _finish_after_grace(self, response: _Response) -> None:
        if response.error is not None:
            await self._finish(response, ResponseFailed(response.id, response.error))
        else:
            await self._finish(response, ResponseFinished(response.id, "complete"))

    async def _first_text_timed_out(self, response: _Response) -> None:
        if self._active is not response or response.produced_text or response.ended:
            return
        response.error = TimeoutError("The provider did not start answering in time.")
        if not response.started:
            await self._finish(response, ResponseFailed(response.id, response.error))
            return
        # Stop the request. The end of the answer then reports the timeout, and if that end
        # never comes, the answer fails anyway after a short grace.
        response.timed_out = True
        await self._worker.queue_frames([InterruptionFrame()])
        self._after(
            STOP_GRACE_S,
            lambda: self._finish(response, ResponseFailed(response.id, response.error)),
        )

    async def _finish(self, response: _Response, event: ConversationEvent) -> None:
        if self._active is not response:
            return
        self._active = None
        self._last_finished = response
        await self._emit(event)
        if not response.started:
            await self._send_waiting()
            return
        # The answer frames still have to reach the history. Sending the next question now
        # could put it before the answer, so wait for the save.
        self._saving = True
        self._after(SAVE_TIMEOUT_S, self._on_answer_saved)

    async def _on_answer_saved(self, *_: Any) -> None:
        if self._saving:
            self._saving = False
            if self._last_finished is not None:
                self._save_heard(self._last_finished)
            await self._send_waiting()

    def _save_heard(self, response: _Response) -> None:
        """Puts what the student heard in place of the answer, once, before the next question."""
        if response.heard is None or response.heard_saved:
            return
        response.heard_saved = True
        text = f"{response.heard} [interrupted]".strip()
        messages = list(self._context.get_messages())
        asked = {"role": "user", "content": response.question}
        if len(messages) >= 2 and messages[-1].get("role") == "assistant" and messages[-2] == asked:
            messages[-1] = {**messages[-1], "content": text}
        elif messages and messages[-1] == asked:
            # Cut off before a word was saved: the history still tells the teacher was interrupted.
            messages.append({"role": "assistant", "content": text})
        else:
            return
        self._context.set_messages(messages)

    def _after(self, delay_s: float, action: Callable[[], Awaitable[None]]) -> None:
        async def run() -> None:
            await asyncio.sleep(delay_s)
            await action()

        timer = asyncio.create_task(run())
        self._timers.add(timer)
        timer.add_done_callback(self._timers.discard)

    async def _emit(self, event: ConversationEvent) -> None:
        try:
            await self._on_event(event)
        except Exception:
            # A closed connection must not break the pipeline.
            logger.exception("Could not deliver a conversation event")


class _ResponseWatcher(FrameProcessor):
    """Sits after the LLM and reports the answer frames going down the pipeline."""

    def __init__(
        self,
        on_start: Callable[[], Awaitable[None]],
        on_text: Callable[[str], Awaitable[None]],
        on_end: Callable[[], Awaitable[None]],
    ) -> None:
        super().__init__()
        self._on_start = on_start
        self._on_text = on_text
        self._on_end = on_end

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)
        if direction == FrameDirection.DOWNSTREAM:
            if isinstance(frame, LLMFullResponseStartFrame):
                await self._on_start()
            elif isinstance(frame, LLMTextFrame) and not isinstance(frame, LLMThoughtTextFrame):
                await self._on_text(frame.text)
            elif isinstance(frame, LLMFullResponseEndFrame):
                await self._on_end()
        await self.push_frame(frame, direction)


class _ErrorWatcher(FrameProcessor):
    """Sits before the LLM and reports the errors it sends up the pipeline."""

    def __init__(self, on_error: Callable[[BaseException], Awaitable[None]]) -> None:
        super().__init__()
        self._on_error = on_error

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)
        if isinstance(frame, ErrorFrame) and direction == FrameDirection.UPSTREAM:
            await self._on_error(frame.exception or RuntimeError(frame.error))
        await self.push_frame(frame, direction)
