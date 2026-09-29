"""Messages between the desktop app and the core, version 1. See docs/protocol.md."""

from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator
from pydantic.alias_generators import to_camel

PROTOCOL_VERSION = 1

Emotion = Literal["neutral", "happy", "sad", "angry", "surprised", "relaxed"]
EMOTIONS: tuple[Emotion, ...] = ("neutral", "happy", "sad", "angry", "surprised", "relaxed")

ErrorCode = Literal[
    "invalid_key",
    "rate_limited",
    "insufficient_credit",
    "model_not_found",
    "provider_unavailable",
    "not_configured",
    "bad_request",
    "internal",
]

MessageId = Annotated[str, Field(min_length=1, max_length=64)]

# Plain http is fine only when the provider runs on this computer.
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def is_safe_base_url(url: str) -> bool:
    """True for https URLs, and for http URLs whose host is this computer."""
    try:
        parts = urlsplit(url)
        host = parts.hostname
    except ValueError:
        return False
    if not host:
        return False
    return parts.scheme == "https" or (parts.scheme == "http" and host in LOCAL_HOSTS)


class Message(BaseModel):
    """Base for every protocol message: camelCase on the wire, immutable, no unknown fields."""

    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="forbid", frozen=True
    )

    def to_json(self) -> str:
        return self.model_dump_json(by_alias=True)


# Desktop to core


class ProviderConfig(Message):
    kind: Literal["anthropic", "openai-compatible"]
    base_url: str | None = Field(default=None, max_length=2048)
    model: str = Field(min_length=1, max_length=200)
    # repr=False keeps the key out of logs and error messages.
    api_key: str = Field(min_length=1, max_length=512, repr=False)

    @model_validator(mode="after")
    def _base_url_matches_kind(self) -> "ProviderConfig":
        if self.kind == "openai-compatible" and not self.base_url:
            raise ValueError("openai-compatible providers need a baseUrl")
        if self.base_url and not is_safe_base_url(self.base_url):
            raise ValueError("baseUrl must use https, or http on localhost")
        return self


class PersonaConfig(Message):
    name: str = Field(min_length=1, max_length=64)
    instructions: str = Field(default="", max_length=4000)


class Hello(Message):
    type: Literal["hello"] = "hello"
    protocol: int
    client: str = Field(max_length=64)
    token: str | None = Field(default=None, max_length=256, repr=False)


class Configure(Message):
    type: Literal["configure"] = "configure"
    provider: ProviderConfig | None
    persona: PersonaConfig


class ProviderTest(Message):
    type: Literal["provider.test"] = "provider.test"
    request_id: MessageId
    provider: ProviderConfig


class UserText(Message):
    type: Literal["user.text"] = "user.text"
    id: MessageId
    text: str = Field(min_length=1, max_length=8000)


class ResponseCancel(Message):
    type: Literal["response.cancel"] = "response.cancel"
    id: MessageId


ClientMessage = Annotated[
    Hello | Configure | ProviderTest | UserText | ResponseCancel, Field(discriminator="type")
]
client_messages: TypeAdapter[ClientMessage] = TypeAdapter(ClientMessage)


# Core to desktop


class Ready(Message):
    type: Literal["ready"] = "ready"
    protocol: int = PROTOCOL_VERSION
    core: str


class ResponseStart(Message):
    type: Literal["response.start"] = "response.start"
    id: MessageId


class Segment(Message):
    text: str
    lang: str | None = None


class ResponseDelta(Message):
    type: Literal["response.delta"] = "response.delta"
    id: MessageId
    segments: list[Segment]


class ResponseEmotion(Message):
    type: Literal["response.emotion"] = "response.emotion"
    id: MessageId
    emotion: Emotion


class ResponseEnd(Message):
    type: Literal["response.end"] = "response.end"
    id: MessageId
    reason: Literal["complete", "cancelled", "error"]


class ProviderTestResult(Message):
    type: Literal["provider.test.result"] = "provider.test.result"
    request_id: MessageId
    ok: bool
    models: list[str] = Field(default_factory=list)
    code: ErrorCode | None = None
    message: str | None = None


class ErrorMessage(Message):
    type: Literal["error"] = "error"
    id: MessageId | None = None
    code: ErrorCode
    message: str


CoreMessage = Annotated[
    Ready
    | ResponseStart
    | ResponseDelta
    | ResponseEmotion
    | ResponseEnd
    | ProviderTestResult
    | ErrorMessage,
    Field(discriminator="type"),
]
core_messages: TypeAdapter[CoreMessage] = TypeAdapter(CoreMessage)
