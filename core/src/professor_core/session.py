"""Serves one desktop connection: turns protocol messages into a conversation and back."""

import asyncio
from collections.abc import Awaitable, Callable, Coroutine
from typing import Any, Literal

from loguru import logger

from professor_core.conversation import (
    Conversation,
    ConversationEvent,
    ResponseFailed,
    ResponseFinished,
    ResponseStarted,
    ResponseText,
)
from professor_core.markup import MarkupEvent, MarkupParser, TextPiece
from professor_core.persona import build_system_prompt
from professor_core.protocol import (
    ClientMessage,
    Configure,
    CoreMessage,
    ErrorMessage,
    ProviderTest,
    ProviderTestResult,
    ResponseCancel,
    ResponseDelta,
    ResponseEmotion,
    ResponseEnd,
    ResponseStart,
    Segment,
    UserText,
)
from professor_core.providers import create_llm_service, describe_provider_error, list_models

Send = Callable[[CoreMessage], Awaitable[None]]
PROVIDER_TEST_TIMEOUT_S = 20.0
MAX_LOGGED_ERROR_LENGTH = 300


class Session:
    def __init__(self, send: Send) -> None:
        self._send = send
        self._configuration: Configure | None = None
        self._conversation: Conversation | None = None
        self._parsers: dict[str, MarkupParser] = {}
        self._tasks: set[asyncio.Task[None]] = set()

    async def handle(self, message: ClientMessage) -> None:
        if isinstance(message, Configure):
            await self._configure(message)
        elif isinstance(message, ProviderTest):
            self._in_background(self._test_provider(message))
        elif isinstance(message, UserText):
            await self._ask(message)
        elif isinstance(message, ResponseCancel) and self._conversation:
            await self._conversation.cancel(message.id)

    async def close(self) -> None:
        for task in self._tasks:
            task.cancel()
        conversation, self._conversation = self._conversation, None
        if conversation:
            await conversation.close()

    async def _configure(self, message: Configure) -> None:
        self._configuration = message
        await self._restart_conversation()

    async def _restart_conversation(self) -> None:
        # A new provider or persona needs a new pipeline. The history carries over.
        previous, self._conversation = self._conversation, None
        history = previous.history if previous else []
        if previous:
            await previous.close()
        configuration = self._configuration
        if configuration is None or configuration.provider is None:
            return
        llm = await create_llm_service(
            configuration.provider, build_system_prompt(configuration.persona)
        )
        conversation = Conversation(llm, self._on_event, history=history)
        await conversation.start()
        self._conversation = conversation

    async def _ask(self, message: UserText) -> None:
        if self._conversation is not None and not self._conversation.alive:
            # A pipeline that stopped by itself would swallow every question from now on.
            logger.warning("The conversation pipeline had stopped. Starting a new one.")
            await self._restart_conversation()
        if self._conversation is None:
            await self._send(ResponseStart(id=message.id))
            await self._send(
                ErrorMessage(
                    id=message.id,
                    code="not_configured",
                    message="Choose an AI provider in the settings first.",
                )
            )
            await self._send(ResponseEnd(id=message.id, reason="error"))
            return
        await self._conversation.ask(message.id, message.text)

    async def _test_provider(self, message: ProviderTest) -> None:
        try:
            models = await asyncio.wait_for(
                list_models(message.provider), timeout=PROVIDER_TEST_TIMEOUT_S
            )
            result = ProviderTestResult(request_id=message.request_id, ok=True, models=models)
        except Exception as error:
            code, text = describe_provider_error(error)
            result = ProviderTestResult(
                request_id=message.request_id, ok=False, code=code, message=text
            )
        await self._send(result)

    async def _on_event(self, event: ConversationEvent) -> None:
        if isinstance(event, ResponseStarted):
            await self._start(event.id)
        elif isinstance(event, ResponseText):
            await self._start(event.id)
            await self._send_markup(event.id, self._parsers[event.id].feed(event.text))
        elif isinstance(event, ResponseFinished):
            await self._end(event.id, event.reason)
        elif isinstance(event, ResponseFailed):
            code, text = describe_provider_error(event.error)
            # The provider's own message explains most failures. It never holds the API key.
            detail = str(event.error)[:MAX_LOGGED_ERROR_LENGTH]
            logger.warning(
                f"Answer {event.id} failed: {type(event.error).__name__} ({code}): {detail}"
            )
            await self._start(event.id)
            await self._send(ErrorMessage(id=event.id, code=code, message=text))
            await self._end(event.id, "error")

    async def _start(self, response_id: str) -> None:
        if response_id not in self._parsers:
            self._parsers[response_id] = MarkupParser()
            await self._send(ResponseStart(id=response_id))

    async def _end(
        self, response_id: str, reason: Literal["complete", "cancelled", "error"]
    ) -> None:
        await self._start(response_id)
        await self._send_markup(response_id, self._parsers.pop(response_id).finish())
        await self._send(ResponseEnd(id=response_id, reason=reason))

    async def _send_markup(self, response_id: str, events: list[MarkupEvent]) -> None:
        segments: list[Segment] = []
        for event in events:
            if isinstance(event, TextPiece):
                segments.append(Segment(text=event.text, lang=event.lang))
                continue
            if segments:
                await self._send(ResponseDelta(id=response_id, segments=segments))
                segments = []
            await self._send(ResponseEmotion(id=response_id, emotion=event.emotion))
        if segments:
            await self._send(ResponseDelta(id=response_id, segments=segments))

    def _in_background(self, work: Coroutine[Any, Any, None]) -> None:
        task = asyncio.create_task(work)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
