"""Evidence from one cached observation; no source or line identification."""

from typing import Literal

from pydantic import BaseModel, ConfigDict


class RegionMeasurements(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    mean_brightness_mjy_sr: float
    background_mjy_sr: float
    excess_mjy_sr: float
    excess_error_mjy_sr: float
    usable_aperture_flux_mjy: float
    flux_error_mjy: float
    snr: float | None
    solid_angle_sr: float


class RegionAnalysis(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    status: Literal["success", "partial", "insufficient_data"]
    summary: str
    ra_deg: float
    dec_deg: float
    pixel_x: float
    pixel_y: float
    radius_px: float
    background_inner_px: float
    background_outer_px: float
    usable_pixels: int
    masked_pixels: int
    aperture_coverage: float
    background_coverage: float
    background_clipped_pixels: int
    wavelength_rejected_pixels: int
    wavelength_um: float
    bandwidth_um: float
    measurements: RegionMeasurements | None
    source_url: str
    method: str = "Photutils exact aperture; clipped annulus mean; full SIP pixel areas"
    uncertainty: str = (
        "Pixel and background variance only; no covariance or systematics"
    )
    caveats: list[str] = [
        "Usable-aperture flux; no masked-pixel or PSF-wing correction.",
        "Nearby sources, background structure and correlated noise can bias results.",
        "One exposure cannot identify a source, line, spectrum or variability.",
        "WCS-WAVE gives an approximate passband, not a precision spectrum.",
        "Only pixels within half the narrower local passband enter the estimate.",
    ]
