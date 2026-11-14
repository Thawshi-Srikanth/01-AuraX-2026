"""Extract only measured nearest-pixel samples from a bounded set of real MEFs."""

import math

import astropy.units as u
from astropy.coordinates import SkyCoord

from app.db.cache import CacheManager
from app.schemas.spectrum import ExcludedObservation, SpectralPoint, SpectrumResponse
from app.services.fits_download import FitsContentError, FitsDownloadError, FitsStore
from app.services.fits_parser import InvalidFitsError, open_observation
from app.services.observations import find_observations
from app.services.quality import usable_pixels


def _sample(observation, product, ra, dec, store):
    with store.lease(product.access_url, ra, dec, 0.03):
        retrieved = store.fetch(product.access_url, ra, dec, 0.03)
        with open_observation(retrieved.path) as data:
            x, y = data.target_pixel(ra, dec)
            ix, iy = math.floor(x + 0.5), math.floor(y + 0.5)
            flux = float((data.image[iy, ix] * data.image_unit).to_value(u.MJy / u.sr))
            variance = float(
                (data.variance[iy, ix] * data.variance_unit).to_value(
                    (u.MJy / u.sr) ** 2
                )
            )
            flags = int(data.flags[iy, ix])
            if not bool(usable_pixels(flux, variance, flags)):
                return ExcludedObservation(
                    **observation,
                    reason="unusable_pixel",
                    pixel_x=ix,
                    pixel_y=iy,
                    flags=flags,
                )
            # Match the wavelength to the same pixel that supplied the measurement.
            wave, bandwidth = data.wavelength_at(ix, iy)
            sigma = math.sqrt(variance)
            snr = flux / sigma if sigma > 0 else None
            if snr is not None and not math.isfinite(snr):
                snr = None
            target = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame="icrs")
            pixel_sky = data.spatial_wcs.pixel_to_world(ix, iy)
            return SpectralPoint(
                artifact_id=product.artifact_id,
                obs_id=product.obs_id,
                detector=product.detector,
                utc_date=product.utc_date,
                mjd_start=product.mjd_start,
                processing_version=product.processing_version,
                source_url=retrieved.request_url,
                cached_fits=retrieved.cached,
                pixel_x=ix,
                pixel_y=iy,
                target_x=x,
                target_y=y,
                sample_offset_arcsec=float(target.separation(pixel_sky).arcsec),
                wavelength_um=wave,
                bandwidth_um=bandwidth,
                resolving_power=wave / bandwidth,
                flux_mjy_sr=flux,
                flux_error_mjy_sr=sigma,
                snr=snr,
                flags=flags,
            )


def extract_spectrum(
    ra: float, dec: float, limit: int, cache: CacheManager, store: FitsStore
):
    if not 1 <= limit <= 6:
        raise ValueError("Spectrum requests must use 1 to 6 observations")
    metadata = find_observations(ra, dec, limit, cache)
    points, excluded = [], []
    for product in metadata.observations:
        identity = dict(
            artifact_id=product.artifact_id,
            obs_id=product.obs_id,
            detector=product.detector,
            utc_date=product.utc_date,
            access_url=product.access_url,
        )
        try:
            result = _sample(identity, product, ra, dec, store)
            if isinstance(result, SpectralPoint):
                points.append(result)
            else:
                excluded.append(result)
        except (FitsContentError, InvalidFitsError):
            excluded.append(
                ExcludedObservation(**identity, reason="invalid_calibration")
            )
        except (FitsDownloadError, OSError):
            excluded.append(ExcludedObservation(**identity, reason="download_failed"))
    points.sort(
        key=lambda point: (point.wavelength_um, point.mjd_start, point.artifact_id)
    )
    if metadata.status == "no_coverage":
        status, message = "no_coverage", metadata.message
    elif metadata.status == "partial" or metadata.truncated or excluded:
        if (
            points
            or any(item.reason != "unusable_pixel" for item in excluded)
            or metadata.truncated
            or metadata.status == "partial"
        ):
            status = "partial"
            message = "Measured samples only; coverage is incomplete."
        else:
            status = "no_usable_data"
            message = "The sampled target pixels failed quality checks."
    else:
        status = "success"
        message = (
            "Returned observed surface-brightness samples; no channels were filled."
        )
    return SpectrumResponse(
        ra_deg=ra,
        dec_deg=dec,
        requested_observations=limit,
        attempted_observations=len(metadata.observations),
        total_samples=len(points),
        metadata_truncated=metadata.truncated,
        rejected_metadata_count=metadata.rejected_count,
        cached_metadata=metadata.cached,
        archive_retrieved_at=metadata.retrieved_at,
        spectral_points=points,
        excluded_observations=excluded,
        status=status,
        message=message,
    )
