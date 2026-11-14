"""Keep every API test isolated from the developer's runtime cache."""

import pytest


@pytest.fixture(autouse=True)
def isolated_cache(monkeypatch, tmp_path):
    monkeypatch.setenv("CACHE_DB_PATH", str(tmp_path / "cache" / "test.db"))
