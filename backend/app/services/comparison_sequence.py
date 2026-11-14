"""One reference grid and shared mask, with every epoch/contributor pair checked."""

import itertools
import math
from contextlib import ExitStack
from dataclasses import dataclass

import astropy.units as u
import numpy as np
from astropy.time import Time
from reproject import reproject_interp

from app.schemas.sequence import (
    SequenceFrame,
    SequencePairCheck,
    SequenceRequest,
    SequenceResponse,
)
from app.services.compare import (
    MAX_INPUT_AXIS,
    MAX_REFERENCE_AXIS,
    MIN_MATCHED_PIXELS,
    calibrated_planes,
    matching_wavelengths,
    read_epoch,
    sample_neighbourhood,
    shared_display,
    validate_observations,
)
from app.services.fits_download import FitsStore
from app.services.fits_parser import InvalidFitsError, open_observation


@dataclass
class AlignedFrame:
    image: np.ndarray
    coverage: np.ndarray
    wavelengths: np.ndarray
    bandwidths: np.ndarray


def all_pair_masks(aligned):
    """No averaging of wavelength or bandwidth can hide a failing contributor."""
    shape = aligned[0].image.shape
    result = []
    for i, j in itertools.combinations(range(len(aligned)), 2):
        a, b = aligned[i], aligned[j]
        mask = np.ones(shape, dtype=bool)
        for wa, ba in zip(a.wavelengths, a.bandwidths):
            for wb, bb in zip(b.wavelengths, b.bandwidths):
                mask &= matching_wavelengths(wa, wb, ba, bb)
        result.append((i, j, mask))
    return result


def prepare_sequence(request: SequenceRequest, store: FitsStore) -> SequenceResponse:
    identities = validate_observations(
        request.access_urls, request.ra, request.dec, request.size_deg
    )
    epochs, aligned = [], []
    secondary_size = min(0.5, request.size_deg * math.sqrt(2) + 0.01)
    with ExitStack() as stack:
        reference = None
        for index, (url, identity) in enumerate(zip(request.access_urls, identities)):
            size = request.size_deg if index == 0 else secondary_size
            stack.enter_context(store.lease(url, request.ra, request.dec, size))
            retrieved = store.fetch(url, request.ra, request.dec, size)
            data = stack.enter_context(open_observation(retrieved.path))
            limit = MAX_REFERENCE_AXIS if index == 0 else MAX_INPUT_AXIS
            if max(data.image.shape) > limit:
                raise InvalidFitsError("Sequence exceeds bounded image dimensions")
            epoch = read_epoch(data, retrieved, url, identity, request.ra, request.dec)
            epochs.append(epoch)
            image, wave, band, valid = calibrated_planes(data)
            if index == 0:
                reference = data
                aligned.append(
                    AlignedFrame(image, valid, wave[None, ...], band[None, ...])
                )
                continue
            try:
                projected, footprint = reproject_interp(
                    (np.where(valid, image, np.nan), data.spatial_wcs),
                    reference.spatial_wcs,
                    shape_out=reference.image.shape,
                    order="bilinear",
                    roundtrip_coords=True,
                )
            except ValueError as error:
                raise InvalidFitsError(
                    "The sequence grid could not be prepared"
                ) from error
            coverage, waves, bands = sample_neighbourhood(
                reference, data, wave, band, valid, projected, footprint
            )
            aligned.append(AlignedFrame(projected, coverage, waves, bands))
        common = np.logical_and.reduce([frame.coverage for frame in aligned])
        usable = common.copy()
        pair_checks = []
        for i, j, mask in all_pair_masks(aligned):
            usable &= mask
            a, b = epochs[i], epochs[j]
            target_match = bool(
                matching_wavelengths(
                    a.target_wavelength_um,
                    b.target_wavelength_um,
                    a.target_bandwidth_um,
                    b.target_bandwidth_um,
                )
            )
            pair_checks.append(
                SequencePairCheck(
                    epoch_index_a=i,
                    epoch_index_b=j,
                    target_wavelength_match=target_match,
                    matched_pixel_count=int(np.count_nonzero(common & mask)),
                )
            )
        target_match = all(pair.target_wavelength_match for pair in pair_checks)
        dates = [Time(epoch.utc_date, format="isot", scale="utc") for epoch in epochs]
        ordered_dates = sorted(dates, key=lambda value: float(value.mjd))
        baseline = float((ordered_dates[-1] - ordered_dates[0]).to_value(u.day))
        distinct_times = len({epoch.utc_date for epoch in epochs}) == len(epochs)
        x, y = reference.target_pixel(request.ra, request.dec)
        ix, iy = math.floor(x + 0.5), math.floor(y + 0.5)
        count, coverage_count = int(usable.sum()), int(common.sum())
        if not distinct_times:
            status, message = (
                "duplicate_time",
                "Each selected observation must have a different time.",
            )
        elif not target_match:
            status, message = (
                "incompatible_wavelength",
                "At least one epoch pair fails the target wavelength rule.",
            )
        elif coverage_count == 0:
            status, message = (
                "no_usable_overlap",
                "No quality-screened area is common to every frame.",
            )
        elif count < MIN_MATCHED_PIXELS or not usable[iy, ix]:
            status, message = (
                "insufficient_coverage",
                "The target and at least 16 common pixels must pass every pair check.",
            )
        else:
            status, message = (
                "ready",
                "Ready for visual blink on one shared matched-pixel mask.",
            )
        frames, low, high = [], None, None
        ready = status == "ready"
        if ready:
            displayed, low, high = shared_display(
                [frame.image for frame in aligned], usable, request.stretch
            )
            frames = [
                SequenceFrame(epoch_index=i, pixels=pixels)
                for i, pixels in enumerate(displayed)
            ]
        height, width = reference.image.shape
        return SequenceResponse(
            status=status,
            message=message,
            epochs=epochs,
            frames=frames,
            width=width,
            height=height,
            blink_ready=ready,
            target_wavelength_match=target_match,
            baseline_days=baseline,
            coverage_pixel_count=coverage_count,
            matched_pixel_count=count,
            matched_fraction=count / (width * height),
            coverage_mask=common.ravel().tolist(),
            valid_mask=usable.ravel().tolist(),
            pair_checks=pair_checks,
            display_min_mjy_sr=low,
            display_max_mjy_sr=high,
            stretch_applied=request.stretch,
            spatial_wcs_header=reference.spatial_wcs.to_header(relax=True).tostring(
                sep="\n", endcard=True, padding=False
            ),
        )
