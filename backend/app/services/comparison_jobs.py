"""A single bounded worker for explicitly submitted date-search passes."""

import logging
import threading
import time
from collections import OrderedDict, deque
from uuid import uuid4

from app.schemas.comparison_job import ComparisonJobResponse
from app.services.cache_jobs import utc_now
from app.services.comparison_matches import discover_matches
from app.services.observations import ArchiveUnavailable, InvalidArchiveResponse
from app.services.search_control import SearchStopped

MAX_ACTIVE_JOBS = 4
MAX_HISTORY = 16
JOB_BUDGET_SECONDS = 120
logger = logging.getLogger(__name__)


class SearchQueueFull(RuntimeError):
    pass


class SearchWorkerClosed(RuntimeError):
    pass


class ComparisonJobs:
    def __init__(self, cache, store, *, clock=time.monotonic):
        self.cache, self.store, self.clock = cache, store, clock
        self.condition = threading.Condition()
        self.jobs = OrderedDict()
        self.queue = deque()
        self.stopping = False
        self.thread = threading.Thread(
            target=self._work, name="aurax-date-search", daemon=True
        )
        self.thread.start()

    def _prune(self):
        terminal = [
            key for key, job in self.jobs.items() if job.finished_at is not None
        ]
        for key in terminal[:-MAX_HISTORY]:
            self.jobs.pop(key)

    def submit(self, request):
        request = request.model_copy(deep=True)
        with self.condition:
            if self.stopping:
                raise SearchWorkerClosed()
            active = [job for job in self.jobs.values() if job.finished_at is None]
            for job in active:
                if job.request == request:
                    return job.model_copy(deep=True)
            if len(active) >= MAX_ACTIVE_JOBS:
                raise SearchQueueFull()
            job = ComparisonJobResponse(
                job_id=str(uuid4()), request=request, created_at=utc_now()
            )
            self.jobs[job.job_id] = job
            self.queue.append(job.job_id)
            self._prune()
            self.condition.notify_all()
            return job.model_copy(deep=True)

    def get(self, job_id):
        with self.condition:
            job = self.jobs.get(job_id)
            return job.model_copy(deep=True) if job else None

    def _finish(self, job, status, error=None, result=None):
        job.status, job.error, job.result = status, error, result
        job.stage, job.finished_at = "finished", utc_now()
        self._prune()

    def cancel(self, job_id):
        with self.condition:
            job = self.jobs.get(job_id)
            if job is None:
                return None
            if job.finished_at is None:
                job.cancellation_requested = True
                if job.status == "queued":
                    self.queue.remove(job_id)
                    self._finish(job, "cancelled")
                self.condition.notify_all()
            return job.model_copy(deep=True)

    def close(self):
        with self.condition:
            self.stopping = True
            for key in list(self.queue):
                job = self.jobs[key]
                job.cancellation_requested = True
                self._finish(job, "cancelled")
            self.queue.clear()
            for job in self.jobs.values():
                if job.status == "running":
                    job.cancellation_requested = True
            self.condition.notify_all()
        self.thread.join()

    def _update(self, job, deadline, stage, **counts):
        with self.condition:
            job.stage = stage
            for name, value in counts.items():
                setattr(job, name, value)
            if self.stopping or job.cancellation_requested:
                raise SearchStopped("cancelled")
            if self.clock() >= deadline:
                raise SearchStopped("expired")

    def _work(self):
        while True:
            with self.condition:
                self.condition.wait_for(lambda: self.stopping or self.queue)
                if self.stopping:
                    return
                job = self.jobs[self.queue.popleft()]
                job.status, job.started_at = "running", utc_now()
            deadline = self.clock() + JOB_BUDGET_SECONDS

            def control(stage, **counts):
                self._update(job, deadline, stage, **counts)

            result, error, status = None, None, "completed"
            try:
                control("waiting_for_search")
                result = discover_matches(
                    job.request, self.cache, self.store, control=control
                )
                control("saving")
            except SearchStopped as stopped:
                status, result = stopped.status, None
            except ArchiveUnavailable:
                status, error = "failed", "archive_unavailable"
            except InvalidArchiveResponse:
                status, error = "failed", "invalid_metadata"
            except Exception:
                logger.exception("Background date search failed")
                status, error = "failed", "internal_error"
            with self.condition:
                # Cancellation requested during an in-flight operation wins over
                # that operation's later error, without publishing an empty result.
                if self.stopping or job.cancellation_requested:
                    status, error, result = "cancelled", None, None
                self._finish(job, status, error, result)
