"""Bounded real-data surface-brightness sampling at a fixed ICRS position."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request

from app.schemas.spectrum import SpectrumResponse
from app.services.observations import ArchiveUnavailable, InvalidArchiveResponse
from app.services.spectrum import extract_spectrum

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
