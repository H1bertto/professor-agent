"""Creates LLM services and lists models for the AI providers a student can connect."""

import re
from collections.abc import AsyncIterator, Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import anthropic
import openai
from loguru import logger
from pipecat.services.anthropic.llm import AnthropicLLMService
from pipecat.services.llm_service import LLMService
from pipecat.services.openai.llm import OpenAILLMService

from professor_core.protocol import ErrorCode, ProviderConfig

REQUEST_TIMEOUT_S = 30.0
LIST_MODELS_TIMEOUT_S = 15.0
# One quick retry covers a dropped connection. More would keep the student waiting.
CHAT_MAX_RETRIES = 1
GEMINI_HOST = "generativelanguage.googleapis.com"

# Answers stream, so a generous output cap costs nothing and never cuts an answer short.
# Each model reports its own limit, which wins when it is lower.
ANTHROPIC_MAX_OUTPUT = 64_000
ANTHROPIC_FALLBACK_OUTPUT = 8_192

# A spoken tutor needs fast first words more than deep reasoning.
TUTOR_EFFORT = "low"
_MODELS_WITH_EFFORT = re.compile(r"^claude-(opus|fable|mythos|sonnet)-(5|4-[6-9])(-|$)")

# Server-side refusal fallbacks let the API finish an answer on another model when these
# models decline a request.
REFUSAL_FALLBACK_BETA = "server-side-fallback-2026-07-01"
_MODELS_WITH_REFUSAL_FALLBACK = frozenset({"claude-opus-5", "claude-fable-5-1"})


class TutorAnthropicLLMService(AnthropicLLMService):
    """Pipecat's Anthropic service, plus beta flags that Pipecat would otherwise overwrite."""

    def __init__(self, *, extra_betas: Sequence[str] = (), **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._extra_betas = list(extra_betas)

    async def _create_message_stream(self, api_call: Any, params: dict[str, Any]) -> Any:
        if self._extra_betas:
            params = {**params, "betas": [*params.get("betas", []), *self._extra_betas]}
        return await super()._create_message_stream(api_call, params)

    async def cleanup(self) -> None:
        await super().cleanup()
        # Pipecat leaves the HTTP client open, which leaks connections between conversations.
        await self._client.close()


@dataclass
class AnswerEnding:
    """How the provider ended one streamed answer, which explains an empty one without its text."""

    text_chars: int = 0
    finish_reason: str | None = None
    completion_tokens: int | None = None
    reasoning_tokens: int | None = None

    def see(self, chunk: Any) -> None:
        if usage := getattr(chunk, "usage", None):
            self.completion_tokens = usage.completion_tokens
            details = usage.completion_tokens_details
            self.reasoning_tokens = details.reasoning_tokens if details else None
        for choice in getattr(chunk, "choices", None) or []:
            if choice.delta and choice.delta.content:
                self.text_chars += len(choice.delta.content)
            if choice.finish_reason:
                self.finish_reason = choice.finish_reason

    def describe(self) -> str:
        return (
            f"finish reason {self.finish_reason}, {self.completion_tokens} completion tokens, "
            f"{self.reasoning_tokens} of them for reasoning"
        )


class _WatchedStream:
    """Passes the chunks of an answer on unchanged, then tells how the answer ended."""

    def __init__(self, stream: Any, on_end: Callable[[AnswerEnding], None]) -> None:
        self._stream = stream
        self._on_end = on_end

    def __aiter__(self) -> AsyncIterator[Any]:
        return self._chunks()

    async def _chunks(self) -> AsyncIterator[Any]:
        ending = AnswerEnding()
        async for chunk in self._stream:
            ending.see(chunk)
            yield chunk
        self._on_end(ending)

    async def close(self) -> None:
        await self._stream.close()


def _report_empty_answer(ending: AnswerEnding) -> None:
    if ending.text_chars == 0:
        logger.warning(f"The provider ended an answer without text: {ending.describe()}")


class TutorOpenAILLMService(OpenAILLMService):
    """Pipecat's OpenAI service, with request timeouts and an HTTP client that gets closed."""

    async def get_chat_completions(self, context: Any) -> Any:
        # Some answers come back without a word. The log then tells why, without the text.
        stream = await super().get_chat_completions(context)
        return _WatchedStream(stream, _report_empty_answer)

    def create_client(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        organization: str | None = None,
        project: str | None = None,
        default_headers: Mapping[str, str] | None = None,
        **kwargs: Any,
    ) -> openai.AsyncOpenAI:
        # Pipecat's client would wait up to ten minutes, twice, for a silent provider.
        return openai.AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            organization=organization,
            project=project,
            default_headers=default_headers,
            timeout=REQUEST_TIMEOUT_S,
            max_retries=CHAT_MAX_RETRIES,
            # A plain HTTP client, as Pipecat passes. The SDK's own closes itself from a
            # finalizer on whatever event loop is running then, which fails in tests.
            http_client=openai.DefaultAsyncHttpxClient(),
        )

    async def cleanup(self) -> None:
        await super().cleanup()
        await self._client.close()


