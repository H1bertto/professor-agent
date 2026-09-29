"""Creates LLM services and lists models for the AI providers a student can connect."""

import re
from collections.abc import Sequence
from typing import Any

import anthropic
import openai
from pipecat.services.anthropic.llm import AnthropicLLMService
from pipecat.services.llm_service import LLMService
from pipecat.services.openai.llm import OpenAILLMService

from professor_core.protocol import ErrorCode, ProviderConfig

REQUEST_TIMEOUT_S = 30.0
LIST_MODELS_TIMEOUT_S = 15.0

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


class TutorOpenAILLMService(OpenAILLMService):
    """Pipecat's OpenAI service, closing its HTTP client when the conversation ends."""

    async def cleanup(self) -> None:
        await super().cleanup()
        await self._client.close()


async def create_llm_service(provider: ProviderConfig, system_prompt: str) -> LLMService:
    if provider.kind == "anthropic":
        return await _anthropic_service(provider, system_prompt)
    return TutorOpenAILLMService(
        api_key=provider.api_key,
        base_url=provider.base_url,
        settings=OpenAILLMService.Settings(model=provider.model, system_instruction=system_prompt),
    )


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
            return "provider_unavailable", "The provider is unavailable right now. Try again soon."
        return "bad_request", "The provider rejected the request."
    if isinstance(error, anthropic.APIConnectionError | openai.APIConnectionError | TimeoutError):
        return "provider_unavailable", "Could not reach the provider. Check the connection."
    return "internal", "Something went wrong while talking to the provider."
