from fastapi.testclient import TestClient

from professor_core import __version__
from professor_core.app import create_app


def test_health_reports_status_and_version() -> None:
    client = TestClient(create_app())

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": __version__}
