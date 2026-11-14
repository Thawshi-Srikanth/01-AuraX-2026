"""Local, bounded aperture measurements from the exact cached display MEF."""

import math

import astropy.units as u
import numpy as np
from astropy.stats import sigma_clip
from photutils.aperture import CircularAnnulus, CircularAperture

from app.schemas.region import RegionAnalysis, RegionMeasurements
from app.services.fits_parser import open_observation
from app.services.quality import usable_pixels


def pixel_solid_angles(wcs, xx, yy):
    """Spherical quadrilateral area from full-SIP pixel-corner directions."""
    vectors = []
    for dx, dy in [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)]:
        sky = wcs.pixel_to_world(xx + dx, yy + dy)
        vectors.append(np.moveaxis(sky.cartesian.xyz.value, 0, -1))

    def triangle(a, b, c):
        numerator = np.abs(np.sum(a * np.cross(b, c), axis=-1))
        denominator = (
            1 + np.sum(a * b, axis=-1) + np.sum(b * c, axis=-1) + np.sum(c * a, axis=-1)
        )
        return 2 * np.arctan2(numerator, denominator)

    return triangle(vectors[0], vectors[1], vectors[2]) + triangle(
        vectors[0], vectors[2], vectors[3]
    )


def analyze_region(
    store, access_url, center_ra, center_dec, size_deg, ra, dec, radius_px=3
):
    with store.lease(access_url, center_ra, center_dec, size_deg):
        retrieved = store.get_cached(access_url, center_ra, center_dec, size_deg)
        if retrieved is None:
            return None
        with open_observation(retrieved.path) as data:
            x, y = data.target_pixel(ra, dec)
            inner, outer = radius_px + 2, radius_px + 5
            # Only the local patch is converted and measured, regardless of image size.
            height, width = data.image.shape
            left, right = (
                max(0, math.floor(x - outer - 1)),
                min(width, math.ceil(x + outer + 2)),
            )
            bottom, top = (
                max(0, math.floor(y - outer - 1)),
                min(height, math.ceil(y + outer + 2)),
            )
            image = (data.image[bottom:top, left:right] * data.image_unit).to_value(
                u.MJy / u.sr
            )
            variance = (
                data.variance[bottom:top, left:right] * data.variance_unit
            ).to_value((u.MJy / u.sr) ** 2)
            flags = data.flags[bottom:top, left:right]
            quality = usable_pixels(image, variance, flags)
            wave, band = data.wavelength_at(x, y)
            yy, xx = np.indices(image.shape)
            local_wave, local_band = data.wavelength_wcs.pixel_to_world(
                xx + left, yy + bottom
            )
            local_wave, local_band = (
                local_wave.to_value(u.um),
                local_band.to_value(u.um),
            )
            spectral = (
                np.isfinite(local_wave)
                & np.isfinite(local_band)
                & (local_band > 0)
                & (np.abs(local_wave - wave) <= np.minimum(local_band, band) / 2)
            )
            valid = quality & spectral
            position = (x - left, y - bottom)
            aperture = CircularAperture(position, radius_px)
            annulus = CircularAnnulus(position, inner, outer)
            wa = aperture.to_mask(method="exact").to_image(image.shape)
            wb = annulus.to_mask(method="exact").to_image(image.shape)
            if wa is None or wb is None:
                raise ValueError("Region does not overlap this image")
            wavelength_rejected = int(
                np.count_nonzero(quality & ~spectral & ((wa > 0) | (wb > 0)))
            )
            inside = wa > 0
            usable = int(np.count_nonzero(inside & valid))
            masked = int(np.count_nonzero(inside & ~valid))
            background = (wb > 0) & valid
            rejected = np.zeros_like(valid)
            if background.any():
                clipped = sigma_clip(image[background], sigma=3, maxiters=3)
                rejected[background] = np.ma.getmaskarray(clipped)
            clipped_count = int(rejected.sum())
            wa = np.where(valid, wa, 0)
            wb = np.where(valid & ~rejected, wb, 0)
            asum, bsum = float(wa.sum()), float(wb.sum())
            coverage, bg_coverage = asum / aperture.area, bsum / annulus.area
            measurements = None
            status, summary = (
                "insufficient_data",
                "Insufficient usable region or background coverage.",
            )
            if coverage >= 0.8 and bg_coverage >= 0.8 and usable >= 5:
                values, errors = np.where(valid, image, 0), np.where(valid, variance, 0)
                mean = float(np.sum(wa * values) / asum)
                bg = float(np.sum(wb * values) / bsum)
                bg_var = float(np.sum((wb / bsum) ** 2 * errors))
                excess_var = float(np.sum((wa / asum) ** 2 * errors) + bg_var)
                omega = pixel_solid_angles(data.spatial_wcs, xx + left, yy + bottom)
                if not np.isfinite(omega).all() or not (omega > 0).all():
                    raise ValueError("Invalid pixel solid angles")
                weights = wa * omega
                area = float(weights.sum())
                flux = float(np.sum(weights * (values - bg)) * 1e9)
                flux_var = float(np.sum(weights**2 * errors) + area**2 * bg_var) * 1e18
                error = math.sqrt(flux_var)
                snr = flux / error if error > 0 else None
                if snr is not None and not math.isfinite(snr):
                    snr = None
                measurements = RegionMeasurements(
                    mean_brightness_mjy_sr=mean,
                    background_mjy_sr=bg,
                    excess_mjy_sr=mean - bg,
                    excess_error_mjy_sr=math.sqrt(excess_var),
                    usable_aperture_flux_mjy=flux,
                    flux_error_mjy=error,
                    snr=snr,
                    solid_angle_sr=area,
                )
                status = (
                    "partial" if coverage < 0.999 or bg_coverage < 0.999 else "success"
                )
                if snr is None:
                    summary = (
                        "Supplied variance cannot support a signal-to-noise estimate."
                    )
                elif snr >= 5:
                    summary = (
                        "Positive excess above local background; "
                        "object type is unverified."
                    )
                elif snr >= 3:
                    summary = (
                        "Modest positive excess; background structure "
                        "or noise may contribute."
                    )
                elif snr <= -3:
                    summary = (
                        "Below local background; this alone "
                        "does not establish absorption."
                    )
                else:
                    summary = (
                        "No clear excess above background at the measured uncertainty."
                    )
            return RegionAnalysis(
                status=status,
                summary=summary,
                ra_deg=ra,
                dec_deg=dec,
                pixel_x=x,
                pixel_y=y,
                radius_px=radius_px,
                background_inner_px=inner,
                background_outer_px=outer,
                usable_pixels=usable,
                masked_pixels=masked,
                aperture_coverage=float(coverage),
                background_coverage=float(bg_coverage),
                background_clipped_pixels=clipped_count,
                wavelength_rejected_pixels=wavelength_rejected,
                wavelength_um=wave,
                bandwidth_um=band,
                measurements=measurements,
                source_url=retrieved.request_url,
            )
