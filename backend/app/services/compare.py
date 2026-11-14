"""Full-SIP registration and conservative pixel-level wavelength gating for blink."""

import math
from urllib.parse import urlsplit

import astropy.units as u
import numpy as np
from astropy.time import Time
from astropy.visualization import LogStretch, ZScaleInterval
from astropy.wcs import NoConvergence
from reproject import reproject_interp

from app.schemas.compare import CompareRequest, CompareResponse, ComparisonEpoch
from app.services.fits_download import FitsStore, cutout_url
from app.services.fits_parser import InvalidFitsError, open_observation
from app.services.observations import PRODUCT_NAME
from app.services.quality import usable_pixels

PAIR_MARGIN_UM = 0.002
MIN_MATCHED_PIXELS = 16
MAX_REFERENCE_AXIS = 256
MAX_INPUT_AXIS = 512


def validate_observations(urls, ra, dec, size_deg):
    if not 2 <= len(urls) <= 4:
        raise ValueError("Choose two to four observations")
    identities = []
    for url in urls:
        cutout_url(url, ra, dec, size_deg)
        match = PRODUCT_NAME.fullmatch(urlsplit(url).path.rsplit("/", 1)[-1])
        identities.append((match[1], "D" + match[2], match[3]))
    if len({identity[:2] for identity in identities}) != len(identities):
        raise ValueError("Choose different exposures, not reprocessed versions")
    if len({identity[1] for identity in identities}) != 1:
        raise ValueError("Choose observations from the same detector")
    return identities


def validate_pair(request: CompareRequest):
    return validate_observations(
        [request.access_url_a, request.access_url_b],
        request.ra,
        request.dec,
        request.size_deg,
    )


def matching_wavelengths(wave_a, wave_b, band_a, band_b):
    return (
        np.isfinite(wave_a)
        & np.isfinite(wave_b)
        & np.isfinite(band_a)
        & np.isfinite(band_b)
        & (wave_a > 0)
        & (wave_b > 0)
        & (band_a > 0)
        & (band_b > 0)
        & (np.abs(wave_a - wave_b) + PAIR_MARGIN_UM <= np.minimum(band_a, band_b))
    )


def read_epoch(data, retrieved, url, expected, ra, dec):
    header = data.hdus["IMAGE"].header
    try:
        identity = (str(header["OBSID"]), "D" + str(int(header["DETECTOR"])))
        if identity != expected[:2]:
            raise InvalidFitsError("FITS identity does not match its selected product")
        if str(header.get("TIMESYS", "UTC")).upper() != "UTC":
            raise InvalidFitsError("Unsupported observation time scale")
        date = Time(str(header["DATE-OBS"]), format="isot", scale="utc")
        if not np.isfinite(date.mjd):
            raise InvalidFitsError("Missing observation date")
        if "MJD-OBS" in header:
            other = Time(float(header["MJD-OBS"]), format="mjd", scale="utc")
            if abs((date - other).to_value(u.s)) > 1:
                raise InvalidFitsError("Observation timestamps disagree")
        x, y = data.target_pixel(ra, dec)
        wave, band = data.wavelength_at(x, y)
        return ComparisonEpoch(
            obs_id=identity[0],
            detector=identity[1],
            utc_date=date.isot + "Z",
            mjd_start=float(date.mjd),
            access_url=url,
            source_request_url=retrieved.request_url,
            processing_version=expected[2],
            cached_fits=retrieved.cached,
            target_wavelength_um=wave,
            target_bandwidth_um=band,
        )
    except (ValueError, TypeError, KeyError) as error:
        raise InvalidFitsError("Invalid observation identity or timestamp") from error


def calibrated_planes(data):
    yy, xx = np.indices(data.image.shape, dtype=float)
    wave, band = data.wavelength_wcs.pixel_to_world(xx, yy)
    wave, band = np.asarray(wave.to_value(u.um)), np.asarray(band.to_value(u.um))
    image = (data.image * data.image_unit).to_value(u.MJy / u.sr)
    variance = (data.variance * data.variance_unit).to_value((u.MJy / u.sr) ** 2)
    valid = usable_pixels(image, variance, data.flags)
    valid &= np.isfinite(wave) & np.isfinite(band) & (wave > 0) & (band > 0)
    return np.asarray(image, dtype=float), wave, band, valid


def sample_neighbourhood(reference, other, wave, band, valid, projected, footprint):
    """Retain every bilinear contributor's wavelength, bandwidth, and quality."""
    shape = reference.image.shape
    height, width = other.image.shape
    if min(height, width) < 2:
        return (
            np.zeros(shape, dtype=bool),
            np.full((4, *shape), np.nan),
            np.full((4, *shape), np.nan),
        )
    yy, xx = np.indices(shape, dtype=float)
    sky = reference.spatial_wcs.pixel_to_world(xx, yy)
    try:
        bx, by = other.spatial_wcs.world_to_pixel(sky)
    except NoConvergence as error:
        raise InvalidFitsError("Common-grid coordinates did not converge") from error
    inside = (
        np.isfinite(bx)
        & np.isfinite(by)
        & (bx >= 0)
        & (by >= 0)
        & (bx < width - 1)
        & (by < height - 1)
    )
    ix = np.floor(np.where(inside, bx, 0)).astype(int)
    iy = np.floor(np.where(inside, by, 0)).astype(int)
    coverage = inside & np.isfinite(projected) & (footprint > 0)
    waves, bands = [], []
    for dx, dy in [(0, 0), (1, 0), (0, 1), (1, 1)]:
        coverage &= valid[iy + dy, ix + dx]
        waves.append(wave[iy + dy, ix + dx])
        bands.append(band[iy + dy, ix + dx])
    return coverage, np.stack(waves), np.stack(bands)


