"""One bounded IRSA metadata set with optional detector and UTC date filters."""

from collections import deque
from datetime import UTC, date, datetime, timedelta

import pyvo
import requests
from astropy.time import Time
from pydantic import BaseModel

from app.schemas.comparison_matches import MatchRequest
from app.schemas.observation import SPHERExObservation
from app.services.observations import (
    IRSA_TAP_URL,
    InvalidArchiveResponse,
    parse_observation,
    query_sia,
)

REQUIRED_COLUMNS = {
    "time_bounds_lower",
    "time_exposure",
    "energy_bandpassname",
    "energy_bounds_lower",
    "energy_bounds_upper",
    "uri",
    "artifactid",
}


class MatchingSession(requests.Session):
    def request(self, method, url, **kwargs):
        # These indexed/spatial archive queries can take longer than simple lookups.
        kwargs["timeout"] = (5, 45)
        return super().request(method, url, **kwargs)


class CandidateBatch(BaseModel):
    observations: list[SPHERExObservation]
    metadata_rows: int
    truncated: bool
    rejected_count: int
    duplicate_exposure_count: int
    retrieved_at: datetime
    provenance: str = "NASA/IPAC IRSA TAP: spherex.plane and spherex.artifact"
    source_url: str = IRSA_TAP_URL
    fallback_notice: str | None = None
    candidate_scope: str = (
        "Bounded archive-selected products in the requested detector/date scope"
    )


def query_candidates(request: MatchRequest):
    if request.time_sampling == "spread":
        return query_spread_candidates(request)
    return query_window(request)


def query_window(request: MatchRequest, *, sia_only=False):
    bound = request.candidate_limit + 1
    clauses = [
        f"1 = CONTAINS(POINT('ICRS', {request.ra!r}, {request.dec!r}), p.poly)",
        "a.uri LIKE '%/level2/%'",
    ]
    if request.detector:
        clauses.append(f"p.energy_bandpassname = 'SPHEREx-{request.detector}'")
    if request.from_date:
        start = float(Time(request.from_date.isoformat(), scale="utc").mjd)
        clauses.append(f"p.time_bounds_lower >= {start!r}")
    if request.to_date:
        end = float(
            Time((request.to_date + timedelta(days=1)).isoformat(), scale="utc").mjd
        )
        clauses.append(f"p.time_bounds_lower < {end!r}")
    query = f"""SELECT TOP {bound}
        p.time_bounds_lower, p.time_exposure, p.energy_bandpassname,
        p.energy_bounds_lower, p.energy_bounds_upper, a.uri, a.artifactid
        FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid
        WHERE {" AND ".join(clauses)}"""
    fallback = sia_only
    if not fallback:
        try:
            with MatchingSession() as session:
                results = pyvo.dal.TAPService(IRSA_TAP_URL, session=session).search(
                    query, maxrec=bound
                )
                table = results.to_table()
                overflow = results.query_status == "OVERFLOW"
        except (pyvo.dal.DALAccessError, requests.RequestException, OSError):
            fallback = True
    if fallback:
        table = query_sia(
            request.ra,
            request.dec,
            request.candidate_limit,
            detector=request.detector,
            start=start if request.from_date else None,
            end=end if request.to_date else None,
        )
        overflow = bool(table.meta.get("overflow", False))
    if table is None or not REQUIRED_COLUMNS.issubset(table.colnames):
        raise InvalidArchiveResponse
    observations, identities, rejected, duplicates = [], set(), 0, 0
    for row in table[: request.candidate_limit]:
        try:
            product = parse_observation(row)
            if request.detector and product.detector != request.detector:
                raise ValueError("Product does not match detector scope")
            identity = (product.obs_id, product.detector)
            if identity in identities:
                duplicates += 1
                continue
            identities.add(identity)
            observations.append(product)
        except (ValueError, TypeError, KeyError, IndexError, OverflowError):
            rejected += 1
    # Sort only the bounded subset, avoiding an archive-wide date sort.
    observations.sort(key=lambda product: (product.mjd_start, product.artifact_id))
    return CandidateBatch(
        observations=observations,
        metadata_rows=min(len(table), request.candidate_limit),
        truncated=len(table) > request.candidate_limit or overflow,
        rejected_count=rejected,
        duplicate_exposure_count=duplicates,
        retrieved_at=datetime.now(UTC),
        **{
            key: table.meta[key]
            for key in ("source_url", "provenance", "fallback_notice")
            if key in table.meta
        },
    )


def query_spread_candidates(request: MatchRequest):
    """Two bounded date windows, interleaved before any FITS downloads."""
    start = request.from_date or date(2025, 5, 1)
    end = request.to_date or max(start, datetime.now(UTC).date())
    if (end - start).days < 2:
        return query_window(request.model_copy(update={"time_sampling": "archive"}))
    middle = start + (end - start) // 2
    windows = [(start, middle), (middle + timedelta(days=1), end)]
    batches = []
    for index, (lower, upper) in enumerate(windows):
        limit = max(
            2,
            request.candidate_limit // 2
            + (request.candidate_limit % 2 if index else 0),
        )
        scoped = request.model_copy(
            update={
                "time_sampling": "archive",
                "from_date": lower,
                "to_date": upper,
                "candidate_limit": limit,
            }
        )
        # An outage in the first window need not be paid for a second time.
        batches.append(
            query_window(scoped, sia_only=bool(batches and batches[0].fallback_notice))
        )
    detectors = sorted(
        {product.detector for batch in batches for product in batch.observations}
    )
    queues = [
        {
            detector: deque(
                product
                for product in batch.observations
                if product.detector == detector
            )
            for detector in detectors
        }
        for batch in batches
    ]
    products, seen, duplicates = [], set(), 0
    while any(queue for window in queues for queue in window.values()):
        for detector in detectors:
            for window in queues:
                if not window[detector]:
                    continue
                product = window[detector].popleft()
                identity = (product.obs_id, product.detector)
                if identity in seen:
                    duplicates += 1
                else:
                    seen.add(identity)
                    products.append(product)
    notice = next(
        (batch.fallback_notice for batch in batches if batch.fallback_notice), None
    )
    return CandidateBatch(
        observations=products[: request.candidate_limit],
        metadata_rows=sum(batch.metadata_rows for batch in batches),
        truncated=any(batch.truncated for batch in batches)
        or len(products) > request.candidate_limit,
        rejected_count=sum(batch.rejected_count for batch in batches),
        duplicate_exposure_count=duplicates
        + sum(batch.duplicate_exposure_count for batch in batches),
        retrieved_at=min(batch.retrieved_at for batch in batches),
        provenance="; ".join(dict.fromkeys(batch.provenance for batch in batches)),
        source_url=batches[-1].source_url,
        fallback_notice=notice,
        candidate_scope=(
            f"Two bounded date windows from {start} to {end}; "
            "earlier/later candidates interleaved by detector. "
            "Not a complete archive scan or guaranteed extreme dates."
        ),
    )
