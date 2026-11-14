"""Archive metadata, without implying calibrated wavelength at the target."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SPHERExObservation(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    artifact_id: str = Field(min_length=1, description="Archive product identity")
    obs_id: str = Field(min_length=1)
    detector: Literal["D1", "D2", "D3", "D4", "D5", "D6"]
    band_name: str
    release: str
    processing_version: str
    mjd_start: float
    utc_date: str
    date_only: str
    wavelength_min_um: float = Field(gt=0, description="Detector metadata lower bound")
    wavelength_max_um: float = Field(gt=0, description="Detector metadata upper bound")
    wavelength_center_um: None = Field(
        default=None, description="Requires wavelength calibration at the target pixel"
    )
    exptime_sec: float | None = Field(default=None, ge=0)
    access_url: str


class ObservationsResponse(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    ra_deg: float = Field(ge=0, lt=360)
    dec_deg: float = Field(ge=-90, le=90)
    limit: int = Field(ge=1, le=500)
    total_count: int = Field(
        ge=0, description="Returned rows; not an archive-wide total"
    )
    truncated: bool = False
    rejected_count: int = Field(default=0, ge=0)
    distinct_dates: list[str] = Field(default_factory=list)
    detectors_available: list[str] = Field(default_factory=list)
    observations: list[SPHERExObservation] = Field(default_factory=list)
    status: Literal["success", "no_coverage", "partial"]
    message: str
    provenance: str = "NASA/IPAC IRSA TAP: spherex.plane and spherex.artifact"
    source_url: str = "https://irsa.ipac.caltech.edu/TAP"
    retrieved_at: datetime
    cached: bool = False