async def create_llm_service(provider: ProviderConfig, system_prompt: str) -> LLMService:
    if provider.kind == "anthropic":
        return await _anthropic_service(provider, system_prompt)
    return TutorOpenAILLMService(
        api_key=provider.api_key,
        base_url=provider.base_url,
        settings=OpenAILLMService.Settings(
            model=provider.model,
            system_instruction=system_prompt,
            extra=openai_compatible_extra(provider.base_url),
        ),
    )


def openai_compatible_extra(base_url: str | None) -> dict[str, Any]:
    """Provider-specific request fields. Other providers may reject them, so only these get them."""
    if base_url and urlsplit(base_url).hostname == GEMINI_HOST:
        # Gemini 3 models always think. The lowest level gives the fastest first words.
        return {"reasoning_effort": TUTOR_EFFORT}
    return {}


async def _anthropic_service(provider: ProviderConfig, system_prompt: str) -> LLMService:
    client = anthropic.AsyncAnthropic(
        api_key=provider.api_key, base_url=provider.base_url, timeout=REQUEST_TIMEOUT_S
    )
    extra: dict[str, Any] = {}
    betas: list[str] = []
    if _MODELS_WITH_EFFORT.match(provider.model):
        extra["output_config"] = {"effort": TUTOR_EFFORT}
    if provider.model in _MODELS_WITH_REFUSAL_FALLBACK:
        extra["fallbacks"] = "default"
        betas.append(REFUSAL_FALLBACK_BETA)
    return TutorAnthropicLLMService(
        api_key=provider.api_key,
        client=client,
        settings=AnthropicLLMService.Settings(
            model=provider.model,
            system_instruction=system_prompt,
            max_tokens=await _anthropic_output_limit(client, provider.model),
            extra=extra,
        ),
        extra_betas=betas,
    )


async def _anthropic_output_limit(client: anthropic.AsyncAnthropic, model: str) -> int:
    try:
        info = await client.models.retrieve(model)
    except anthropic.APIError:
        # The real request will report the problem, for example an unknown model.
        return ANTHROPIC_FALLBACK_OUTPUT
    if not info.max_tokens:
        return ANTHROPIC_FALLBACK_OUTPUT
    return min(ANTHROPIC_MAX_OUTPUT, info.max_tokens)


async def list_models(provider: ProviderConfig, *, max_retries: int = 1) -> list[str]:
    """The model ids the provider offers with this key. Raises the SDK error when it fails."""
    if provider.kind == "anthropic":
        async with anthropic.AsyncAnthropic(
            api_key=provider.api_key,
            base_url=provider.base_url,
            max_retries=max_retries,
            timeout=LIST_MODELS_TIMEOUT_S,
        ) as client:
            return [model.id async for model in client.models.list()]
    async with openai.AsyncOpenAI(
        api_key=provider.api_key,
        base_url=provider.base_url,
        max_retries=max_retries,
        timeout=LIST_MODELS_TIMEOUT_S,
    ) as client:
        return sorted([model.id async for model in client.models.list()])


def describe_provider_error(error: BaseException) -> tuple[ErrorCode, str]:
    """A protocol error code and a message that is safe to show to the student."""
    if isinstance(
        error,
        anthropic.AuthenticationError
        | anthropic.PermissionDeniedError
        | openai.AuthenticationError
        | openai.PermissionDeniedError,
    ):
        return "invalid_key", "The provider did not accept this API key."
    if isinstance(error, anthropic.NotFoundError | openai.NotFoundError):
        return "model_not_found", "The provider does not offer this model. Pick another one."
    if isinstance(error, openai.RateLimitError) and error.code == "insufficient_quota":
        return "insufficient_credit", "The provider account has no credit left."
    if isinstance(error, anthropic.RateLimitError | openai.RateLimitError):
        return "rate_limited", "The provider is receiving too many requests. Try again soon."
    if isinstance(error, anthropic.BadRequestError | openai.BadRequestError):
        # Anthropic reports a low balance as a 400 with no dedicated error class.
        if "credit balance" in error.message.lower():
            return "insufficient_credit", "The provider account has no credit left."
        return "bad_request", "The provider rejected the request."
    if isinstance(error, anthropic.APIStatusError | openai.APIStatusError):
        if error.status_code >= 500:
            # Often only one model is overloaded, so another one may work at once.
            return (
                "provider_unavailable",
                "The provider is busy or unavailable right now. "
                "Try again soon, or pick another model.",
            )
        return "bad_request", "The provider rejected the request."
    # Timeouts first: the SDK timeout errors are also connection errors.
    if isinstance(error, anthropic.APITimeoutError | openai.APITimeoutError | TimeoutError):
        return (
            "provider_unavailable",
            "The provider took too long to answer. Try again, or pick a faster model.",
        )
    if isinstance(error, anthropic.APIConnectionError | openai.APIConnectionError):
        return "provider_unavailable", "Could not reach the provider. Check the connection."
    return "internal", "Something went wrong while talking to the provider."
