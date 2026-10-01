"""Messages between the desktop app and the core, version 2. See docs/protocol.md."""

from enum import IntEnum
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator
from pydantic.alias_generators import to_camel

PROTOCOL_VERSION = 2

Emotion = Literal["neutral", "happy", "sad", "angry", "surprised", "relaxed"]
EMOTIONS: tuple[Emotion, ...] = ("neutral", "happy", "sad", "angry", "surprised", "relaxed")

ErrorCode = Literal[
    "invalid_key",
    "rate_limited",
    "insufficient_credit",
    "model_not_found",
    "provider_unavailable",
    "not_configured",
    "no_speech",
    "voice_unavailable",
    "bad_request",
    "internal",
]

MessageId = Annotated[str, Field(min_length=1, max_length=64)]
SpokenLanguage = Literal["pt", "en"]


class AudioKind(IntEnum):
    """The first byte of a binary frame."""

    MICROPHONE = 0x01
    SPEECH = 0x02


MICROPHONE_SAMPLE_RATE = 16_000
# About two seconds of microphone audio. Real frames are much smaller.
MAX_AUDIO_FRAME_BYTES = 64 * 1024


def encode_audio(kind: AudioKind, pcm: bytes) -> bytes:
    """A binary frame: the kind byte, then 16-bit little-endian mono PCM."""
    return bytes([kind]) + pcm


def decode_audio(frame: bytes) -> tuple[AudioKind, bytes]:
    """Splits a binary frame. Raises ValueError for an unknown kind or broken samples."""
    if not frame or len(frame) > MAX_AUDIO_FRAME_BYTES:
        raise ValueError("audio frame is empty or too large")
    try:
        kind = AudioKind(frame[0])
    except ValueError:
        raise ValueError(f"unknown audio frame kind {frame[0]}") from None
    pcm = frame[1:]
    if len(pcm) % 2:
        raise ValueError("16-bit audio needs an even number of bytes")
    return kind, pcm


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


class VoiceConfig(Message):
    enabled: bool
    speak_answers: bool
    spoken_language: Literal["auto", "pt", "en"]
    english_voice: Literal["teacher", "native"]


VOICE_OFF = VoiceConfig(
    enabled=False, speak_answers=False, spoken_language="auto", english_voice="teacher"
)


class Configure(Message):
    type: Literal["configure"] = "configure"
    provider: ProviderConfig | None
    persona: PersonaConfig
    voice: VoiceConfig


class ProviderTest(Message):
    type: Literal["provider.test"] = "provider.test"
    request_id: MessageId
    provider: ProviderConfig


class UserText(Message):
    type: Literal["user.text"] = "user.text"
    id: MessageId
    text: str = Field(min_length=1, max_length=8000)


class ListenStart(Message):
    type: Literal["listen.start"] = "listen.start"
    id: MessageId


class ListenStop(Message):
    type: Literal["listen.stop"] = "listen.stop"
    id: MessageId


class ResponseCancel(Message):
    type: Literal["response.cancel"] = "response.cancel"
    id: MessageId


ClientMessage = Annotated[
    Hello | Configure | ProviderTest | UserText | ListenStart | ListenStop | ResponseCancel,
    Field(discriminator="type"),
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


class VoiceStatus(Message):
    type: Literal["voice.status"] = "voice.status"
    state: Literal["off", "downloading", "loading", "ready", "unavailable", "error"]
    progress: float | None = Field(default=None, ge=0, le=1)
    message: str | None = None


class ListenEnd(Message):
    type: Literal["listen.end"] = "listen.end"
    id: MessageId
    reason: Literal["silence", "stopped", "too_long", "cancelled"]


class Transcript(Message):
    type: Literal["transcript"] = "transcript"
    id: MessageId
    text: str
    lang: SpokenLanguage


class SpeechStart(Message):
    type: Literal["speech.start"] = "speech.start"
    id: MessageId
    sample_rate: int = Field(gt=0)


class SpeechSegment(Message):
    type: Literal["speech.segment"] = "speech.segment"
    id: MessageId
    index: int = Field(ge=0)
    text: str
    lang: SpokenLanguage


class SpeechEnd(Message):
    type: Literal["speech.end"] = "speech.end"
    id: MessageId
    reason: Literal["complete", "cancelled", "error"]


class TurnMetrics(Message):
    type: Literal["turn.metrics"] = "turn.metrics"
    id: MessageId
    listened_ms: int | None = None
    transcribe_ms: int | None = None
    first_text_ms: int | None = None
    first_audio_ms: int | None = None
    total_ms: int | None = None


CoreMessage = Annotated[
    Ready
    | VoiceStatus
    | ListenEnd
    | Transcript
    | ResponseStart
    | ResponseDelta
    | ResponseEmotion
    | ResponseEnd
    | SpeechStart
    | SpeechSegment
    | SpeechEnd
    | TurnMetrics
    | ProviderTestResult
    | ErrorMessage,
    Field(discriminator="type"),
]
core_messages: TypeAdapter[CoreMessage] = TypeAdapter(CoreMessage)
