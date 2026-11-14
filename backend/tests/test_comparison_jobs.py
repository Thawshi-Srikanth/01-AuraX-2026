"""Background date-search scheduling with explicitly synthetic science fixtures."""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from test_comparison_matches import candidates as candidates
from test_comparison_matches import client as client

from app.main import create_app
from app.schemas.comparison_matches import MatchRequest
from app.services import comparison_jobs as jobs
from app.services import comparison_matches as matching
from app.services.comparison_jobs import SearchWorkerClosed
from app.services.observations import ArchiveUnavailable, InvalidArchiveResponse

PATH = "/api/compare/matches/jobs"
PAYLOAD = {"ra": 100, "dec": 20}


def done(client, job_id):
    limit = time.monotonic() + 5
    while time.monotonic() < limit:
        response = client.get(f"{PATH}/{job_id}")
        assert response.status_code == 200, response.text
        result = response.json()
        if result["finished_at"] is not None:
            return result
        threading.Event().wait(0.005)
    raise AssertionError("Date-search job did not finish")


def start(client, **overrides):
    response = client.post(PATH, json=PAYLOAD | overrides)
    assert response.status_code == 202, response.text
    return response.json()


def test_job_returns_actual_partial_result_without_automatic_downloads(client):
    job = start(client)
    result = done(client, job["job_id"])
    assert result["status"] == "completed"
    assert result["result"]["status"] == "partial"
    assert result["result"]["pending_count"] == 5
    assert result["candidate_count"] == 5 and result["processed_count"] == 0
    assert result["new_download_attempts"] == 0
    client.app.state.fits_store.fetch.assert_not_called()
    assert client.post(f"{PATH}/{job['job_id']}/cancel").json() == result


def test_explicit_advance_is_one_pass_and_can_resume_with_sync_endpoint(client):
    result = done(client, start(client, advance=True)["job_id"])
    assert result["status"] == "completed"
    assert result["result"]["verified_count"] == 2
    assert result["result"]["pending_count"] == 3
    assert result["new_download_attempts"] == 2
    assert result["processed_count"] == 2
    assert client.app.state.fits_store.fetch.call_count == 2
    response = client.post("/api/compare/matches", json=PAYLOAD)
    assert response.status_code == 200
    assert response.json()["verified_count"] == 2
    assert response.json()["state_cached"] is True
    assert client.app.state.fits_store.fetch.call_count == 2


def test_slow_metadata_does_not_block_health_or_job_polling(client, candidates):
    entered, release = threading.Event(), threading.Event()
    original = candidates[3].side_effect

    def slow(request):
        entered.set()
        assert release.wait(5)
        return original(request)

    candidates[3].side_effect = slow
    job = start(client)
    try:
        assert entered.wait(2)
        state = client.get(f"{PATH}/{job['job_id']}").json()
        assert state["status"] == "running" and state["stage"] == "metadata"
        assert state["candidate_count"] is None and state["result"] is None
        assert client.get("/health").status_code == 200
        # The original endpoint retains its immediate busy behavior.
        assert client.post("/api/compare/matches", json=PAYLOAD).status_code == 409
        cancelled = client.post(f"{PATH}/{job['job_id']}/cancel").json()
        assert cancelled["status"] == "running" and cancelled["cancellation_requested"]
    finally:
        release.set()
    result = done(client, job["job_id"])
    assert result["status"] == "cancelled" and result["result"] is None
    client.app.state.fits_store.fetch.assert_not_called()


def test_queue_is_bounded_deduplicated_and_cancelled_queue_frees_capacity(
    client, candidates
):
    entered, release = threading.Event(), threading.Event()
    original = candidates[3].side_effect

    def slow(request):
        entered.set()
        assert release.wait(5)
        return original(request)

    candidates[3].side_effect = slow
    first = start(client)
    try:
        assert entered.wait(2)
        assert start(client)["job_id"] == first["job_id"]
        queued = [start(client, candidate_limit=n) for n in (2, 3, 4)]
        assert all(job["status"] == "queued" for job in queued)
        full = client.post(PATH, json=PAYLOAD | {"candidate_limit": 5})
        assert full.status_code == 429 and full.headers["Retry-After"] == "1"
        cancelled = client.post(f"{PATH}/{queued[0]['job_id']}/cancel").json()
        assert cancelled["status"] == "cancelled" and cancelled["started_at"] is None
        assert start(client, candidate_limit=5)["status"] == "queued"
        assert candidates[3].call_count == 1
    finally:
        release.set()


def test_cancel_while_waiting_for_foreground_search_does_not_query(client, candidates):
    with matching._SEARCH_LOCK:
        job = start(client)
        limit = time.monotonic() + 2
        while time.monotonic() < limit:
            current = client.get(f"{PATH}/{job['job_id']}").json()
            if current["stage"] == "waiting_for_search":
                break
            threading.Event().wait(0.005)
        assert current["stage"] == "waiting_for_search"
        client.post(f"{PATH}/{job['job_id']}/cancel")
        assert done(client, job["job_id"])["status"] == "cancelled"
    candidates[3].assert_not_called()


