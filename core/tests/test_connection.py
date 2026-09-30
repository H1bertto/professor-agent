from collections.abc import Iterator
from typing import Any

import pytest
from fake_provider import BAD_KEY, FakeProvider
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from professor_core.app import create_app
from professor_core.connection import token_matches

HELLO = {"type": "hello", "protocol": 1, "client": "test", "token": None}
PERSONA = {"name": "Professor", "instructions": ""}


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


def provider(fake: FakeProvider, key: str = "k") -> dict[str, Any]:
    return {
        "kind": "openai-compatible",
        "baseUrl": fake.openai_base_url,
        "model": "gpt-fake",
        "apiKey": key,
    }


def open_session(client: TestClient):  # type: ignore[no-untyped-def]
    socket = client.websocket_connect("/ws")
    ws = socket.__enter__()
    ws.send_json(HELLO)
    assert ws.receive_json()["type"] == "ready"
    return socket, ws


def receive_answer(ws, message_id: str) -> list[dict[str, Any]]:  # type: ignore[no-untyped-def]
    messages = []
    while True:
        message = ws.receive_json()
        messages.append(message)
        if message["type"] == "response.end" and message["id"] == message_id:
            return messages


def test_refuses_connections_from_web_pages(client: TestClient) -> None:
    with pytest.raises(WebSocketDisconnect):  # noqa: SIM117
        with client.websocket_connect("/ws", headers={"origin": "https://example.com"}) as ws:
            ws.receive_text()


def test_requires_the_token_when_one_is_set() -> None:
    with TestClient(create_app(token="launch-secret")) as secured:
        with secured.websocket_connect("/ws") as ws:
            ws.send_json({**HELLO, "token": "wrong"})
            with pytest.raises(WebSocketDisconnect) as closed:
                ws.receive_text()
            assert closed.value.code == 1008
        with secured.websocket_connect("/ws") as ws:
            ws.send_json({**HELLO, "token": "launch-secret"})
            assert ws.receive_json()["type"] == "ready"


def test_token_comparison() -> None:
    assert token_matches(None, None)
    assert token_matches("a", "a")
    assert not token_matches("a", None)
    assert not token_matches("a", "b")


def test_closes_when_the_first_message_is_not_hello(client: TestClient) -> None:
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "user.text", "id": "1", "text": "hi"})
        with pytest.raises(WebSocketDisconnect):
            ws.receive_text()


def test_answers_bad_messages_with_an_error_and_keeps_going(client: TestClient) -> None:
    socket, ws = open_session(client)
    ws.send_text("not json")
    assert ws.receive_json()["code"] == "bad_request"
    ws.send_json({"type": "user.text", "id": "q1", "text": "hi"})
    assert [m["type"] for m in receive_answer(ws, "q1")] == [
        "response.start",
        "error",
        "response.end",
    ]
    socket.__exit__(None, None, None)


def test_a_question_before_configuring_a_provider(client: TestClient) -> None:
    socket, ws = open_session(client)
    ws.send_json({"type": "user.text", "id": "q1", "text": "hi"})
    start, error, end = receive_answer(ws, "q1")
    assert start == {"type": "response.start", "id": "q1"}
    assert error["code"] == "not_configured"
    assert end == {"type": "response.end", "id": "q1", "reason": "error"}
    socket.__exit__(None, None, None)


def test_a_full_answer(client: TestClient, fake_provider: FakeProvider) -> None:
    socket, ws = open_session(client)
    ws.send_json({"type": "configure", "provider": provider(fake_provider), "persona": PERSONA})
    ws.send_json({"type": "user.text", "id": "q1", "text": "since vs for?"})
    messages = receive_answer(ws, "q1")

    assert messages[0] == {"type": "response.start", "id": "q1"}
    assert messages[1] == {"type": "response.emotion", "id": "q1", "emotion": "happy"}
    assert messages[-1] == {"type": "response.end", "id": "q1", "reason": "complete"}
    segments = [s for m in messages if m["type"] == "response.delta" for s in m["segments"]]
    assert (
        "".join(s["text"] for s in segments)
        == "Boa pergunta! Usamos since para o ponto de partida."
    )
    assert {"text": "since", "lang": "en"} in segments
    socket.__exit__(None, None, None)


def test_provider_errors_reach_the_desktop(client: TestClient, fake_provider: FakeProvider) -> None:
    socket, ws = open_session(client)
    ws.send_json(
        {"type": "configure", "provider": provider(fake_provider, BAD_KEY), "persona": PERSONA}
    )
    ws.send_json({"type": "user.text", "id": "q1", "text": "hi"})
    types = [(m["type"], m.get("code")) for m in receive_answer(ws, "q1")]
    assert types == [("response.start", None), ("error", "invalid_key"), ("response.end", None)]
    socket.__exit__(None, None, None)


def test_testing_a_provider(client: TestClient, fake_provider: FakeProvider) -> None:
    socket, ws = open_session(client)
    ws.send_json({"type": "provider.test", "requestId": "t1", "provider": provider(fake_provider)})
    result = ws.receive_json()
    assert result["type"] == "provider.test.result"
    assert result["ok"] is True
    assert "gpt-fake" in result["models"]

    ws.send_json(
        {"type": "provider.test", "requestId": "t2", "provider": provider(fake_provider, BAD_KEY)}
    )
    result = ws.receive_json()
    assert (result["ok"], result["code"]) == (False, "invalid_key")
    socket.__exit__(None, None, None)
