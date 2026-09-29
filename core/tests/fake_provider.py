"""A local stand-in for the OpenAI and Anthropic APIs, so tests never use the network or credit."""

import asyncio
import json
import socket
import threading
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

REPLY = "[happy] Boa pergunta! Usamos <en>since</en> para o ponto de partida."
ANTHROPIC_MODELS = ["claude-opus-5", "claude-haiku-4-5"]
OPENAI_MODELS = ["gpt-fake", "a-fake-model"]
MODEL_MAX_TOKENS = 32_000

# Models and keys that make the fake provider behave in special ways.
SLOW_MODEL = "slow-model"
MISSING_MODEL = "missing-model"
BAD_KEY = "bad-key"
NO_CREDIT_KEY = "no-credit"
BUSY_KEY = "busy"
DOWN_KEY = "down"

_ANTHROPIC_ERRORS = {
    BAD_KEY: (401, "authentication_error", "invalid x-api-key"),
    NO_CREDIT_KEY: (
        400,
        "invalid_request_error",
        "Your credit balance is too low to access the API.",
    ),
    BUSY_KEY: (429, "rate_limit_error", "Number of requests has exceeded your rate limit."),
    DOWN_KEY: (529, "overloaded_error", "Overloaded"),
}
_OPENAI_ERRORS = {
    BAD_KEY: (401, "invalid_request_error", "invalid_api_key", "Incorrect API key provided."),
    NO_CREDIT_KEY: (429, "insufficient_quota", "insufficient_quota", "You exceeded your quota."),
    BUSY_KEY: (429, "requests", "rate_limit_exceeded", "Rate limit reached."),
    DOWN_KEY: (503, "server_error", None, "The server is overloaded."),
}


@dataclass
class RecordedRequest:
    path: str
    headers: dict[str, str]
    body: dict[str, Any] | None


class FakeProvider:
    def __init__(self, port: int | None = None) -> None:
        self.requests: list[RecordedRequest] = []
        self.port = port or _free_port()
        self.app = FastAPI()
        self._add_routes()
        self._server: uvicorn.Server | None = None

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    @property
    def openai_base_url(self) -> str:
        return f"{self.base_url}/v1"

    def start(self) -> None:
        config = uvicorn.Config(self.app, host="127.0.0.1", port=self.port, log_level="warning")
        self._server = uvicorn.Server(config)
        threading.Thread(target=self._server.run, daemon=True).start()
        deadline = time.monotonic() + 10
        while not self._server.started:
            if time.monotonic() > deadline:
                raise RuntimeError("The fake provider did not start.")
            time.sleep(0.02)

    def stop(self) -> None:
        if self._server:
            self._server.should_exit = True

    def last_request(self, path: str) -> RecordedRequest:
        return next(request for request in reversed(self.requests) if request.path == path)

    def _add_routes(self) -> None:
        app = self.app

        @app.get("/v1/models")
        async def list_models(request: Request) -> Response:
            self._record(request, None)
            if "anthropic-version" in request.headers:
                if error := _anthropic_error(request.headers.get("x-api-key")):
                    return error
                data = [_anthropic_model(model) for model in ANTHROPIC_MODELS]
                return JSONResponse(
                    {
                        "data": data,
                        "has_more": False,
                        "first_id": data[0]["id"],
                        "last_id": data[-1]["id"],
                    }
                )
            if error := _openai_error(_bearer(request)):
                return error
            data = [
                {"id": model, "object": "model", "created": 0, "owned_by": "fake"}
                for model in OPENAI_MODELS
            ]
            return JSONResponse({"object": "list", "data": data})

        @app.get("/v1/models/{model_id}")
        async def get_model(model_id: str, request: Request) -> Response:
            self._record(request, None)
            if error := _anthropic_error(request.headers.get("x-api-key")):
                return error
            if model_id == MISSING_MODEL:
                return _anthropic_error_response(404, "not_found_error", f"model: {model_id}")
            return JSONResponse(_anthropic_model(model_id))

        @app.post("/v1/chat/completions")
        async def chat(request: Request) -> Response:
            body = await request.json()
            self._record(request, body)
            if error := _openai_error(_bearer(request)):
                return error
            if body["model"] == MISSING_MODEL:
                return JSONResponse(
                    {
                        "error": {
                            "message": "No such model",
                            "type": "invalid_request_error",
                            "code": "model_not_found",
                        }
                    },
                    status_code=404,
                )

            async def stream() -> AsyncIterator[str]:
                async for word in _words(body["model"]):
                    chunk = {
                        "id": "fake",
                        "object": "chat.completion.chunk",
                        "created": 0,
                        "model": body["model"],
                        "choices": [
                            {"index": 0, "delta": {"content": word}, "finish_reason": None}
                        ],
                    }
                    yield f"data: {json.dumps(chunk)}\n\n"
                yield "data: [DONE]\n\n"

            return StreamingResponse(stream(), media_type="text/event-stream")

        @app.post("/v1/messages")
        async def messages(request: Request) -> Response:
            body = await request.json()
            self._record(request, body)
            if error := _anthropic_error(request.headers.get("x-api-key")):
                return error
            if body["model"] == MISSING_MODEL:
                return _anthropic_error_response(404, "not_found_error", "model not found")

            async def stream() -> AsyncIterator[str]:
                message = {
                    "id": "msg_fake",
                    "type": "message",
                    "role": "assistant",
                    "model": body["model"],
                    "content": [],
                    "stop_reason": None,
                    "stop_sequence": None,
                    "usage": {
                        "input_tokens": 10,
                        "output_tokens": 1,
                        "cache_creation_input_tokens": 0,
                        "cache_read_input_tokens": 0,
                    },
                }
                yield _sse("message_start", {"type": "message_start", "message": message})
                yield _sse(
                    "content_block_start",
                    {
                        "type": "content_block_start",
                        "index": 0,
                        "content_block": {"type": "text", "text": ""},
                    },
                )
                async for word in _words(body["model"]):
                    yield _sse(
                        "content_block_delta",
                        {
                            "type": "content_block_delta",
                            "index": 0,
                            "delta": {"type": "text_delta", "text": word},
                        },
                    )
                yield _sse("content_block_stop", {"type": "content_block_stop", "index": 0})
                yield _sse(
                    "message_delta",
                    {
                        "type": "message_delta",
                        "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                        "usage": {
                            "input_tokens": 0,
                            "output_tokens": 20,
                            "cache_creation_input_tokens": 0,
                            "cache_read_input_tokens": 0,
                        },
                    },
                )
                yield _sse("message_stop", {"type": "message_stop"})

            return StreamingResponse(stream(), media_type="text/event-stream")

    def _record(self, request: Request, body: dict[str, Any] | None) -> None:
        headers = {
            key: value for key, value in request.headers.items() if key.startswith("anthropic-")
        }
        self.requests.append(RecordedRequest(request.url.path, headers, body))


