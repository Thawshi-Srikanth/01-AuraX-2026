"""One process-local worker; explicit jobs only, no automatic archive discovery."""

import logging
import threading
import time
from collections import OrderedDict, deque
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import uuid4

from app.schemas.cache_job import CacheJobItem, CacheJobRequest, CacheJobResponse
from app.services.cache_policy import CachePolicyError
from app.services.fits_download import FitsContentError, FitsDownloadError, cutout_url
from app.services.fits_parser import InvalidFitsError

MAX_ACTIVE_JOBS = 4
MAX_HISTORY = 16
JOB_BUDGET_SECONDS = 120
logger = logging.getLogger(__name__)


class CacheQueueFull(RuntimeError):
    pass


class CacheWorkerClosed(RuntimeError):
    pass


class JobStopped(Exception):
    def __init__(self, status):
        self.status = status


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass
class Job:
    response: CacheJobResponse
    identity: tuple


class CacheJobs:
    def __init__(self, store, *, clock=time.monotonic):
        self.store, self.clock = store, clock
        self.condition = threading.Condition()
        self.jobs = OrderedDict()
        self.queue = deque()
        self.stopping = False
        self.thread = threading.Thread(
            target=self._work, name="aurax-cache", daemon=True
        )
        self.thread.start()

    def _snapshot(self, job):
        return job.response.model_copy(deep=True)

    def _prune(self):
        terminal = [
            key
            for key, job in self.jobs.items()
            if job.response.finished_at is not None
        ]
        for key in terminal[:-MAX_HISTORY]:
            self.jobs.pop(key)

    def submit(self, request: CacheJobRequest):
        # Validate every product before admitting any part of the job.
        for url in request.access_urls:
            cutout_url(url, request.ra, request.dec, request.size_deg)
        if len(set(request.access_urls)) != len(request.access_urls):
            raise ValueError("Choose distinct product URLs.")
        identity = (
            tuple(request.access_urls),
            request.ra,
            request.dec,
            request.size_deg,
        )
        with self.condition:
            if self.stopping:
                raise CacheWorkerClosed()
            active = [
                job for job in self.jobs.values() if job.response.finished_at is None
            ]
            for job in active:
                if job.identity == identity:
                    return self._snapshot(job)
            if len(active) >= MAX_ACTIVE_JOBS:
                raise CacheQueueFull()
            response = CacheJobResponse(
                job_id=str(uuid4()),
                ra=request.ra,
                dec=request.dec,
                size_deg=request.size_deg,
                created_at=utc_now(),
                items=[CacheJobItem(access_url=url) for url in request.access_urls],
            )
            job = Job(response, identity)
            self.jobs[response.job_id] = job
            self.queue.append(response.job_id)
            self._prune()
            self.condition.notify_all()
            return self._snapshot(job)

    def get(self, job_id):
        with self.condition:
            job = self.jobs.get(job_id)
            return self._snapshot(job) if job else None

    def _finish(self, job, status):
        job.response.status = status
        job.response.finished_at = utc_now()
        for item in job.response.items:
            if item.status in {"pending", "running"}:
                item.status = "cancelled" if status == "cancelled" else "skipped"
        self._prune()

    def cancel(self, job_id):
        with self.condition:
            job = self.jobs.get(job_id)
            if job is None:
                return None
            if job.response.finished_at is None:
                job.response.cancellation_requested = True
                if job.response.status == "queued":
                    self.queue.remove(job_id)
                    self._finish(job, "cancelled")
                self.condition.notify_all()
            return self._snapshot(job)

    def close(self):
        with self.condition:
            self.stopping = True
            for key in list(self.queue):
                job = self.jobs[key]
                job.response.cancellation_requested = True
                self._finish(job, "cancelled")
            self.queue.clear()
            for job in self.jobs.values():
                if job.response.status == "running":
                    job.response.cancellation_requested = True
            self.condition.notify_all()
        # A current transfer finishes/times out; no next product is started.
        self.thread.join()

    def _check(self, job, deadline):
        with self.condition:
            if self.stopping or job.response.cancellation_requested:
                raise JobStopped("cancelled")
        if self.clock() >= deadline:
            raise JobStopped("expired")

    @contextmanager
    def _download_slot(self, job, deadline):
        # Poll the same admission lock used by foreground downloads, so a queued
        # background transfer can be cancelled before it contacts the archive.
        writer = self.store.policy.state.writer
        while True:
            self._check(job, deadline)
            if writer.acquire(timeout=0.1):
                break
        try:
            self._check(job, deadline)
            yield
        finally:
            writer.release()

    def _run(self, job):
        deadline = self.clock() + JOB_BUDGET_SECONDS
        for item in job.response.items:
            self._check(job, deadline)
            with self.condition:
                item.status = "running"
            try:
                with self.store.lease(
                    item.access_url,
                    job.response.ra,
                    job.response.dec,
                    job.response.size_deg,
                ):
                    result = self.store.get_cached(
                        item.access_url,
                        job.response.ra,
                        job.response.dec,
                        job.response.size_deg,
                    )
                    if result is None:
                        with self._download_slot(job, deadline):
                            result = self.store.fetch(
                                item.access_url,
                                job.response.ra,
                                job.response.dec,
                                job.response.size_deg,
                            )
                    with self.condition:
                        item.status = "ready"
                        item.cached = result.cached
                        item.size_bytes = result.size_bytes
            except JobStopped:
                raise
            except (FitsContentError, InvalidFitsError, ValueError):
                self._fail(item, "invalid_data")
            except (CachePolicyError, OSError):
                self._fail(item, "cache_unavailable")
            except FitsDownloadError:
                self._fail(item, "download_failed")
            except Exception:
                logger.exception("Background cache item failed")
                self._fail(item, "internal_error")
        with self.condition:
            if self.stopping or job.response.cancellation_requested:
                status = "cancelled"
            else:
                ready = sum(item.status == "ready" for item in job.response.items)
                status = (
                    "completed"
                    if ready == len(job.response.items)
                    else "partial"
                    if ready
                    else "failed"
                )
            self._finish(job, status)

    def _fail(self, item, reason):
        with self.condition:
            item.status, item.error = "failed", reason

    def _work(self):
        while True:
            with self.condition:
                self.condition.wait_for(lambda: self.stopping or self.queue)
                if self.stopping:
                    return
                job = self.jobs[self.queue.popleft()]
                job.response.status = "running"
                job.response.started_at = utc_now()
            try:
                self._run(job)
            except JobStopped as stopped:
                with self.condition:
                    self._finish(job, stopped.status)
            except Exception:
                logger.exception("Background cache job failed")
                with self.condition:
                    for item in job.response.items:
                        if item.status in {"pending", "running"}:
                            item.status, item.error = "failed", "internal_error"
                    self._finish(job, "failed")