def test_cancel_after_first_file_preserves_check_and_stops_next_download(
    client, monkeypatch
):
    entered, release = threading.Event(), threading.Event()
    original = matching._inspect

    def slow(product, retrieved, request):
        result = original(product, retrieved, request)
        entered.set()
        assert release.wait(5)
        return result

    monkeypatch.setattr(matching, "_inspect", slow)
    job = start(client, advance=True)
    try:
        assert entered.wait(2)
        client.post(f"{PATH}/{job['job_id']}/cancel")
    finally:
        release.set()
    result = done(client, job["job_id"])
    assert result["status"] == "cancelled" and result["processed_count"] == 1
    assert result["new_download_attempts"] == 1
    assert client.app.state.fits_store.fetch.call_count == 1
    resumed = client.post("/api/compare/matches", json=PAYLOAD).json()
    assert resumed["state_cached"] is True and resumed["verified_count"] == 1
    assert resumed["pending_count"] == 4


def test_cancel_waiting_for_download_admission_does_not_start_transfer(client):
    with client.app.state.fits_store.policy.state.writer:
        job = start(client, advance=True)
        limit = time.monotonic() + 2
        while time.monotonic() < limit:
            current = client.get(f"{PATH}/{job['job_id']}").json()
            if current["stage"] == "waiting_for_download":
                break
            threading.Event().wait(0.005)
        assert current["stage"] == "waiting_for_download"
        client.post(f"{PATH}/{job['job_id']}/cancel")
        assert done(client, job["job_id"])["status"] == "cancelled"
    client.app.state.fits_store.fetch.assert_not_called()


@pytest.mark.parametrize(
    "error,code",
    [
        (ArchiveUnavailable(), "archive_unavailable"),
        (InvalidArchiveResponse(), "invalid_metadata"),
        (RuntimeError("private details"), "internal_error"),
    ],
)
def test_archive_errors_have_no_fabricated_results_and_worker_recovers(
    client, candidates, error, code
):
    original = candidates[3].side_effect
    candidates[3].side_effect = error
    result = done(client, start(client)["job_id"])
    assert result["status"] == "failed" and result["error"] == code
    assert result["result"] is None and result["candidate_count"] is None
    assert "private" not in str(result)
    candidates[3].side_effect = original
    recovered = done(client, start(client)["job_id"])
    assert recovered["status"] == "completed"
    assert recovered["result"]["state_cached"] is False
    client.app.state.fits_store.fetch.assert_not_called()


def test_deadline_includes_waiting_for_search_lock(client):
    worker = client.app.state.comparison_jobs
    now = [0.0]
    worker.clock = lambda: now[0]
    with matching._SEARCH_LOCK:
        job = start(client)
        limit = time.monotonic() + 2
        while time.monotonic() < limit:
            current = client.get(f"{PATH}/{job['job_id']}").json()
            if current["stage"] == "waiting_for_search":
                break
            threading.Event().wait(0.005)
        assert current["stage"] == "waiting_for_search"
        now[0] = 121
        assert done(client, job["job_id"])["status"] == "expired"


def test_terminal_history_and_snapshots_are_bounded(client):
    ids = []
    for _ in range(jobs.MAX_HISTORY + 1):
        job = start(client)
        done(client, job["job_id"])
        ids.append(job["job_id"])
    assert client.get(f"{PATH}/{ids[0]}").status_code == 404
    assert len(client.app.state.comparison_jobs.jobs) == jobs.MAX_HISTORY
    snapshot = client.app.state.comparison_jobs.get(ids[-1])
    snapshot.request.ra = 12
    assert client.app.state.comparison_jobs.get(ids[-1]).request.ra == 100
    assert client.post(f"{PATH}/unknown/cancel").status_code == 404


def test_shutdown_waits_for_current_query_and_cancels_queue(client, candidates):
    worker = client.app.state.comparison_jobs
    entered, release = threading.Event(), threading.Event()
    original = candidates[3].side_effect

    def slow(request):
        entered.set()
        assert release.wait(5)
        return original(request)

    candidates[3].side_effect = slow
    first = start(client)
    assert entered.wait(2)
    second = start(client, candidate_limit=2)
    with ThreadPoolExecutor(max_workers=1) as pool:
        closing = pool.submit(worker.close)
        try:
            limit = time.monotonic() + 2
            while not worker.stopping and time.monotonic() < limit:
                threading.Event().wait(0.005)
            assert worker.stopping and not closing.done()
            with pytest.raises(SearchWorkerClosed):
                worker.submit(MatchRequest(**PAYLOAD))
        finally:
            release.set()
        closing.result(timeout=5)
    assert worker.get(first["job_id"]).status == "cancelled"
    assert worker.get(second["job_id"]).status == "cancelled"
    assert not worker.thread.is_alive()
    assert candidates[3].call_count == 1


def test_startup_never_queries_and_invalid_requests_never_queue(monkeypatch):
    query = Mock(side_effect=AssertionError("Unexpected archive query"))
    monkeypatch.setattr(matching, "query_candidates", query)
    with TestClient(create_app()) as client:
        for payload in [
            {},
            PAYLOAD | {"ra": 360},
            PAYLOAD | {"retry_failed": True},
            PAYLOAD | {"candidate_limit": 65},
            PAYLOAD | {"extra": True},
        ]:
            assert client.post(PATH, json=payload).status_code == 422
        assert client.app.state.comparison_jobs.jobs == {}
        query.assert_not_called()
    assert not client.app.state.comparison_jobs.thread.is_alive()