async def _words(model: str) -> AsyncIterator[str]:
    slow = model == SLOW_MODEL
    text = " ".join([REPLY] * (4 if slow else 1))
    words = text.split(" ")
    for index, word in enumerate(words):
        await asyncio.sleep(0.05 if slow else 0.002)
        yield word if index == len(words) - 1 else f"{word} "


def _anthropic_model(model_id: str) -> dict[str, Any]:
    return {
        "type": "model",
        "id": model_id,
        "display_name": model_id,
        "created_at": "2026-01-01T00:00:00Z",
        "max_input_tokens": 200_000,
        "max_tokens": MODEL_MAX_TOKENS,
    }


def _anthropic_error(key: str | None) -> Response | None:
    if key not in _ANTHROPIC_ERRORS:
        return None
    status, kind, message = _ANTHROPIC_ERRORS[key]
    return _anthropic_error_response(status, kind, message)


def _anthropic_error_response(status: int, kind: str, message: str) -> Response:
    return JSONResponse(
        {"type": "error", "error": {"type": kind, "message": message}}, status_code=status
    )


def _openai_error(key: str | None) -> Response | None:
    if key not in _OPENAI_ERRORS:
        return None
    status, kind, code, message = _OPENAI_ERRORS[key]
    return JSONResponse(
        {"error": {"message": message, "type": kind, "code": code}}, status_code=status
    )


def _bearer(request: Request) -> str | None:
    value = request.headers.get("authorization", "")
    return value.removeprefix("Bearer ") if value.startswith("Bearer ") else None


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


if __name__ == "__main__":
    # Try the desktop app without a real provider or credit:
    #   uv run python tests/fake_provider.py [port]
    import sys

    fake = FakeProvider(int(sys.argv[1]) if len(sys.argv) > 1 else 8790)
    print(f"Fake provider at {fake.openai_base_url}, models gpt-fake and {SLOW_MODEL}")
    uvicorn.run(fake.app, host="127.0.0.1", port=fake.port, log_level="warning")
