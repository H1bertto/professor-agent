import os

import uvicorn

from professor_core.app import create_app

# The core must never be reachable from other machines. See SECURITY.md.
HOST = "127.0.0.1"
DEFAULT_PORT = 8765


def run() -> None:
    port = int(os.environ.get("PROFESSOR_CORE_PORT", DEFAULT_PORT))
    uvicorn.run(create_app(), host=HOST, port=port)
