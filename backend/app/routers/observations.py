"""Metadata-only SPHEREx image discovery."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request

from app.schemas.observation import ObservationsResponse
from app.services.observations import (
    ArchiveUnavailable,
    InvalidArchiveResponse,
    find_observations,
)

router = APIRouter(prefix="/api", tags=["Observations"])


@router.get("/observations", response_model=ObservationsResponse)
def observations(
    request: Request,
    ra: Annotated[float, Query(ge=0, lt=360, allow_inf_nan=False)],
    dec: Annotated[float, Query(ge=-90, le=90, allow_inf_nan=False)],
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
):
    """Find covering Level 2 products; total_count counts only returned records."""
    try:
        return find_observations(ra, dec, limit, request.app.state.cache)
    except ArchiveUnavailable as error:
        raise HTTPException(503, "IRSA is unavailable. Try again later.") from error
    except InvalidArchiveResponse as error:
        raise HTTPException(502, "IRSA returned unusable metadata.") from error
