"""Bounded, metadata-only observation searches against IRSA's current tables."""

import json
import math
import re
from datetime import UTC, datetime
from urllib.parse import urlsplit

import astropy.units as u
import pyvo
import requests
from astropy.time import Time
from pydantic import ValidationError

from app.db.cache import CacheManager
from app.schemas.observation import ObservationsResponse, SPHERExObservation

IRSA_TAP_URL = "https://irsa.ipac.caltech.edu/TAP"
CACHE_NAMESPACE = "observations:v1"
CACHE_TTL_SECONDS = 3600
PRODUCT_NAME = re.compile(r"level2_(.+)D([1-6])_spx_(.+)\.fits")


class ArchiveUnavailable(Exception):
    """Archive query failed; it does not establish absence of coverage."""


class InvalidArchiveResponse(Exception):
    """Archive response could not be interpreted."""


class IrsaSession(requests.Session):
    def request(self, method, url, **kwargs):
        kwargs["timeout"] = (5, 30)
        return super().request(method, url, **kwargs)


def query_archive(ra: float, dec: float, limit: int):
    # One extra row establishes whether the requested result limit was reached.
    bound = limit + 1
    query = f"""SELECT TOP {bound}
        p.time_bounds_lower, p.time_exposure, p.energy_bandpassname,
        p.energy_bounds_lower, p.energy_bounds_upper, a.uri, a.artifactid
        FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid
        WHERE 1 = CONTAINS(POINT('ICRS', {ra!r}, {dec!r}), p.poly)
          AND a.uri LIKE '%/level2/%'
        ORDER BY p.time_bounds_lower ASC, a.artifactid ASC"""
    try:
        with IrsaSession() as session:
            results = pyvo.dal.TAPService(IRSA_TAP_URL, session=session).search(
                query, maxrec=bound
            )
            table = results.to_table()
            table.meta["overflow"] = results.query_status == "OVERFLOW"
            return table
    except (pyvo.dal.DALAccessError, requests.RequestException, OSError) as error:
        raise ArchiveUnavailable from error


def _value(row, column):
    value = row[column]
    return None if value is None or getattr(value, "mask", False) else value


def _text(row, column):
    value = _value(row, column)
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    return str(value).strip() if value is not None else None


def _number(row, column, optional=False):
    value = _value(row, column)
    if value is None and optional:
        return None
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Nonfinite archive metadata")
    return number


def parse_observation(row) -> SPHERExObservation:
    uri = _text(row, "uri")
    if not uri:
        raise ValueError("Missing product URI")
    url = (
        uri
        if uri.startswith("https://")
        else "https://irsa.ipac.caltech.edu/" + uri.lstrip("/")
    )
    parsed = urlsplit(url)
    if (
        parsed.scheme != "https"
        or parsed.netloc != "irsa.ipac.caltech.edu"
        or not parsed.path.startswith("/ibe/data/spherex/")
        or "/level2/" not in parsed.path
        or parsed.query
        or parsed.fragment
        or "%" in parsed.path
        or "\\" in parsed.path
        or ".." in parsed.path.split("/")
    ):
        raise ValueError("Unexpected product location")
    match = PRODUCT_NAME.fullmatch(parsed.path.rsplit("/", 1)[-1])
    if not match:
        raise ValueError("Unexpected product filename")
    detector = "D" + match[2]
    band_name = _text(row, "energy_bandpassname")
    if band_name != "SPHEREx-" + detector:
        raise ValueError("Product and bandpass disagree")
    low = (_number(row, "energy_bounds_lower") * u.m).to_value(u.um)
    high = (_number(row, "energy_bounds_upper") * u.m).to_value(u.um)
    if not 0 < low < high:
        raise ValueError("Invalid wavelength bounds")
    mjd = _number(row, "time_bounds_lower")
    utc = Time(mjd, format="mjd", scale="utc").isot + "Z"
    return SPHERExObservation(
        artifact_id=_text(row, "artifactid"),
        obs_id=match[1],
        detector=detector,
        band_name=band_name,
        release=parsed.path.split("/")[4],
        processing_version=match[3],
        mjd_start=mjd,
        utc_date=utc,
        date_only=utc[:10],
        wavelength_min_um=low,
        wavelength_max_um=high,
        exptime_sec=_number(row, "time_exposure", optional=True),
        access_url=url,
    )


def find_observations(ra: float, dec: float, limit: int, cache: CacheManager):
    if not (math.isfinite(ra) and 0 <= ra < 360):
        raise ValueError("Invalid right ascension")
    if not (math.isfinite(dec) and -90 <= dec <= 90) or not 1 <= limit <= 500:
        raise ValueError("Invalid declination or result limit")
    # Exact float representations prevent nearby sky positions sharing a cache key.
    key = json.dumps([ra, dec, limit], separators=(",", ":"))
    cached = cache.get(key, CACHE_NAMESPACE)
    if cached is not None:
        try:
            result = ObservationsResponse.model_validate(cached)
            if (result.ra_deg, result.dec_deg, result.limit) == (ra, dec, limit):
                return result.model_copy(update={"cached": True})
        except (ValidationError, TypeError):
            pass
    table = query_archive(ra, dec, limit)
    required_columns = {
        "time_bounds_lower",
        "time_exposure",
        "energy_bandpassname",
        "energy_bounds_lower",
        "energy_bounds_upper",
        "uri",
        "artifactid",
    }
    if table is None or not required_columns.issubset(table.colnames):
        raise InvalidArchiveResponse
    truncated = len(table) > limit or bool(table.meta.get("overflow", False))
    observations = []
    rejected = 0
    identities = set()
    for row in table[:limit]:
        try:
            observation = parse_observation(row)
            if observation.artifact_id in identities:
                raise ValueError("Duplicate artifact identity")
            identities.add(observation.artifact_id)
            observations.append(observation)
        except (KeyError, ValueError, TypeError, IndexError, OverflowError):
            rejected += 1
    if rejected or (not observations and truncated):
        status = "partial"
        message = "Archive results are incomplete; some metadata could not be used."
    elif observations:
        status = "success"
        message = f"Returned {len(observations)} image products."
        if truncated:
            message += " More results exist; this is a limited subset."
    else:
        status = "no_coverage"
        message = "No public Level 2 image products cover this position in this query."
    result = ObservationsResponse(
        ra_deg=ra,
        dec_deg=dec,
        limit=limit,
        total_count=len(observations),
        truncated=truncated,
        rejected_count=rejected,
        distinct_dates=sorted({obs.date_only for obs in observations}),
        detectors_available=sorted({obs.detector for obs in observations}),
        observations=observations,
        status=status,
        message=message,
        retrieved_at=datetime.now(UTC),
    )
    # Do not retain empty or partial results that could hide newly ingested data.
    if result.status == "success":
        cache.set(
            key, result.model_dump(mode="json"), CACHE_NAMESPACE, CACHE_TTL_SECONDS
        )
    return result
