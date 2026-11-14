"""Two to four actual observations; no interpolated epochs or padded frames."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.compare import ComparisonEpoch

ProductURL = Annotated[str, Field(min_length=1, max_length=2048)]


class SequenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    access_urls: list[ProductURL] = Field(min_length=2, max_length=4)
    ra: float = Field(ge=0, lt=360)
    dec: float = Field(ge=-90, le=90)
    size_deg: float = Field(default=0.03, gt=0, le=0.25)
    stretch: Literal["zscale", "linear", "log"] = "zscale"


class SequencePairCheck(BaseModel):
    epoch_index_a: int
    epoch_index_b: int
    target_wavelength_match: bool
    matched_pixel_count: int


class SequenceFrame(BaseModel):
    epoch_index: int
    pixels: list[float | None]


class SequenceResponse(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    status: Literal[
        "ready",
        "duplicate_time",
        "incompatible_wavelength",
        "no_usable_overlap",
        "insufficient_coverage",
    ]
    message: str
    epochs: list[ComparisonEpoch]
    frames: list[SequenceFrame]
    reference_epoch_index: int = 0
    frame_order: str = (
        "Request order; first selected observation defines the reference grid"
    )
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
    pair_checks: list[SequencePairCheck]
    display_min_mjy_sr: float | None
    display_max_mjy_sr: float | None
    stretch_applied: str
    spatial_wcs_header: str
    registration_method: str = (
        "reproject_interp bilinear; full SIP WCS; first observation grid"
    )
    registration_verified_by_sources: bool = False
    wavelength_method: str = "Approximate WCS-WAVE; not CWAVE/CBAND science calibration"
    wavelength_pair_margin_um: float = 0.002
    wavelength_rule: str = (
        "Every epoch pair and every cross-combination of interpolation contributors "
        "must satisfy abs(wave_i-wave_j)+0.002 um <= min(band_i,band_j)."
    )
    scientific_difference_available: bool = False
    motion_measurement_available: bool = False
    caveats: list[str] = Field(
        default_factory=lambda: [
            "Visual sequence only; no PSF matching or background subtraction.",
            "No difference images, propagated uncertainties, or motion estimates.",
        ]
    )
