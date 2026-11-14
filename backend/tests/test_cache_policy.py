"""Quota/preservation checks use disposable managed bytes and synthetic MEFs."""

import hashlib
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock, Mock

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services.cache_policy import (
    OWNER_NAME,
    STALE_PART_SECONDS,
    CachePolicyError,
    FitsCachePolicy,
)
from app.services.fits_download import FitsStore

URL = "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/synthetic/v1/1/level2_syntheticD1_spx_v1.fits"


def payload(directory, label, size, age=0):
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / (hashlib.sha256(label.encode()).hexdigest() + ".fits")
    path.write_bytes(b"x" * size)
    stamp = time.time() - age
    os.utime(path, (stamp, stamp))
    return path


def response_mock(monkeypatch, body):
    response = MagicMock()
    response.__enter__.return_value = response
    response.status_code = 200
    response.headers = {"Content-Length": str(len(body))}
    response.iter_content.return_value = [body]
    get = Mock(return_value=response)
    monkeypatch.setattr("app.services.fits_download.requests.get", get)
    return get, response


def test_lru_eviction_is_bounded_and_most_recent_files_survive(tmp_path):
    directory = tmp_path / "cache"
    old = payload(directory, "old", 40, age=30)
    middle = payload(directory, "middle", 40, age=20)
    recent = payload(directory, "recent", 40, age=10)
    policy = FitsCachePolicy(directory, quota_bytes=80, idle_seconds=0)
    report = policy.cleanup()
    assert report["removed_files"] == 1 and report["removed_bytes"] == 40
    assert not old.exists() and middle.exists() and recent.exists()
    assert policy.status()["managed_bytes"] == 80
    assert policy.status()["owned_directory"] is True


def test_active_leases_are_shared_between_store_instances(tmp_path):
    directory = tmp_path / "cache"
    old = payload(directory, "old", 40, age=30)
    middle = payload(directory, "middle", 40, age=20)
    recent = payload(directory, "recent", 40, age=10)
    first = FitsCachePolicy(directory, quota_bytes=80, idle_seconds=0)
    second = FitsCachePolicy(directory, quota_bytes=80, idle_seconds=0)
    with first.lease(old):
        second.cleanup()
        assert old.exists() and not middle.exists() and recent.exists()
        assert second.status()["protected_files"] == 1
    assert second.status()["protected_files"] == 0


def test_idle_expiry_uses_access_age_not_observation_dates(tmp_path):
    directory = tmp_path / "cache"
    old = payload(directory, "old", 20, age=20)
    recent = payload(directory, "recent", 20)
    policy = FitsCachePolicy(directory, quota_bytes=100, idle_seconds=10)
    policy.cleanup()
    assert not old.exists() and recent.exists()


def test_touch_preserves_a_hot_file_during_quota_cleanup(tmp_path):
    directory = tmp_path / "cache"
    old = payload(directory, "old", 40, age=30)
    middle = payload(directory, "middle", 40, age=20)
    recent = payload(directory, "recent", 40, age=10)
    policy = FitsCachePolicy(directory, quota_bytes=80, idle_seconds=0)
    policy.touch(old)
    policy.cleanup()
    assert old.exists() and not middle.exists() and recent.exists()


def test_stale_partials_are_removed_but_fresh_and_active_partials_survive(tmp_path):
    directory = tmp_path / "cache"
    policy = FitsCachePolicy(directory, quota_bytes=100, idle_seconds=0)
    policy.make_room(0)
    paths = []
    for key, label, age in [
        ("a", "old", STALE_PART_SECONDS + 1),
        ("b", "new", 0),
        ("c", "active", STALE_PART_SECONDS + 1),
    ]:
        path = directory / f".{key * 64}.{label}.part"
        path.write_bytes(b"x" * 10)
        stamp = time.time() - age
        os.utime(path, (stamp, stamp))
        paths.append(path)
    policy.state.active_parts.add(paths[2])
    try:
        report = policy.cleanup()
        assert not paths[0].exists() and paths[1].exists() and paths[2].exists()
        assert report["removed_bytes"] == 10
    finally:
        policy.state.active_parts.discard(paths[2])


def test_cleanup_refuses_to_adopt_a_source_directory(tmp_path):
    directory = tmp_path / "source"
    managed = payload(directory, "looks-like-cache", 40)
    readme = directory / "README.md"
    readme.write_text("user source")
    policy = FitsCachePolicy(directory, quota_bytes=1, idle_seconds=0)
    with pytest.raises(CachePolicyError):
        policy.cleanup()
    assert managed.exists() and readme.read_text() == "user source"
    assert not (directory / OWNER_NAME).exists()


def test_unknown_files_directories_and_links_are_never_removed(tmp_path):
    directory = tmp_path / "cache"
    policy = FitsCachePolicy(directory, quota_bytes=10, idle_seconds=0)
    policy.make_room(0)
    source = tmp_path / "source.fits"
    source.write_bytes(b"irreplaceable source")
    link = directory / ("a" * 64 + ".fits")
    link.symlink_to(source)
    hard = directory / ("b" * 64 + ".fits")
    os.link(source, hard)
    nested = directory / ("c" * 64 + ".fits")
    nested.mkdir()
    (nested / "notes.txt").write_text("keep")
    notes = directory / "notes.txt"
    notes.write_text("keep")
    policy.cleanup()
    assert source.read_bytes() == b"irreplaceable source"
    assert link.is_symlink() and hard.exists() and notes.exists()
    assert (nested / "notes.txt").exists()
    assert policy.status()["unmanaged_entries"] == 4
    with pytest.raises(CachePolicyError):
        policy.validate_path(link)


