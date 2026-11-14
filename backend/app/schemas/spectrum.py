"""Measured surface-brightness samples; no inferred or filled spectral channels."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PixelMeasurement(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    pixel_x: int
    pixel_y: int
    target_x: float
    target_y: float
    sample_offset_arcsec: float = Field(ge=0)
    wavelength_um: float = Field(gt=0)
    bandwidth_um: float = Field(gt=0)
    resolving_power: float = Field(gt=0)
    flux_mjy_sr: float = Field(
        description="Measured pixel surface brightness, not integrated flux"
    )
    flux_error_mjy_sr: float = Field(
        ge=0, description="sqrt(VARIANCE), excluding systematic errors"
    )
    snr: float | None = None
    flags: int


class SpectralPoint(PixelMeasurement):
    artifact_id: str
    obs_id: str
    detector: str
    utc_date: str
    mjd_start: float
    processing_version: str
    source_url: str
    cached_fits: bool


class CachedSpectrumResponse(BaseModel):
    sample: PixelMeasurement | None
    source_url: str
    status: Literal["success", "no_usable_data"]


class ExcludedObservation(BaseModel):
    artifact_id: str
    obs_id: str
    detector: str
    utc_date: str
    access_url: str
    reason: Literal["download_failed", "invalid_calibration", "unusable_pixel"]
    pixel_x: int | None = None
    pixel_y: int | None = None
    flags: int | None = None


class SpectrumResponse(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    ra_deg: float
    dec_deg: float
    method: str = "nearest-pixel surface brightness; no aperture or PSF photometry"
    coverage: str = "observed samples only; no interpolation or channel completion"
    flux_unit: str = "MJy/sr"
    uncertainty: str = (
        "sqrt of pixel variance only; systematic calibration errors not included"
    )
    background_subtracted: bool = False
    proper_motion_applied: bool = False
    requested_observations: int
    attempted_observations: int
    total_samples: int
    metadata_truncated: bool
    rejected_metadata_count: int
    cached_metadata: bool
    archive_retrieved_at: datetime
    spectral_points: list[SpectralPoint]
    excluded_observations: list[ExcludedObservation]
    status: Literal["success", "partial", "no_coverage", "no_usable_data"]
    message: str
    provenance: str = "NASA/IPAC IRSA SPHEREx Level 2 IMAGE, VARIANCE, FLAGS, WCS-WAVE"
    caveats: list[str] = Field(
        default_factory=lambda: [
            "Pixel brightness includes backgrounds and nearby sources.",
            "Samples span observation dates; they are not necessarily simultaneous.",
            "Reprocessed exposures are separate, correlated samples.",
            "Proper motion is not applied to the fixed ICRS position.",
        ]
    )
