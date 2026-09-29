import os
import sys

import uvicorn
from loguru import logger

from professor_core.app import create_app

# The core must never be reachable from other machines. See SECURITY.md.
HOST = "127.0.0.1"
DEFAULT_PORT = 8765


def run() -> None:
    port = int(os.environ.get("PROFESSOR_CORE_PORT", DEFAULT_PORT))
    token = os.environ.get("PROFESSOR_CORE_TOKEN") or None
    # Pipecat logs whole conversations at DEBUG level, so keep that off unless asked for.
    logger.remove()
    logger.add(sys.stderr, level=os.environ.get("PROFESSOR_CORE_LOG_LEVEL", "INFO"))
    uvicorn.run(create_app(token=token), host=HOST, port=port)
