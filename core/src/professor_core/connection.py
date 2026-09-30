"""The WebSocket endpoint that the desktop app connects to. See docs/protocol.md."""

import asyncio
import hmac
from collections.abc import Awaitable, Callable, Mapping

from fastapi import WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from professor_core import __version__
from professor_core.protocol import (
    PROTOCOL_VERSION,
    AudioKind,
    CoreMessage,
    ErrorMessage,
    Hello,
    Ready,
    client_messages,
    decode_audio,
)
from professor_core.session import Session

HELLO_TIMEOUT_S = 5.0
POLICY_VIOLATION = 1008


def accepts_origin(headers: Mapping[str, str]) -> bool:
    """Browsers always send an Origin header. The desktop app's main process does not."""
    return "origin" not in headers


def token_matches(expected: str | None, provided: str | None) -> bool:
    if expected is None:
        return True
    return provided is not None and hmac.compare_digest(expected.encode(), provided.encode())


async def serve_connection(websocket: WebSocket, *, token: str | None) -> None:
    if not accepts_origin(websocket.headers):
        await websocket.close(code=POLICY_VIOLATION)
        return
    await websocket.accept()

    hello = await _receive_hello(websocket)
    if hello is None or not token_matches(token, hello.token):
        await websocket.close(code=POLICY_VIOLATION)
        return
    if hello.protocol != PROTOCOL_VERSION:
        message = f"This core speaks protocol version {PROTOCOL_VERSION}."
        await websocket.send_text(ErrorMessage(code="bad_request", message=message).to_json())
        await websocket.close(code=POLICY_VIOLATION)
        return

    send_lock = asyncio.Lock()

    async def send(message: CoreMessage) -> None:
        async with send_lock:
            await websocket.send_text(message.to_json())

    await send(Ready(core=__version__))
    session = Session(send)
    try:
        while True:
            frame = await websocket.receive()
            if frame["type"] == "websocket.disconnect":
                break
            if frame.get("bytes") is not None:
                await _receive_audio(frame["bytes"], session, send)
                continue
            try:
                message = client_messages.validate_json(frame.get("text") or "")
            except ValidationError:
                await send(ErrorMessage(code="bad_request", message="Could not read that message."))
                continue
            if isinstance(message, Hello):
                await send(ErrorMessage(code="bad_request", message="The session is already open."))
                continue
            await session.handle(message)
    except WebSocketDisconnect:
        pass
    finally:
        await session.close()


async def _receive_audio(
    frame: bytes, session: Session, send: Callable[[CoreMessage], Awaitable[None]]
) -> None:
    try:
        kind, pcm = decode_audio(frame)
    except ValueError:
        kind, pcm = None, b""
    if kind is not AudioKind.MICROPHONE:
        await send(ErrorMessage(code="bad_request", message="Could not read that audio frame."))
        return
    await session.handle_audio(pcm)


async def _receive_hello(websocket: WebSocket) -> Hello | None:
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=HELLO_TIMEOUT_S)
        message = client_messages.validate_json(raw)
    except (TimeoutError, ValidationError, WebSocketDisconnect):
        return None
    return message if isinstance(message, Hello) else None
