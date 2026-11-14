"""Exercise bounded jobs deterministically without querying any archive."""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.schemas.cache_job import CacheJobRequest
from app.services.cache_jobs import (
    MAX_HISTORY,
    CacheJobs,
    CacheQueueFull,
    CacheWorkerClosed,
)
from app.services.cache_policy import CachePolicyError
from app.services.fits_download import FitsContentError, FitsDownloadError, FitsStore

BASE = "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/synthetic/v1/1/"
URLS = [BASE + f"level2_synthetic{n}D1_spx_v1.fits" for n in range(4)]


def request(urls=None, ra=100):
    return CacheJobRequest(access_urls=urls or URLS[:1], ra=ra, dec=20)


def finished(worker, job_id):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        result = worker.get(job_id)
        if result.finished_at is not None:
            return result
        threading.Event().wait(0.005)
    raise AssertionError("Cache job did not finish")


class ScriptedStore:
    """A test double for scheduling only, never a source of science responses."""

    def __init__(self):
        self.policy = SimpleNamespace(state=SimpleNamespace(writer=threading.RLock()))
        self.leases = 0
        self.cached = {}
        self.calls = []
        self.entered, self.release = threading.Event(), threading.Event()
        self.release.set()
        self.errors = {}
        self.after_fetch = lambda: None

    @contextmanager
    def lease(self, *args):
        self.leases += 1
        try:
            yield
        finally:
            self.leases -= 1

    def get_cached(self, url, *args):
        assert self.leases > 0
        return self.cached.get(url)

    def fetch(self, url, *args):
        assert self.leases > 0
        self.calls.append(url)
        self.entered.set()
        assert self.release.wait(5)
        if url in self.errors:
            raise self.errors[url]
        self.after_fetch()
        return SimpleNamespace(cached=False, size_bytes=40320)


@pytest.fixture
def store():
    return ScriptedStore()


@pytest.fixture
def worker(store):
    service = CacheJobs(store)
    try:
        yield service
    finally:
        store.release.set()
        service.close()


def test_no_work_without_explicit_submission(worker, store):
    assert store.calls == []
    assert not store.entered.is_set()
    assert worker.jobs == {}


def test_cached_items_are_reused_and_other_items_are_serial(worker, store):
    store.cached[URLS[0]] = SimpleNamespace(cached=True, size_bytes=40320)
    job = worker.submit(request(URLS))
    result = finished(worker, job.job_id)
    assert result.status == "completed"
    assert [item.status for item in result.items] == ["ready"] * 4
    assert [item.cached for item in result.items] == [True, False, False, False]
    assert store.calls == URLS[1:]
    assert store.leases == 0
    assert result.started_at and result.finished_at


def test_queue_capacity_includes_running_job_and_deduplicates(worker, store):
    store.release.clear()
    first = worker.submit(request())
    assert store.entered.wait(2)
    assert worker.submit(request()).job_id == first.job_id
    queued = [worker.submit(request(ra=100 + n)) for n in range(1, 4)]
    assert all(job.status == "queued" for job in queued)
    with pytest.raises(CacheQueueFull):
        worker.submit(request(ra=104))
    assert store.calls == URLS[:1]
    cancelled = worker.cancel(queued[0].job_id)
    assert cancelled.status == "cancelled"
    assert all(item.status == "cancelled" for item in cancelled.items)
    replacement = worker.submit(request(ra=104))
    assert replacement.status == "queued"
    # Returned snapshots cannot mutate worker state.
    replacement.items[0].status = "failed"
    assert worker.get(replacement.job_id).items[0].status == "pending"


def test_running_cancel_finishes_current_transfer_and_skips_next(worker, store):
    store.release.clear()
    job = worker.submit(request(URLS))
    assert store.entered.wait(2)
    pending = worker.cancel(job.job_id)
    assert pending.status == "running" and pending.cancellation_requested
    store.release.set()
    result = finished(worker, job.job_id)
    assert result.status == "cancelled"
    assert result.items[0].status == "ready"
    assert [item.status for item in result.items[1:]] == ["cancelled"] * 3
    assert store.calls == URLS[:1] and store.leases == 0
    assert worker.cancel(job.job_id) == result


def test_cancel_waiting_for_foreground_admission_does_not_download(worker, store):
    with store.policy.state.writer:
        job = worker.submit(request())
        limit = time.monotonic() + 2
        while worker.get(job.job_id).status == "queued" and time.monotonic() < limit:
            threading.Event().wait(0.005)
        worker.cancel(job.job_id)
        result = finished(worker, job.job_id)
        assert result.status == "cancelled" and store.calls == []
    assert store.leases == 0


