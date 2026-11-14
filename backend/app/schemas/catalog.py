"""Catalog positions are references, not verified detections in an image."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.target import ProperMotion


class CatalogSource(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    object_type: str
    ra_deg: float = Field(ge=0, lt=360)
    dec_deg: float = Field(ge=-90, le=90)
    distance_arcsec: float = Field(ge=0)
    coordinate_reference: str | None = None
    proper_motion: ProperMotion | None = None


class CatalogSourcesResponse(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    target_ra: float = Field(ge=0, lt=360)
    target_dec: float = Field(ge=-90, le=90)
    radius_arcmin: float = Field(gt=0, le=30)
    limit: int = Field(ge=1, le=200)
    sources_count: int = Field(
        ge=0, description="Returned records, not a catalog total"
    )
    sources: list[CatalogSource]
    truncated: bool
    rejected_count: int = Field(ge=0)
    status: Literal["success", "no_sources", "partial"]
    message: str
    provenance: str = "CDS / SIMBAD via TAP"
    source_url: str
    retrieved_at: datetime
    cached: bool = False
    frame: str = "ICRS"
    coordinate_epoch: str | None = None
    proper_motion_applied: bool = False
    image_match_verified: bool = False
    caveat: str = (
        "Catalog reference positions; not image detections or propagated positions."
    )
