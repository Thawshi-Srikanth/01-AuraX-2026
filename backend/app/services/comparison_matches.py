"""Persist bounded matching progress; only explicit advance may retrieve new MEFs."""

import hashlib
import itertools
import json
import math
import time
from datetime import UTC, date, datetime
from threading import Lock

import astropy.units as u
from astropy.time import Time
from pydantic import BaseModel, Field, ValidationError

from app.db.cache import CacheManager
from app.schemas.compare import CompareRequest
from app.schemas.comparison_matches import (
    MatchedPair,
    MatchRequest,
    MatchResponse,
    ObservationCheck,
)
from app.services.compare import matching_wavelengths, read_epoch
from app.services.comparison_candidates import CandidateBatch, query_candidates
from app.services.fits_download import FitsContentError, FitsDownloadError, FitsStore
from app.services.fits_parser import InvalidFitsError, open_observation
from app.services.quality import usable_pixels

STATE_NAMESPACE = "comparison_matches:v1"
STATE_TTL_SECONDS = 3600
MAX_NEW_DOWNLOADS = 2
MAX_FILE_CHECKS = 16
MAX_PAIRS = 24
BATCH_BUDGET_SECONDS = 45
_SEARCH_LOCK = Lock()


class MatchingBusy(Exception):
    """Another matching pass is active in this backend process."""


class SearchState(BaseModel):
    scope: dict
    batch: CandidateBatch
    checks: dict[str, ObservationCheck] = Field(default_factory=dict)
    next_candidate_index: int = Field(default=0, ge=0)


def _inspect(product, retrieved, request):
    with open_observation(retrieved.path) as data:
        epoch = read_epoch(
            data,
            retrieved,
            product.access_url,
            (product.obs_id, product.detector, product.processing_version),
            request.ra,
            request.dec,
        )
        actual = Time(epoch.utc_date, format="isot", scale="utc")
        archived = Time(product.utc_date, format="isot", scale="utc")
        if abs((actual - archived).to_value(u.s)) > 1:
            raise InvalidFitsError("FITS time disagrees with archive metadata")
        actual_date = date.fromisoformat(epoch.utc_date[:10])
        reason = None
        if (request.from_date and actual_date < request.from_date) or (
            request.to_date and actual_date > request.to_date
        ):
            reason = "outside_dates"
        x, y = data.target_pixel(request.ra, request.dec)
        ix, iy = math.floor(x + 0.5), math.floor(y + 0.5)
        if not bool(
            usable_pixels(data.image[iy, ix], data.variance[iy, ix], data.flags[iy, ix])
        ):
            reason = reason or "unusable_target"
        return ObservationCheck(
            artifact_id=product.artifact_id,
            status="excluded" if reason else "verified",
            checked_at=datetime.now(UTC),
            epoch=epoch,
            reason=reason,
        )


def _pairs(checks, request):
    verified = [check for check in checks if check.status == "verified" and check.epoch]
    pairs = []
    for a, b in itertools.combinations(verified, 2):
        ea, eb = a.epoch, b.epoch
        if ea.detector != eb.detector or ea.obs_id == eb.obs_id:
            continue
        ta, tb = (
            Time(ea.utc_date, format="isot", scale="utc"),
            Time(eb.utc_date, format="isot", scale="utc"),
        )
        baseline = float((tb - ta).to_value(u.day))
        if baseline == 0:
            continue
        if baseline < 0:
            a, b, ea, eb = b, a, eb, ea
        if not bool(
            matching_wavelengths(
                ea.target_wavelength_um,
                eb.target_wavelength_um,
                ea.target_bandwidth_um,
                eb.target_bandwidth_um,
            )
        ):
            continue
        pairs.append(
            MatchedPair(
                artifact_id_a=a.artifact_id,
                artifact_id_b=b.artifact_id,
                detector=ea.detector,
                baseline_days=abs(baseline),
                wavelength_a_um=ea.target_wavelength_um,
                wavelength_b_um=eb.target_wavelength_um,
                bandwidth_a_um=ea.target_bandwidth_um,
                bandwidth_b_um=eb.target_bandwidth_um,
                comparison_request=CompareRequest(
                    access_url_a=ea.access_url,
                    access_url_b=eb.access_url,
                    ra=request.ra,
                    dec=request.dec,
                ),
            )
        )
    pairs.sort(
        key=lambda pair: (
            -pair.baseline_days,
            abs(pair.wavelength_a_um - pair.wavelength_b_um),
            pair.artifact_id_a,
            pair.artifact_id_b,
        )
    )
    return pairs


