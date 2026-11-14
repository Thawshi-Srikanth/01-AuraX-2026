"""Catalog target metadata and explicitly user-supplied positions."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class TargetCoordinates(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    ra_deg: float = Field(ge=0, lt=360)
    dec_deg: float = Field(ge=-90, le=90)
    ra_hms: str
    dec_dms: str
    frame: str = "ICRS"
    epoch: str | None = Field(
        default=None, description="Not inferred from the coordinate reference frame"
    )


class ProperMotion(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    pm_ra_mas_yr: float | None = Field(
        default=None, description="Catalog mu_alpha*cos(delta), in mas/year"
    )
    pm_dec_mas_yr: float | None = None
    reference: str | None = None


class ResolvedTarget(BaseModel):
    query: str
    canonical_name: str = Field(min_length=1)
    object_type: str
    coordinates: TargetCoordinates
    proper_motion: ProperMotion | None = None
    aliases: list[str] = Field(default_factory=list)
    provenance: str
    source_url: str | None = None
    coordinate_reference: str | None = None
    retrieved_at: datetime | None = None
    cached: bool = False
