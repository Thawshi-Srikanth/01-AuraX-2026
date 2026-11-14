"""Prepare a scientifically guarded visual comparison of two selected products."""

from fastapi import APIRouter, HTTPException, Request

from app.schemas.compare import CompareRequest, CompareResponse
from app.schemas.comparison_matches import MatchRequest, MatchResponse
from app.services.compare import prepare_comparison, validate_pair
from app.services.comparison_matches import MatchingBusy, discover_matches
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
