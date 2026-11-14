"""Runtime cache status and bounded explicit retrieval jobs; no cleanup endpoint."""

from fastapi import APIRouter, HTTPException, Request

from app.schemas.cache_job import CacheJobRequest, CacheJobResponse
from app.services.cache_jobs import CacheQueueFull, CacheWorkerClosed

router = APIRouter(prefix="/api/cache", tags=["Cache"])


@router.get("/status")
def cache_status(request: Request):
    try:
        return request.app.state.fits_store.status()
    except OSError as error:
        raise HTTPException(503, "Cache status is unavailable.") from error


@router.post("/jobs", response_model=CacheJobResponse, status_code=202)
def start_job(request: Request, payload: CacheJobRequest):
    """Queue up to four explicit IRSA products; no catalog/archive discovery."""
    try:
        return request.app.state.cache_jobs.submit(payload)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    except CacheQueueFull as error:
        raise HTTPException(
            429, "Cache job queue is full. Try later.", headers={"Retry-After": "1"}
        ) from error
    except CacheWorkerClosed as error:
        raise HTTPException(503, "Cache worker is stopping.") from error


@router.get("/jobs/{job_id}", response_model=CacheJobResponse)
def job_status(request: Request, job_id: str):
    result = request.app.state.cache_jobs.get(job_id)
    if result is None:
        raise HTTPException(404, "Cache job not found or no longer retained.")
    return result


@router.post("/jobs/{job_id}/cancel", response_model=CacheJobResponse)
def cancel_job(request: Request, job_id: str):
    result = request.app.state.cache_jobs.cancel(job_id)
    if result is None:
        raise HTTPException(404, "Cache job not found or no longer retained.")
    return result
