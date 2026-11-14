"""Cached-region inspection never initiates a FITS download."""

from fastapi import APIRouter, HTTPException, Request
from pydantic import Field

from app.routers.spectrum import CachedSampleRequest
from app.schemas.region import RegionAnalysis
from app.services.fits_download import cutout_url
from app.services.fits_parser import InvalidFitsError
from app.services.region import analyze_region

router = APIRouter(prefix="/api", tags=["Region analysis"])


class RegionRequest(CachedSampleRequest):
    radius_px: float = Field(default=3, ge=2, le=6)


@router.post("/region", response_model=RegionAnalysis)
def region(body: RegionRequest, request: Request):
    try:
        cutout_url(body.access_url, body.center_ra, body.center_dec, body.size_deg)
    except ValueError as error:
        raise HTTPException(400, "Use a direct IRSA Level 2 product URL.") from error
    try:
        result = analyze_region(request.app.state.fits_store, **body.model_dump())
    except (InvalidFitsError, ValueError, OSError) as error:
        raise HTTPException(
            422, "This region has no usable cached calibration."
        ) from error
    if result is None:
        raise HTTPException(
            409, "The image is no longer cached. Reload it to inspect this region."
        )
    return result
