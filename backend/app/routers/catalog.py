"""Real catalog references around a fixed sky position."""

from typing import Annotated

import numpy as np
from astropy.io.fits import Header
from astropy.wcs import WCS
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

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


class SkyPosition(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    ra: float = Field(ge=0, lt=360)
    dec: float = Field(ge=-90, le=90)


class ProjectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    spatial_wcs_header: str = Field(min_length=1, max_length=32768)
    positions: list[SkyPosition] = Field(max_length=200)


@router.post("/project")
def project_positions(body: ProjectionRequest):
    """Project reference positions only; this does not verify an image detection."""
    try:
        wcs = WCS(Header.fromstring(body.spatial_wcs_header, sep="\n"))
        if not wcs.has_celestial or wcs.pixel_n_dim != 2 or wcs.world_n_dim != 2:
            raise ValueError("A two-dimensional celestial WCS is required")
        if not body.positions:
            return {"pixels": [], "image_match_verified": False}
        points = [[p.ra, p.dec] for p in body.positions]
        pixels = wcs.all_world2pix(points, 0, ra_dec_order=True)
        return {
            "pixels": [
                [float(x), float(y)] if np.isfinite([x, y]).all() else None
                for x, y in pixels
            ],
            "image_match_verified": False,
        }
    except Exception as error:
        raise HTTPException(
            422, "The supplied WCS cannot project these reference positions."
        ) from error
