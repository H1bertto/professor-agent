from typing import Any

import pytest

from professor_core import server


@pytest.fixture
def uvicorn_calls(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    calls: dict[str, Any] = {}
    monkeypatch.setattr(server.uvicorn, "run", lambda app, **kwargs: calls.update(kwargs))
    return calls


def test_binds_to_localhost_only(uvicorn_calls: dict[str, Any]) -> None:
    server.run()

    assert uvicorn_calls["host"] == "127.0.0.1"


def test_uses_default_port(uvicorn_calls: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PROFESSOR_CORE_PORT", raising=False)

    server.run()

    assert uvicorn_calls["port"] == server.DEFAULT_PORT


def test_port_can_be_set_from_environment(
    uvicorn_calls: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PROFESSOR_CORE_PORT", "9123")

    server.run()

    assert uvicorn_calls["port"] == 9123
