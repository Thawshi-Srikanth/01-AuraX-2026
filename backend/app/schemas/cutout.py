"""Display pixels and physical measurements remain separate in the API."""

from typing import Literal

from pydantic import BaseModel, ConfigDict


class CutoutResponse(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    width: int
    height: int
    pixels: list[float | None]
    raw_flux: list[float | None]
    variance: list[float | None]
    flags: list[int]
    valid_pixels: list[bool]  # Strict analysis mask; not the display mask.
    display_valid_pixels: list[bool]
    displayable_pixel_count: int
    display_warning_pixel_count: int
    display_unusable_flag_mask: int
    display_policy: str = (
        "Finite IMAGE values except NONFUNC, DICHROIC and MISSING_DATA; "
        "other quality warnings remain visible but excluded from analysis"
    )
    bunit: str = "MJy/sr"
    variance_unit: str = "(MJy/sr)^2"
    min_flux_mjy_sr: float | None
    max_flux_mjy_sr: float | None
    mean_flux_mjy_sr: float | None
    stretch_applied: Literal["zscale", "linear", "log"]
    display_min_mjy_sr: float | None
    display_max_mjy_sr: float | None
    target_ra_deg: float
    target_dec_deg: float
    target_x: float
    target_y: float
    wavelength_um: float
    channel_width_um: float
    wcs: dict = {}
    spatial_wcs_header: str
    pixel_origin: int = 0
    array_order: str = "row-major: index = y * width + x; y follows FITS array order"
    usable_pixel_count: int
    masked_pixel_count: int
    informational_flag_mask: int
    flag_definitions: dict[str, str]
    source_url: str
    cached_fits: bool
    file_size_bytes: int
    processing_version: str | None
    status: Literal["success", "no_usable_pixels"]
    message: str | None = None
