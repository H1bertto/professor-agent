from fastapi import FastAPI, WebSocket

from professor_core import __version__
from professor_core.connection import serve_connection


def create_app(*, token: str | None = None) -> FastAPI:
    """`token`, when set, must come in the `hello` message of every connection."""
    app = FastAPI(title="Professor Agent core", version=__version__)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.websocket("/ws")
    async def conversation_socket(websocket: WebSocket) -> None:
        await serve_connection(websocket, token=token)

    return app