def _run(request: MatchRequest, cache: CacheManager, store: FitsStore):
    deadline = time.monotonic() + BATCH_BUDGET_SECONDS
    scope = request.model_dump(mode="json", exclude={"advance", "retry_failed"})
    key = hashlib.sha256(
        json.dumps(scope, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    state, state_cached = None, False
    cached = cache.get(key, STATE_NAMESPACE)
    if cached is not None:
        try:
            candidate = SearchState.model_validate(cached)
            if candidate.scope == scope:
                state, state_cached = candidate, True
        except (ValidationError, TypeError):
            pass
    if state is None:
        state = SearchState(scope=scope, batch=query_candidates(request))
    if request.retry_failed:
        state.checks = {
            key: check
            for key, check in state.checks.items()
            if check.status != "failed"
        }
    reused = len(state.checks)
    downloads, local_checks, inspections = 0, 0, 0
    products = list(enumerate(state.batch.observations))
    if products:
        start = state.next_candidate_index % len(products)
        products = products[start:] + products[:start]
    for index, product in products:
        if product.artifact_id in state.checks:
            continue
        if inspections >= MAX_FILE_CHECKS or time.monotonic() >= deadline:
            break
        # Count misses too, and rotate the scan so later cached files can progress.
        inspections += 1
        state.next_candidate_index = (index + 1) % len(products)
        try:
            retrieved = store.get_cached(
                product.access_url, request.ra, request.dec, 0.03
            )
            if retrieved is None:
                if not request.advance or downloads >= MAX_NEW_DOWNLOADS:
                    continue
                downloads += 1
                retrieved = store.fetch(
                    product.access_url, request.ra, request.dec, 0.03
                )
            else:
                local_checks += 1
            check = _inspect(product, retrieved, request)
        except (FitsContentError, InvalidFitsError, ValueError):
            check = ObservationCheck(
                artifact_id=product.artifact_id,
                status="failed",
                checked_at=datetime.now(UTC),
                reason="invalid_calibration",
            )
        except (FitsDownloadError, OSError):
            check = ObservationCheck(
                artifact_id=product.artifact_id,
                status="failed",
                checked_at=datetime.now(UTC),
                reason="download_failed",
            )
        state.checks[product.artifact_id] = check
    checks = [
        state.checks[product.artifact_id]
        for product in state.batch.observations
        if product.artifact_id in state.checks
    ]
    verified = sum(check.status == "verified" for check in checks)
    excluded = sum(check.status == "excluded" for check in checks)
    failed = sum(check.status == "failed" for check in checks)
    pending = len(state.batch.observations) - len(checks)
    complete = not (
        state.batch.truncated or state.batch.rejected_count or pending or failed
    )
    pairs = _pairs(checks, request)
    if not complete:
        status, message = (
            "partial",
            "Matching is incomplete; unchecked or unavailable candidates remain.",
        )
        if state.batch.truncated:
            message += " Narrow the date/detector scope or increase candidate_limit."
    elif not state.batch.observations:
        status, message = (
            "no_coverage",
            "No public products were returned in this query scope.",
        )
    elif pairs:
        status, message = (
            "matches",
            "Target-position pairs found; full image preparation is still required.",
        )
    else:
        status, message = (
            "no_matches",
            "No usable pairs among the fully checked candidates in this scope.",
        )
    # Metadata age, rather than polling activity, fixes this search's expiry.
    remaining = (
        STATE_TTL_SECONDS
        - (datetime.now(UTC) - state.batch.retrieved_at).total_seconds()
    )
    persisted = False
    if state.batch.observations and remaining > 0:
        persisted = cache.set(
            key, state.model_dump(mode="json"), STATE_NAMESPACE, remaining
        )
        if not persisted:
            message += (
                " Progress could not be saved; a later request may repeat checks."
            )
    return MatchResponse(
        ra=request.ra,
        dec=request.dec,
        detector=request.detector,
        from_date=request.from_date,
        to_date=request.to_date,
        candidate_limit=request.candidate_limit,
        candidate_count=len(state.batch.observations),
        metadata_rows=state.batch.metadata_rows,
        metadata_truncated=state.batch.truncated,
        metadata_rejected_count=state.batch.rejected_count,
        duplicate_exposure_count=state.batch.duplicate_exposure_count,
        metadata_retrieved_at=state.batch.retrieved_at,
        checked_count=verified + excluded,
        verified_count=verified,
        excluded_count=excluded,
        failed_count=failed,
        pending_count=pending,
        new_download_attempts=downloads,
        candidate_inspections=inspections,
        cached_file_checks=local_checks,
        reused_checks_count=reused,
        state_cached=state_cached,
        state_persisted=persisted,
        search_complete=complete,
        can_continue=pending > 0,
        can_retry_failed=failed > 0,
        pairs_count=len(pairs),
        pairs_truncated=len(pairs) > MAX_PAIRS,
        pairs=pairs[:MAX_PAIRS],
        checks=checks,
        status=status,
        message=message,
    )


def discover_matches(request: MatchRequest, cache: CacheManager, store: FitsStore):
    if not _SEARCH_LOCK.acquire(blocking=False):
        raise MatchingBusy
    try:
        return _run(request, cache, store)
    finally:
        _SEARCH_LOCK.release()
