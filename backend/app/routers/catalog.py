"""Real catalog references around a fixed sky position."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request

from app.schemas.catalog import CatalogSourcesResponse
from app.services.catalog import (
    CatalogUnavailable,
    InvalidCatalogData,
    find_catalog_sources,
)

router = APIRouter(prefix="/api/catalog", tags=["Catalog"])


@router.get("/sources", response_model=CatalogSourcesResponse)
def catalog_sources(
    request: Request,
    ra: Annotated[float, Query(ge=0, lt=360, allow_inf_nan=False)],
    dec: Annotated[float, Query(ge=-90, le=90, allow_inf_nan=False)],
    radius_arcmin: Annotated[float, Query(gt=0, le=30, allow_inf_nan=False)] = 3,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    """Find SIMBAD reference positions; no image detections or matches are inferred."""
    try:
        return find_catalog_sources(
            ra, dec, radius_arcmin, limit, request.app.state.cache
        )
    except CatalogUnavailable as error:
        raise HTTPException(503, "SIMBAD is unavailable. Try again later.") from error
    except InvalidCatalogData as error:
        raise HTTPException(
            502, "SIMBAD returned unusable catalog metadata."
        ) from error
