from fastapi import FastAPI

from professor_core import __version__


def create_app() -> FastAPI:
    app = FastAPI(title="Professor Agent core", version=__version__)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    return app
