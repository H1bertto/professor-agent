import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from professor_core.protocol import (
    EMOTIONS,
    ProviderConfig,
    client_messages,
    core_messages,
)

FIXTURES = Path(__file__).parents[2] / "protocol" / "fixtures"


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("path", sorted((FIXTURES / "client").glob("*.json")), ids=lambda p: p.stem)
def test_client_fixtures_round_trip(path: Path) -> None:
    raw = load(path)
    message = client_messages.validate_python(raw)
    assert message.model_dump(by_alias=True, exclude_unset=True) == raw


@pytest.mark.parametrize("path", sorted((FIXTURES / "core").glob("*.json")), ids=lambda p: p.stem)
def test_core_fixtures_round_trip(path: Path) -> None:
    raw = load(path)
    message = core_messages.validate_python(raw)
    assert json.loads(message.to_json()) == raw


def test_emotions_match_the_shared_vocabulary() -> None:
    assert list(EMOTIONS) == load(FIXTURES / "emotions.json")


def test_unknown_message_types_and_fields_are_rejected() -> None:
    with pytest.raises(ValidationError):
        client_messages.validate_python({"type": "shutdown"})
    with pytest.raises(ValidationError):
        client_messages.validate_python({"type": "user.text", "id": "1", "text": "hi", "extra": 1})


def test_user_text_limits() -> None:
    with pytest.raises(ValidationError):
        client_messages.validate_python({"type": "user.text", "id": "1", "text": ""})
    with pytest.raises(ValidationError):
        client_messages.validate_python({"type": "user.text", "id": "1", "text": "x" * 8001})


def test_openai_compatible_providers_need_a_safe_base_url() -> None:
    base = {"kind": "openai-compatible", "model": "m", "apiKey": "k"}
    with pytest.raises(ValidationError):
        ProviderConfig.model_validate({**base, "baseUrl": None})
    with pytest.raises(ValidationError):
        ProviderConfig.model_validate({**base, "baseUrl": "http://example.com/v1"})
    assert ProviderConfig.model_validate({**base, "baseUrl": "http://localhost:1234/v1"})


def test_the_api_key_never_shows_in_repr_or_errors() -> None:
    config = ProviderConfig.model_validate(
        {"kind": "anthropic", "model": "m", "apiKey": "secret-value"}
    )
    assert "secret-value" not in repr(config)

    with pytest.raises(ValidationError) as error:
        ProviderConfig.model_validate({"kind": "anthropic", "model": "", "apiKey": "secret-value"})
    assert "secret-value" not in str(error.value)