def test_budget_stops_between_products(store):
    clock = [0.0]
    store.after_fetch = lambda: clock.__setitem__(0, 121)
    service = CacheJobs(store, clock=lambda: clock[0])
    try:
        result = finished(service, service.submit(request(URLS)).job_id)
        assert result.status == "expired"
        assert result.items[0].status == "ready"
        assert [item.status for item in result.items[1:]] == ["skipped"] * 3
        assert store.calls == URLS[:1]
    finally:
        service.close()


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (CachePolicyError("private path"), "cache_unavailable"),
        (FitsDownloadError("private URL"), "download_failed"),
        (FitsContentError("invalid fixture"), "invalid_data"),
        (RuntimeError("unexpected private detail"), "internal_error"),
    ],
)
def test_failures_are_honest_and_do_not_kill_worker(worker, store, error, code):
    store.errors[URLS[0]] = error
    result = finished(worker, worker.submit(request(URLS[:2])).job_id)
    assert result.status == "partial"
    assert result.items[0].status == "failed" and result.items[0].error == code
    assert result.items[0].cached is None and result.items[0].size_bytes is None
    assert result.items[1].status == "ready"
    failed = finished(worker, worker.submit(request()).job_id)
    assert failed.status == "failed"
    assert "private" not in failed.model_dump_json()
    assert worker.thread.is_alive() and store.leases == 0


def test_finished_history_is_bounded_and_old_ids_expire(worker):
    ids = []
    for _ in range(MAX_HISTORY + 2):
        job = worker.submit(request())
        finished(worker, job.job_id)
        ids.append(job.job_id)
    assert len(worker.jobs) == MAX_HISTORY
    assert worker.get(ids[0]) is None and worker.get(ids[1]) is None
    assert worker.get(ids[-1]).status == "completed"


def test_shutdown_cancels_queue_and_waits_for_active_transfer(store):
    service = CacheJobs(store)
    store.release.clear()
    first = service.submit(request(URLS[:2]))
    assert store.entered.wait(2)
    second = service.submit(request(ra=101))
    with ThreadPoolExecutor(max_workers=1) as pool:
        closing = pool.submit(service.close)
        try:
            deadline = time.monotonic() + 2
            while not service.stopping and time.monotonic() < deadline:
                threading.Event().wait(0.005)
            assert service.stopping and not closing.done()
            with pytest.raises(CacheWorkerClosed):
                service.submit(request(ra=102))
        finally:
            store.release.set()
        closing.result(timeout=5)
    assert service.get(first.job_id).status == "cancelled"
    assert service.get(second.job_id).status == "cancelled"
    assert not service.thread.is_alive() and store.calls == URLS[:1]


def test_api_queues_without_blocking_and_exposes_progress(monkeypatch):
    entered, release = threading.Event(), threading.Event()

    def fetch(*args):
        entered.set()
        assert release.wait(5)
        return SimpleNamespace(cached=False, size_bytes=40320)

    monkeypatch.setattr(FitsStore, "fetch", fetch)
    with TestClient(create_app()) as client:
        assert not entered.is_set()
        response = client.post("/api/cache/jobs", json=request().model_dump())
        assert response.status_code == 202
        job_id = response.json()["job_id"]
        try:
            assert entered.wait(2)
            assert client.get("/health").status_code == 200
            current = client.get(f"/api/cache/jobs/{job_id}").json()
            assert current["status"] == "running"
            assert current["items"][0]["status"] == "running"
            cancelled = client.post(f"/api/cache/jobs/{job_id}/cancel").json()
            assert cancelled["cancellation_requested"] is True
        finally:
            release.set()
        assert finished(client.app.state.cache_jobs, job_id).status == "cancelled"
        for method, path in [
            (client.get, "/api/cache/jobs/unknown"),
            (client.post, "/api/cache/jobs/unknown/cancel"),
        ]:
            assert method(path).status_code == 404
    assert not client.app.state.cache_jobs.thread.is_alive()


def test_api_capacity_and_duplicate_submission(monkeypatch):
    entered, release = threading.Event(), threading.Event()

    def fetch(*args):
        entered.set()
        assert release.wait(5)
        return SimpleNamespace(cached=False, size_bytes=40320)

    monkeypatch.setattr(FitsStore, "fetch", fetch)
    with TestClient(create_app()) as client:
        first = client.post("/api/cache/jobs", json=request().model_dump())
        try:
            assert entered.wait(2)
            duplicate = client.post("/api/cache/jobs", json=request().model_dump())
            assert duplicate.json()["job_id"] == first.json()["job_id"]
            for ra in range(101, 104):
                assert (
                    client.post(
                        "/api/cache/jobs", json=request(ra=ra).model_dump()
                    ).status_code
                    == 202
                )
            full = client.post("/api/cache/jobs", json=request(ra=104).model_dump())
            assert full.status_code == 429 and full.headers["Retry-After"] == "1"
        finally:
            release.set()


