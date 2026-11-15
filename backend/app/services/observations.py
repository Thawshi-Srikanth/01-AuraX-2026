"""Bounded, metadata-only observation searches against IRSA's current tables."""

import json
import math
import re
from datetime import UTC, datetime
from urllib.parse import urlsplit

import astropy.units as u
import pyvo
import requests
from astropy.table import Table
from astropy.time import Time
from pydantic import ValidationError
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from app.db.cache import CacheManager
from app.schemas.observation import ObservationsResponse, SPHERExObservation
from app.services.example_cache import (
    get_fallback_observations,
    is_example_position,
    store_fallback_observations,
)

IRSA_TAP_URL = "https://irsa.ipac.caltech.edu/TAP"
IRSA_SIA_URL = "https://irsa.ipac.caltech.edu/SIA"
SIA_NOTICE = (
    "TAP was unavailable; results are from IRSA SIA. "
    "Newly ingested data may lag by about a day. "
    "Results are an archive-selected subset, sorted locally by observation time."
)
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


class SiaSession(IrsaSession):
    """Allow one retry for transient errors seen on IRSA's SIA proxy."""

    def __init__(self):
        super().__init__()
        self.mount(
            IRSA_SIA_URL,
            HTTPAdapter(
                max_retries=Retry(
                    total=1,
                    connect=0,
                    read=0,
                    status=1,
                    status_forcelist=(502, 503, 504),
                    allowed_methods={"GET"},
                    respect_retry_after_header=False,
                )
            ),
        )


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
    except (pyvo.dal.DALAccessError, requests.RequestException, OSError):
        return query_sia(ra, dec, limit)


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


def query_sia(ra, dec, limit, *, detector=None, start=None, end=None):
    """Query real Level 2 products without contacting TAP or capabilities endpoints."""
    options = {}
    if start is not None or end is not None:
        # SIA accepts MJD intervals. PyVO's lowercase time converter expects
        # Astropy Time objects, so pass the protocol value explicitly.
        lower = "-Inf" if start is None else repr(start)
        upper = "+Inf" if end is None else repr(end)
        options["TIME"] = f"{lower} {upper}"
    try:
        with SiaSession() as session:
            results = pyvo.dal.SIA2Service(
                IRSA_SIA_URL, session=session, check_baseurl=False
            ).search(
                # IRSA supports zero-radius circles; PyVO's pos validator does not.
                POS=f"CIRCLE {ra} {dec} 0",
                collection=[
                    "spherex_dr1",
                    "spherex_qr3",
                    "spherex_dr1_deep",
                    "spherex_qr3_deep",
                ],
                data_type="image",
                calib_level=2,
                maxrec=limit + 1,
                **options,
            )
            raw = results.to_table()
            overflow = results.status[0] == "OVERFLOW"
    except (pyvo.dal.DALAccessError, requests.RequestException, OSError) as error:
        raise ArchiveUnavailable from error
    mapping = {
        "time_bounds_lower": "t_min",
        "time_exposure": "t_exptime",
        "energy_bandpassname": "energy_bandpassname",
        "energy_bounds_lower": "em_min",
        "energy_bounds_upper": "em_max",
        "uri": "access_url",
        "artifactid": "access_url",
    }
    if raw is None or not set(mapping.values()).issubset(raw.colnames):
        raise InvalidArchiveResponse
    rows = []
    for row in raw[: limit + 1]:
        if detector and _text(row, "energy_bandpassname") != "SPHEREx-" + detector:
            continue
        # SIA TIME matches overlapping exposures; the app filters start times.
        try:
            mjd = _number(row, "t_min")
            if (start is not None and mjd < start) or (end is not None and mjd >= end):
                continue
        except (ValueError, TypeError):
            pass  # Retain malformed rows for the existing rejection accounting.
        rows.append(tuple(_value(row, column) for column in mapping.values()))
    table = Table(rows=rows, names=list(mapping), dtype=[object] * len(mapping))

    # Keep bad timestamps visible to the normal parser, after usable rows.
    def order(row):
        try:
            return _number(row, "time_bounds_lower"), str(row["uri"])
        except (ValueError, TypeError):
            return float("inf"), str(row["uri"])

    table = table[sorted(range(len(table)), key=lambda i: order(table[i]))]
    table.meta.update(
        overflow=overflow or len(raw) > limit,
        source_url=IRSA_SIA_URL,
        provenance="NASA/IPAC IRSA SIA: SPHEREx Level 2",
        fallback_notice=SIA_NOTICE,
    )
    return table


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
    required_columns = {
        "time_bounds_lower",
        "time_exposure",
        "energy_bandpassname",
        "energy_bounds_lower",
        "energy_bounds_upper",
        "uri",
        "artifactid",
    }
    try:
        table = query_archive(ra, dec, limit)
        if table is None or not required_columns.issubset(table.colnames):
            raise InvalidArchiveResponse
    except (
        ArchiveUnavailable,
        InvalidArchiveResponse,
        pyvo.dal.DALAccessError,
        requests.RequestException,
        OSError,
    ):
        fallback = get_fallback_observations(ra, dec, limit, cache)
        if fallback is not None:
            return fallback
        raise
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
        message=message
        + (
            " " + table.meta["fallback_notice"]
            if table.meta.get("fallback_notice")
            else ""
        ),
        **{
            key: table.meta[key]
            for key in ("source_url", "provenance")
            if key in table.meta
        },
        retrieved_at=datetime.now(UTC),
    )
    # Do not retain empty or partial results that could hide newly ingested data.
    if result.status == "success":
        cache.set(
            key, result.model_dump(mode="json"), CACHE_NAMESPACE, CACHE_TTL_SECONDS
        )
        if is_example_position(ra, dec):
            store_fallback_observations(cache, result)
    return result
