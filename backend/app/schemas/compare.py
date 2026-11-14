"""Visual-only comparison: no difference photometry or inferred motion."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CompareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    access_url_a: str = Field(min_length=1, max_length=2048)
    access_url_b: str = Field(min_length=1, max_length=2048)
    ra: float = Field(ge=0, lt=360)
    dec: float = Field(ge=-90, le=90)
    size_deg: float = Field(default=0.03, gt=0, le=0.25)
    stretch: Literal["zscale", "linear", "log"] = "zscale"


class ComparisonEpoch(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    obs_id: str
    detector: str
    utc_date: str
    mjd_start: float
    access_url: str
    source_request_url: str
    processing_version: str
    cached_fits: bool
    target_wavelength_um: float
    target_bandwidth_um: float


class CompareResponse(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    status: Literal[
        "ready",
        "incompatible_wavelength",
        "no_time_baseline",
        "no_usable_overlap",
        "insufficient_coverage",
    ]
    message: str
    epoch_a: ComparisonEpoch
    epoch_b: ComparisonEpoch
    width: int
    height: int
    registered: bool = True
    blink_ready: bool
    target_wavelength_match: bool
    baseline_days: float
    coverage_pixel_count: int
    matched_pixel_count: int
    matched_fraction: float
    coverage_mask: list[bool]
    valid_mask: list[bool]
    pixels_a: list[float | None]
    pixels_b: list[float | None]
    display_min_mjy_sr: float | None
    display_max_mjy_sr: float | None
    stretch_applied: str
    spatial_wcs_header: str
    registration_method: str = "reproject_interp bilinear; full SIP WCS; image A grid"
    registration_verified_by_sources: bool = False
    wavelength_method: str = (
        "WCS-WAVE visualization lookup; not CWAVE/CBAND calibration"
    )
    wavelength_pair_margin_um: float = 0.002
    wavelength_rule: str = (
        "abs(wave_A-wave_B)+0.002 um <= min(band_A,band_B); target and all four "
        "B bilinear neighbours must pass for each retained A pixel"
    )
    scientific_difference_available: bool = False
    motion_measurement_available: bool = False
    caveats: list[str] = Field(
        default_factory=lambda: [
            "Visual comparison only; WCS-WAVE is approximate, not science calibration.",
            "Astrometric registration does not match PSFs or subtract backgrounds.",
            "No difference image, photometric uncertainty, or motion estimate.",
        ]
    )