@pytest.mark.parametrize(
    ("patch", "code"),
    [
        ({"access_urls": []}, 422),
        ({"access_urls": URLS + [URLS[0]]}, 422),
        ({"access_urls": [URLS[0], URLS[0]]}, 400),
        ({"access_urls": [URLS[0], "https://example.com/secret.fits"]}, 400),
        ({"access_urls": [URLS[0] + "?token=secret"]}, 400),
        ({"access_urls": ["http://127.0.0.1/secret"]}, 400),
        ({"ra": 360}, 422),
        ({"dec": -91}, 422),
        ({"size_deg": 0.51}, 422),
        ({"advance": True}, 422),
    ],
)
def test_invalid_requests_do_not_queue_or_download(monkeypatch, patch, code):
    fetch = Mock(side_effect=AssertionError("Unexpected archive download"))
    monkeypatch.setattr(FitsStore, "fetch", fetch)
    with TestClient(create_app()) as client:
        response = client.post("/api/cache/jobs", json=request().model_dump() | patch)
        assert response.status_code == code
        assert client.app.state.cache_jobs.jobs == {}
    fetch.assert_not_called()


def test_real_store_uses_quota_and_cleans_invalid_download(mef, monkeypatch):
    from unittest.mock import MagicMock

    response = MagicMock()
    response.__enter__.return_value = response
    response.status_code = 200
    body = mef.read_bytes()
    response.headers = {"Content-Length": str(len(body))}
    response.iter_content.return_value = [body]
    get = Mock(return_value=response)
    monkeypatch.setattr("app.services.fits_download.requests.get", get)
    with TestClient(create_app()) as client:
        jobs = client.app.state.cache_jobs
        first = client.post("/api/cache/jobs", json=request().model_dump()).json()
        result = finished(jobs, first["job_id"])
        assert result.status == "completed" and result.items[0].cached is False
        again = client.post("/api/cache/jobs", json=request().model_dump()).json()
        assert finished(jobs, again["job_id"]).items[0].cached is True
        assert get.call_count == 1
        response.iter_content.return_value = [b"bad FITS"]
        response.headers = {}
        broken = client.post(
            "/api/cache/jobs", json=request(URLS[1:2]).model_dump()
        ).json()
        result = finished(jobs, broken["job_id"])
        assert result.status == "failed" and result.items[0].error == "invalid_data"
        status = client.get("/api/cache/status").json()
        assert status["fits_files"] == 1 and status["partial_files"] == 0
        assert status["protected_files"] == 0 and status["active_downloads"] == 0
        assert status["managed_bytes"] <= status["quota_bytes"]


def test_waiting_for_foreground_download_counts_toward_job_budget(store):
    clock, inspected = [0.0], threading.Event()
    original = store.get_cached

    def cached(*args):
        inspected.set()
        return original(*args)

    store.get_cached = cached
    service = CacheJobs(store, clock=lambda: clock[0])
    try:
        with store.policy.state.writer:
            job = service.submit(request())
            assert inspected.wait(2)
            clock[0] = 121
            result = finished(service, job.job_id)
            assert result.status == "expired" and store.calls == []
            assert result.items[0].status == "skipped"
    finally:
        service.close()


def test_background_job_respects_active_file_quota(mef, tmp_path, monkeypatch):
    from unittest.mock import MagicMock

    body = mef.read_bytes()
    response = MagicMock()
    response.__enter__.return_value = response
    response.status_code = 200
    response.headers = {"Content-Length": str(len(body))}
    response.iter_content.return_value = [body]
    get = Mock(return_value=response)
    monkeypatch.setattr("app.services.fits_download.requests.get", get)
    store = FitsStore(
        tmp_path / "fits", max_bytes=len(body), quota_bytes=len(body), idle_seconds=0
    )
    first = store.fetch(URLS[0], 100, 20)
    service = CacheJobs(store)
    try:
        with store.lease(URLS[0], 100, 20):
            result = finished(service, service.submit(request(URLS[1:2])).job_id)
            assert result.status == "failed"
            assert result.items[0].error == "cache_unavailable"
            assert first.path.exists() and get.call_count == 1
        assert store.status()["protected_files"] == 0
    finally:
        service.close()
