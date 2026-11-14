"""Bounded real-data surface-brightness sampling at a fixed ICRS position."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from app.schemas.spectrum import CachedSpectrumResponse, SpectrumResponse
from app.services.fits_download import cutout_url
from app.services.fits_parser import InvalidFitsError
from app.services.observations import ArchiveUnavailable, InvalidArchiveResponse
from app.services.spectrum import extract_spectrum, sample_cached_image

router = APIRouter(prefix="/api", tags=["Spectrum"])


@router.get("/spectrum", response_model=SpectrumResponse)
def spectrum(
    request: Request,
    ra: Annotated[float, Query(ge=0, lt=360, allow_inf_nan=False)],
    dec: Annotated[float, Query(ge=-90, le=90, allow_inf_nan=False)],
    limit: Annotated[int, Query(ge=1, le=6)] = 2,
):
    """Sample up to six observations; do not infer a complete source spectrum."""
    try:
        return extract_spectrum(
            ra, dec, limit, request.app.state.cache, request.app.state.fits_store
        )
    except ArchiveUnavailable as error:
        raise HTTPException(503, "IRSA is unavailable. Try again later.") from error
    except InvalidArchiveResponse as error:
        raise HTTPException(502, "IRSA returned unusable metadata.") from error


class CachedSampleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    access_url: str = Field(min_length=1, max_length=2048)
    center_ra: float = Field(ge=0, lt=360)
    center_dec: float = Field(ge=-90, le=90)
    size_deg: float = Field(gt=0, le=0.5)
    ra: float = Field(ge=0, lt=360)
    dec: float = Field(ge=-90, le=90)


@router.post("/spectrum/cached", response_model=CachedSpectrumResponse)
def cached_sample(body: CachedSampleRequest, request: Request):
    """Read a selected pixel from an already-cached display MEF, with full SIP WCS."""
    try:
        cutout_url(body.access_url, body.center_ra, body.center_dec, body.size_deg)
    except ValueError as error:
        raise HTTPException(400, "Use a direct IRSA Level 2 product URL.") from error
    try:
        result = sample_cached_image(request.app.state.fits_store, **body.model_dump())
    except (InvalidFitsError, OSError) as error:
        raise HTTPException(
            422, "This position has no usable cached calibration."
        ) from error
    if result is None:
        raise HTTPException(409, "The displayed image is no longer cached. Reload it.")
    return result