def test_symlink_root_is_rejected_without_following_it(tmp_path):
    real = tmp_path / "real"
    real.mkdir()
    link = tmp_path / "linked"
    link.symlink_to(real, target_is_directory=True)
    with pytest.raises(ValueError):
        FitsCachePolicy(link)
    assert list(real.iterdir()) == []


def test_changed_payload_is_not_unlinked_from_an_old_inventory_snapshot(tmp_path):
    directory = tmp_path / "cache"
    path = payload(directory, "old", 10)
    policy = FitsCachePolicy(directory, quota_bytes=100, idle_seconds=0)
    before = path.lstat()
    path.write_bytes(b"new user bytes")
    assert policy._unlink(path, before) is False
    assert path.read_bytes() == b"new user bytes"


def test_capacity_failure_does_not_discard_useful_unleased_files(tmp_path):
    directory = tmp_path / "cache"
    active = payload(directory, "active", 60)
    cold = payload(directory, "cold", 40, age=30)
    policy = FitsCachePolicy(directory, quota_bytes=100, idle_seconds=0)
    with policy.lease(active):
        result = policy.cleanup(required_bytes=60)
        assert result["capacity_available"] is False
        assert active.exists() and cold.exists()


def test_shared_cache_instances_cannot_disagree_on_limits(tmp_path):
    directory = tmp_path / "cache"
    FitsCachePolicy(directory, quota_bytes=100, idle_seconds=0)
    with pytest.raises(ValueError):
        FitsCachePolicy(directory, quota_bytes=200, idle_seconds=0)


def test_new_download_is_refused_without_network_when_active_files_fill_quota(
    mef, tmp_path, monkeypatch
):
    body = mef.read_bytes()
    get, _ = response_mock(monkeypatch, body)
    store = FitsStore(
        tmp_path / "cache", max_bytes=len(body), quota_bytes=len(body), idle_seconds=0
    )
    first = store.fetch(URL, 100.0, 20.0)
    with store.lease(URL, 100.0, 20.0):
        with pytest.raises(CachePolicyError):
            store.fetch(URL, 100.000001, 20.0)
        assert first.path.exists()
        assert get.call_count == 1
    second = store.fetch(URL, 100.000001, 20.0)
    assert second.path.exists() and not first.path.exists()
    assert store.status()["managed_bytes"] <= store.status()["quota_bytes"]


def test_active_image_reader_is_protected_until_processing_finishes(
    mef, tmp_path, monkeypatch
):
    from contextlib import contextmanager

    from app.services import cutout

    body = mef.read_bytes()
    get, _ = response_mock(monkeypatch, body)
    store = FitsStore(
        tmp_path / "cache", max_bytes=len(body), quota_bytes=len(body), idle_seconds=0
    )
    first = store.fetch(URL, 100.0, 20.0)
    entered, release = threading.Event(), threading.Event()
    original = cutout.open_observation

    @contextmanager
    def paused(path):
        with original(path) as data:
            entered.set()
            assert release.wait(5)
            yield data

    monkeypatch.setattr(cutout, "open_observation", paused)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(
            cutout.image_cutout, store, URL, 100.0, 20.0, 0.03, "linear"
        )
        try:
            assert entered.wait(5)
            with pytest.raises(CachePolicyError):
                store.fetch(URL, 100.000001, 20.0)
            assert first.path.exists() and store.status()["protected_files"] == 1
            assert get.call_count == 1
        finally:
            release.set()
        assert future.result(timeout=5).width == 16
    assert store.status()["protected_files"] == 0


def test_cached_reads_continue_during_a_serialized_new_download(
    mef, tmp_path, monkeypatch
):
    body = mef.read_bytes()
    _, response = response_mock(monkeypatch, body)
    store = FitsStore(
        tmp_path / "cache",
        max_bytes=len(body),
        quota_bytes=3 * len(body),
        idle_seconds=0,
    )
    first = store.fetch(URL, 100.0, 20.0)
    started, release = threading.Event(), threading.Event()

    def chunks(**kwargs):
        yield body[:1024]
        started.set()
        assert release.wait(5)
        yield body[1024:]

    response.iter_content.side_effect = chunks
    with ThreadPoolExecutor(max_workers=2) as pool:
        download = pool.submit(store.fetch, URL, 100.000001, 20.0)
        try:
            assert started.wait(5)
            cached = pool.submit(store.get_cached, URL, 100.0, 20.0).result(timeout=2)
            assert cached.path == first.path and cached.cached is True
            assert store.status()["active_downloads"] == 1
            assert store.status()["managed_bytes"] <= store.status()["quota_bytes"]
        finally:
            release.set()
        assert download.result(timeout=5).path.exists()
    assert store.status()["active_downloads"] == 0
    assert not list(store.directory.glob("*.part"))


def test_status_endpoint_is_read_only_and_does_not_expose_local_paths():
    with TestClient(create_app()) as client:
        response = client.get("/api/cache/status")
        assert response.status_code == 200
        data = response.json()
        assert data["quota_bytes"] == 512 * 1024 * 1024
        assert data["managed_bytes"] == 0
        assert "directory" not in data and "path" not in data
        assert client.post("/api/cache/clean").status_code == 404


@pytest.mark.parametrize(
    "values",
    [
        {"quota_bytes": 0},
        {"idle_seconds": -1},
        {"quota_bytes": True},
    ],
)
def test_invalid_policy_configuration_is_rejected(tmp_path, values):
    with pytest.raises(ValueError):
        FitsCachePolicy(tmp_path / "cache", **values)


def test_quota_must_fit_a_complete_per_file_reservation(tmp_path):
    with pytest.raises(ValueError):
        FitsStore(tmp_path / "cache", max_bytes=100, quota_bytes=99)
