import pytest
from fake_provider import (
    ANTHROPIC_MODELS,
    BAD_KEY,
    BUSY_KEY,
    DOWN_KEY,
    NO_CREDIT_KEY,
    OPENAI_MODELS,
    FakeProvider,
)

from professor_core.protocol import ProviderConfig
from professor_core.providers import (
    CHAT_MAX_RETRIES,
    REQUEST_TIMEOUT_S,
    create_llm_service,
    describe_provider_error,
    list_models,
)

pytestmark = pytest.mark.anyio


def anthropic_provider(fake: FakeProvider, key: str = "good-key") -> ProviderConfig:
    return ProviderConfig(
        kind="anthropic", base_url=fake.base_url, model="claude-opus-5", api_key=key
    )


def openai_provider(fake: FakeProvider, key: str = "good-key") -> ProviderConfig:
    return ProviderConfig(
        kind="openai-compatible", base_url=fake.openai_base_url, model="gpt-fake", api_key=key
    )


async def test_lists_anthropic_models_in_api_order(fake_provider: FakeProvider) -> None:
    assert await list_models(anthropic_provider(fake_provider)) == ANTHROPIC_MODELS


async def test_lists_openai_compatible_models_sorted(fake_provider: FakeProvider) -> None:
    assert await list_models(openai_provider(fake_provider)) == sorted(OPENAI_MODELS)


@pytest.mark.parametrize(
    ("key", "code"),
    [
        (BAD_KEY, "invalid_key"),
        (NO_CREDIT_KEY, "insufficient_credit"),
        (BUSY_KEY, "rate_limited"),
        (DOWN_KEY, "provider_unavailable"),
    ],
)
async def test_maps_provider_errors_to_protocol_codes(
    fake_provider: FakeProvider, key: str, code: str
) -> None:
    for provider in (anthropic_provider(fake_provider, key), openai_provider(fake_provider, key)):
        with pytest.raises(Exception) as caught:
            await list_models(provider, max_retries=0)
        assert describe_provider_error(caught.value)[0] == code, provider.kind


async def test_an_unreachable_provider_is_unavailable() -> None:
    provider = ProviderConfig(
        kind="openai-compatible", base_url="http://127.0.0.1:9/v1", model="m", api_key="k"
    )
    with pytest.raises(Exception) as caught:
        await list_models(provider, max_retries=0)
    assert describe_provider_error(caught.value)[0] == "provider_unavailable"


async def test_openai_compatible_answers_do_not_wait_forever(fake_provider: FakeProvider) -> None:
    llm = await create_llm_service(openai_provider(fake_provider), "You are a test teacher.")
    client = llm._client  # type: ignore[attr-defined]
    assert client.timeout == REQUEST_TIMEOUT_S
    assert client.max_retries == CHAT_MAX_RETRIES
    await client.close()


def test_timeouts_say_the_provider_was_too_slow() -> None:
    code, message = describe_provider_error(TimeoutError("no words"))
    assert code == "provider_unavailable"
    assert "too long" in message


def test_other_errors_are_internal_and_never_echo_details() -> None:
    code, message = describe_provider_error(ValueError("secret-value"))
    assert code == "internal"
    assert "secret-value" not in message
