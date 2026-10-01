from fastapi import FastAPI, WebSocket

from professor_core import __version__
from professor_core.connection import serve_connection
from professor_core.speech_models import VoiceEngine


def create_app(*, token: str | None = None, voice: VoiceEngine | None = None) -> FastAPI:
    """`token`, when set, must come in the `hello` message of every connection.

    All connections share one voice engine, because the speech models are large.
    """
    app = FastAPI(title="Professor Agent core", version=__version__)
    engine = voice or VoiceEngine()

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.websocket("/ws")
    async def conversation_socket(websocket: WebSocket) -> None:
        await serve_connection(websocket, token=token, voice=engine)

    return app