def _common_masks(
    a, b, wave_a, band_a, valid_a, wave_b, band_b, valid_b, projected, footprint
):
    coverage, waves, bands = sample_neighbourhood(
        a, b, wave_b, band_b, valid_b, projected, footprint
    )
    coverage &= valid_a
    spectral = np.ones(a.image.shape, dtype=bool)
    for wave, band in zip(waves, bands):
        spectral &= matching_wavelengths(wave_a, wave, band_a, band)
    return coverage, coverage & spectral


def shared_display(images, mask, stretch):
    values = np.concatenate([image[mask] for image in images])
    if stretch == "zscale":
        low, high = (float(value) for value in ZScaleInterval().get_limits(values))
    else:
        low, high = float(np.min(values)), float(np.max(values))

    scale = max(abs(low), abs(high), np.finfo(float).tiny)
    # Reprojection can add last-bit noise even to an exactly constant field.
    has_contrast = high - low > 32 * np.finfo(float).eps * scale

    def display(image):
        result = np.full(image.shape, np.nan, dtype=float)
        if has_contrast:
            scaled = np.clip((image[mask] - low) / (high - low), 0, 1)
            if stretch == "log":
                scaled = LogStretch(a=1000)(scaled)
            result[mask] = scaled
        else:
            result[mask] = 0.5
        return [
            float(value) if np.isfinite(value) else None for value in result.ravel()
        ]

    return [display(image) for image in images], low, high


def _display_pair(a, b, mask, stretch):
    pixels, low, high = shared_display([a, b], mask, stretch)
    return pixels[0], pixels[1], low, high


def prepare_comparison(request: CompareRequest, store: FitsStore) -> CompareResponse:
    identities = validate_pair(request)
    retrieved_a = store.fetch(
        request.access_url_a, request.ra, request.dec, request.size_deg
    )
    # Extra B sky coverage accommodates rotation; A remains the sole reference grid.
    b_size = min(0.5, request.size_deg * math.sqrt(2) + 0.01)
    retrieved_b = store.fetch(request.access_url_b, request.ra, request.dec, b_size)
    with (
        open_observation(retrieved_a.path) as a,
        open_observation(retrieved_b.path) as b,
    ):
        if (
            max(a.image.shape) > MAX_REFERENCE_AXIS
            or max(b.image.shape) > MAX_INPUT_AXIS
        ):
            raise InvalidFitsError("Comparison exceeds bounded image dimensions")
        epoch_a = read_epoch(
            a, retrieved_a, request.access_url_a, identities[0], request.ra, request.dec
        )
        epoch_b = read_epoch(
            b, retrieved_b, request.access_url_b, identities[1], request.ra, request.dec
        )
        image_a, wave_a, band_a, valid_a = calibrated_planes(a)
        image_b, wave_b, band_b, valid_b = calibrated_planes(b)
        try:
            projected, footprint = reproject_interp(
                (np.where(valid_b, image_b, np.nan), b.spatial_wcs),
                a.spatial_wcs,
                shape_out=a.image.shape,
                order="bilinear",
                roundtrip_coords=True,
            )
        except ValueError as error:
            raise InvalidFitsError(
                "The common image grid could not be prepared"
            ) from error
        coverage, usable = _common_masks(
            a, b, wave_a, band_a, valid_a, wave_b, band_b, valid_b, projected, footprint
        )
        target_match = bool(
            matching_wavelengths(
                epoch_a.target_wavelength_um,
                epoch_b.target_wavelength_um,
                epoch_a.target_bandwidth_um,
                epoch_b.target_bandwidth_um,
            )
        )
        date_a = Time(epoch_a.utc_date, format="isot", scale="utc")
        date_b = Time(epoch_b.utc_date, format="isot", scale="utc")
        baseline = abs(float((date_b - date_a).to_value(u.day)))
        x, y = a.target_pixel(request.ra, request.dec)
        ix, iy = math.floor(x + 0.5), math.floor(y + 0.5)
        count, common = int(usable.sum()), int(coverage.sum())
        if baseline == 0:
            status, message = (
                "no_time_baseline",
                "Choose observations taken at different times.",
            )
        elif not target_match:
            status, message = (
                "incompatible_wavelength",
                "Target wavelengths do not match within the channel-width rule.",
            )
        elif common == 0:
            status, message = (
                "no_usable_overlap",
                "No common quality-screened pixels remain.",
            )
        elif count < MIN_MATCHED_PIXELS or not usable[iy, ix]:
            status, message = (
                "insufficient_coverage",
                "The target and at least 16 common pixels must pass all checks.",
            )
        else:
            status, message = (
                "ready",
                "Ready for visual blink on the matched-pixel mask.",
            )
        ready = status == "ready"
        pixels_a, pixels_b, low, high = [], [], None, None
        if ready:
            pixels_a, pixels_b, low, high = _display_pair(
                image_a, projected, usable, request.stretch
            )
        height, width = a.image.shape
        return CompareResponse(
            status=status,
            message=message,
            epoch_a=epoch_a,
            epoch_b=epoch_b,
            width=width,
            height=height,
            blink_ready=ready,
            target_wavelength_match=target_match,
            baseline_days=baseline,
            coverage_pixel_count=common,
            matched_pixel_count=count,
            matched_fraction=count / (width * height),
            coverage_mask=coverage.ravel().tolist(),
            valid_mask=usable.ravel().tolist(),
            pixels_a=pixels_a,
            pixels_b=pixels_b,
            display_min_mjy_sr=low,
            display_max_mjy_sr=high,
            stretch_applied=request.stretch,
            spatial_wcs_header=a.spatial_wcs.to_header(relax=True).tostring(
                sep="\n", endcard=True, padding=False
            ),
        )
