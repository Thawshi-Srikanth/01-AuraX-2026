"""Persistence, expiry, namespace isolation, and failure behaviour."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from app.db.cache import CacheManager
from app.main import create_app


def test_persistence_and_namespace_isolation(tmp_path):
    path = tmp_path / "nested" / "cache.db"
    cache = CacheManager(path)
    assert cache.get("target") is None
    value = {"ra": 10.5, "flags": [True, False], "name": "test fixture"}
    assert cache.set("target", value, namespace="resolve")
    assert cache.set("target", {"count": 2}, namespace="observations")
    reopened = CacheManager(path)
    assert reopened.get("target", "resolve") == value
    assert reopened.get("target", "observations") == {"count": 2}
    assert reopened.delete("target", "resolve")
    assert reopened.get("target", "resolve") is None
    assert reopened.get("target", "observations") == {"count": 2}
    assert reopened.delete("missing")


def test_expiry_boundary_and_cleanup(monkeypatch, tmp_path):
    monkeypatch.setattr("app.db.cache.time.time", lambda: 100.0)
    cache = CacheManager(tmp_path / "cache.db")
    assert cache.set("short", {"value": 1}, ttl_seconds=10)
    assert cache.set("permanent", {"value": 2})
    monkeypatch.setattr("app.db.cache.time.time", lambda: 109.9)
    assert cache.get("short") == {"value": 1}
    monkeypatch.setattr("app.db.cache.time.time", lambda: 110.0)
    assert cache.get("short") is None
    assert cache.purge_expired() == 1
    assert cache.purge_expired() == 0
    assert cache.get("permanent") == {"value": 2}


@pytest.mark.parametrize("ttl", [0, -1, float("nan"), float("inf")])
def test_invalid_expiry_preserves_previous_value(tmp_path, ttl):
    cache = CacheManager(tmp_path / "cache.db")
    assert cache.set("key", "original")
    assert not cache.set("key", "replacement", ttl_seconds=ttl)
    assert cache.get("key") == "original"


@pytest.mark.parametrize("value", [object(), float("nan"), {"value": float("inf")}])
def test_invalid_json_preserves_previous_value(tmp_path, value):
    cache = CacheManager(tmp_path / "cache.db")
    assert cache.set("key", "original")
    assert not cache.set("key", value)
    assert cache.get("key") == "original"


def test_concurrent_instances(tmp_path):
    path = tmp_path / "cache.db"
    caches = [CacheManager(path), CacheManager(path)]

    def write_and_read(index):
        cache = caches[index % 2]
        assert cache.set(str(index), {"index": index})
        assert cache.get(str(index)) == {"index": index}

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(write_and_read, range(32)))
    assert all(caches[0].get(str(i)) == {"index": i} for i in range(32))


def test_corrupted_entry_is_a_miss(tmp_path):
    path = tmp_path / "cache.db"
    cache = CacheManager(path)
    assert cache.set("broken", "original")
    connection = sqlite3.connect(path)
    try:
        with connection:
            connection.execute("UPDATE cache_store SET payload = 'invalid json'")
    finally:
        connection.close()
    assert cache.get("broken") is None
    assert cache.set("broken", "recovered")
    assert cache.get("broken") == "recovered"


def test_runtime_storage_failure_is_nonfatal(tmp_path):
    path = tmp_path / "cache.db"
    cache = CacheManager(path)
    path.unlink()
    path.mkdir()
    assert cache.get("key") is None
    assert not cache.set("key", "value")
    assert not cache.delete("key")
    assert cache.purge_expired() == 0


def test_app_initializes_cache_only_on_startup(monkeypatch, tmp_path):
    path = tmp_path / "runtime" / "cache.db"
    monkeypatch.setenv("CACHE_DB_PATH", str(path))
    app = create_app()
    assert not path.exists()
    with TestClient(app) as client:
        assert path.is_file()
        assert app.state.cache.set("key", {"value": 1})
        assert client.get("/health").status_code == 200
        assert set(client.get("/openapi.json").json()["paths"]) == {
            "/health",
            "/api/resolve",
            "/api/observations",
            "/api/cutout",
        }
    with TestClient(create_app()) as client:
        assert client.app.state.cache.get("key") == {"value": 1}
