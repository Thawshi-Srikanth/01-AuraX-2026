"""Prepare a scientifically guarded visual comparison of two selected products."""

from fastapi import APIRouter, HTTPException, Request

from app.schemas.compare import CompareRequest, CompareResponse
from app.schemas.comparison_job import ComparisonJobResponse
from app.schemas.comparison_matches import MatchRequest, MatchResponse
from app.schemas.sequence import SequenceRequest, SequenceResponse
from app.services.compare import (
    prepare_comparison,
    validate_observations,
    validate_pair,
)
from app.services.comparison_jobs import SearchQueueFull, SearchWorkerClosed
from app.services.comparison_matches import MatchingBusy, discover_matches
from app.services.comparison_sequence import prepare_sequence
from app.services.fits_download import FitsContentError, FitsDownloadError
from app.services.fits_parser import InvalidFitsError
from app.services.observations import ArchiveUnavailable, InvalidArchiveResponse

router = APIRouter(prefix="/api", tags=["Compare"])


@router.post("/compare", response_model=CompareResponse)
def compare(request: Request, payload: CompareRequest):
    try:
        validate_pair(payload)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    try:
        return prepare_comparison(payload, request.app.state.fits_store)
    except (FitsContentError, InvalidFitsError) as error:
        raise HTTPException(
            502, "Observation data or calibration is unusable."
        ) from error
    except (FitsDownloadError, OSError) as error:
        raise HTTPException(
            503, "Comparison images could not be retrieved. Try again."
        ) from error


@router.post("/compare/matches", response_model=MatchResponse)
def matches(request: Request, payload: MatchRequest):
    try:
        return discover_matches(
            payload, request.app.state.cache, request.app.state.fits_store
        )
    except MatchingBusy as error:
        raise HTTPException(
            409, "Another date search is running. Try again."
        ) from error
    except ArchiveUnavailable as error:
        raise HTTPException(
            503, "IRSA metadata is unavailable. Try again later."
        ) from error
    except InvalidArchiveResponse as error:
        raise HTTPException(502, "IRSA returned unusable metadata.") from error


@router.post("/compare/sequence", response_model=SequenceResponse)
def sequence(request: Request, payload: SequenceRequest):
    try:
        validate_observations(
            payload.access_urls,
            payload.ra,
            payload.dec,
            payload.size_deg,
            allow_mixed_detectors=payload.comparison_kind == "general",
        )
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    try:
        return prepare_sequence(payload, request.app.state.fits_store)
    except (FitsContentError, InvalidFitsError) as error:
        raise HTTPException(502, "Sequence data or calibration is unusable.") from error
    except (FitsDownloadError, OSError) as error:
        raise HTTPException(
            503, "Sequence images could not be retrieved. Try again."
        ) from error


@router.post(
    "/compare/matches/jobs", response_model=ComparisonJobResponse, status_code=202
)
def start_search_job(request: Request, payload: MatchRequest):
    try:
        return request.app.state.comparison_jobs.submit(payload)
    except SearchQueueFull as error:
        raise HTTPException(
            429,
            "Date-search job queue is full. Try later.",
            headers={"Retry-After": "1"},
        ) from error
    except SearchWorkerClosed as error:
        raise HTTPException(503, "Date-search worker is stopping.") from error


@router.get("/compare/matches/jobs/{job_id}", response_model=ComparisonJobResponse)
def search_job_status(request: Request, job_id: str):
    result = request.app.state.comparison_jobs.get(job_id)
    if result is None:
        raise HTTPException(404, "Date-search job not found or no longer retained.")
    return result


@router.post(
    "/compare/matches/jobs/{job_id}/cancel", response_model=ComparisonJobResponse
)
def cancel_search_job(request: Request, job_id: str):
    result = request.app.state.comparison_jobs.cancel(job_id)
    if result is None:
        raise HTTPException(404, "Date-search job not found or no longer retained.")
    return result
