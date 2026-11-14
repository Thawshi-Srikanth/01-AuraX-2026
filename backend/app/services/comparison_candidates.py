"""One bounded IRSA metadata set with optional detector and UTC date filters."""

from datetime import UTC, datetime, timedelta

import pyvo
import requests
from astropy.time import Time
from pydantic import BaseModel

from app.schemas.comparison_matches import MatchRequest
from app.schemas.observation import SPHERExObservation
from app.services.observations import (
    IRSA_TAP_URL,
    ArchiveUnavailable,
    InvalidArchiveResponse,
    parse_observation,
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


def query_candidates(request: MatchRequest):
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
    try:
        with MatchingSession() as session:
            results = pyvo.dal.TAPService(IRSA_TAP_URL, session=session).search(
                query, maxrec=bound
            )
            table = results.to_table()
            overflow = results.query_status == "OVERFLOW"
    except (pyvo.dal.DALAccessError, requests.RequestException, OSError) as error:
        raise ArchiveUnavailable from error
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
    )
