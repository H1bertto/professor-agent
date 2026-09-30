from collections.abc import Iterator

import pytest
from fake_provider import FakeProvider


@pytest.fixture(scope="session")
def fake_provider() -> Iterator[FakeProvider]:
    provider = FakeProvider()
    provider.start()
    yield provider
    provider.stop()


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
