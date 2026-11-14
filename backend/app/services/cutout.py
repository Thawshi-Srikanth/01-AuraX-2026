"""Build a bounded display response without altering physical measurements."""

from typing import Literal

import astropy.units as u
import numpy as np
from astropy.coordinates import SkyCoord
from astropy.visualization import LogStretch, ZScaleInterval

from app.schemas.cutout import CutoutResponse
from app.services.fits_download import FitsStore
from app.services.fits_parser import open_observation
from app.services.quality import (
    DISPLAY_UNUSABLE_FLAGS,
    INFORMATIONAL_FLAGS,
    displayable_pixels,
    usable_pixels,
)

MAX_RESPONSE_AXIS = 512


class CutoutTooLarge(ValueError):
    """Response arrays would exceed the public API's size bound."""


def _json_values(array):
    return [float(value) if np.isfinite(value) else None for value in array.ravel()]


def image_cutout(
    store: FitsStore,
    access_url: str,
    ra: float,
    dec: float,
    size_deg: float,
    stretch: Literal["zscale", "linear", "log"],
) -> CutoutResponse:
    if stretch not in {"zscale", "linear", "log"}:
        raise ValueError("Unknown display stretch")
    with store.lease(access_url, ra, dec, size_deg):
        retrieved = store.fetch(access_url, ra, dec, size_deg)
        with open_observation(retrieved.path) as observation:
            height, width = observation.image.shape
            if width > MAX_RESPONSE_AXIS or height > MAX_RESPONSE_AXIS:
                raise CutoutTooLarge("Use a smaller angular cutout width")
            target_x, target_y = observation.target_pixel(ra, dec)
            wave, band = observation.wavelength_at(target_x, target_y)
            image = (observation.image * observation.image_unit).to_value(u.MJy / u.sr)
            variance = (observation.variance * observation.variance_unit).to_value(
                (u.MJy / u.sr) ** 2
            )
            valid = usable_pixels(image, variance, observation.flags)
            usable = image[valid].astype(np.float64)
            visible = displayable_pixels(image, observation.flags)
            visual_values = image[visible].astype(np.float64)
            display = np.full(image.shape, np.nan, dtype=np.float64)
            low = high = minimum = maximum = mean = None
            if usable.size:
                minimum, maximum, mean = (
                    float(np.min(usable)),
                    float(np.max(usable)),
                    float(np.mean(usable)),
                )
            if visual_values.size:
                if stretch == "zscale":
                    low, high = (
                        float(value)
                        for value in ZScaleInterval().get_limits(visual_values)
                    )
                else:
                    low, high = (
                        float(np.min(visual_values)),
                        float(np.max(visual_values)),
                    )
                if high > low:
                    values = np.clip((visual_values - low) / (high - low), 0.0, 1.0)
                    if stretch == "log":
                        values = LogStretch(a=1000)(values)
                    display[visible] = values
                else:
                    display[visible] = 0.5
            yy, xx = np.indices(image.shape)
            sky_ra, sky_dec = observation.spatial_wcs.pixel_to_world_values(xx, yy)
            north = SkyCoord(ra * u.deg, dec * u.deg).directional_offset_by(
                0 * u.deg, 1 * u.arcsec
            )
            nx, ny = observation.spatial_wcs.world_to_pixel(north)
            north_angle = float(np.degrees(np.arctan2(nx - target_x, -(ny - target_y))))
            flag_header = observation.hdus["FLAGS"].header
            definitions = {
                key: str(value)
                for key, value in flag_header.items()
                if key.startswith(("MSKN", "MSKD"))
            }
            return CutoutResponse(
                width=width,
                height=height,
                pixels=_json_values(display),
                raw_flux=_json_values(image),
                variance=_json_values(variance),
                flags=[int(value) for value in observation.flags.ravel()],
                valid_pixels=valid.ravel().tolist(),
                display_valid_pixels=visible.ravel().tolist(),
                displayable_pixel_count=int(visible.sum()),
                display_warning_pixel_count=int((visible & ~valid).sum()),
                display_unusable_flag_mask=DISPLAY_UNUSABLE_FLAGS,
                min_flux_mjy_sr=minimum,
                max_flux_mjy_sr=maximum,
                mean_flux_mjy_sr=mean,
                stretch_applied=stretch,
                display_min_mjy_sr=low,
                display_max_mjy_sr=high,
                target_ra_deg=ra,
                target_dec_deg=dec,
                target_x=target_x,
                target_y=target_y,
                wavelength_um=wave,
                channel_width_um=band,
                wcs={
                    "ra_grid": _json_values(sky_ra),
                    "dec_grid": _json_values(sky_dec),
                    "has_valid_wcs": bool(np.isfinite(north_angle)),
                    "north_angle_deg": north_angle
                    if np.isfinite(north_angle)
                    else None,
                },
                spatial_wcs_header=observation.spatial_wcs.to_header(
                    relax=True
                ).tostring(sep="\n", endcard=True, padding=False),
                usable_pixel_count=int(valid.sum()),
                masked_pixel_count=int((~valid).sum()),
                informational_flag_mask=INFORMATIONAL_FLAGS,
                flag_definitions=definitions,
                source_url=retrieved.request_url,
                cached_fits=retrieved.cached,
                file_size_bytes=retrieved.size_bytes,
                processing_version=observation.hdus[0].header.get("VERSION"),
                status="success" if visual_values.size else "no_usable_pixels",
                message=None
                if visual_values.size
                else "No displayable image data remains.",
            )
