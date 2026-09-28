"""Local voice pipeline and WebSocket server for Professor Agent."""

from importlib.metadata import version

__version__ = version("professor-core")


def main() -> None:
    from professor_core.server import run

    run()
