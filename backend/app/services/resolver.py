"""Resolve real SIMBAD identifiers through TAP, without built-in target records."""

import math
from datetime import UTC, datetime

import astropy.units as u
import pyvo
import requests
from astropy.coordinates import SkyCoord
from pydantic import ValidationError

from app.db.cache import CacheManager
from app.schemas.target import ProperMotion, ResolvedTarget, TargetCoordinates

SIMBAD_URL = "https://simbad.cds.unistra.fr/simbad/sim-tap"
SIMBAD_URLS = (SIMBAD_URL, "https://simbad.cfa.harvard.edu/simbad/sim-tap")
CACHE_NAMESPACE = "simbad:v1"
CACHE_TTL_SECONDS = 86400


class ResolverUnavailable(Exception):
    """The upstream service could not complete a query."""


class InvalidCatalogResponse(Exception):
    """The catalog response is unusable or malformed."""


class AmbiguousTarget(Exception):
    """The name returned more than one distinct object."""


class TimeoutSession(requests.Session):
    def request(self, method, url, **kwargs):
        # Connect/read inactivity limits, not a total wall-clock deadline.
        kwargs["timeout"] = (5, 15)
        return super().request(method, url, **kwargs)


def query_simbad(name: str):
    identifier = name.replace("'", "''")
    query = f"""SELECT TOP 2 b.main_id, b.ra, b.dec, b.otype,
                       b.pmra, b.pmdec, b.coo_bibcode, b.pm_bibcode
                FROM basic AS b JOIN ident AS i ON b.oid = i.oidref
                WHERE i.id = '{identifier}'"""
    last_error = None
    for endpoint in SIMBAD_URLS:
        try:
            with TimeoutSession() as session:
                table = (
                    pyvo.dal.TAPService(endpoint, session=session)
                    .search(query)
                    .to_table()
                )
                table.meta["source_url"] = endpoint
                return table
        except (pyvo.dal.DALAccessError, requests.RequestException, OSError) as error:
            last_error = error
    raise ResolverUnavailable from last_error


def format_coordinates(ra: float, dec: float) -> TargetCoordinates:
    # Validate before SkyCoord can wrap an out-of-range right ascension.
    if not math.isfinite(ra) or not 0 <= ra < 360:
        raise ValueError("Right ascension must be between 0 and 360 degrees")
    if not math.isfinite(dec) or not -90 <= dec <= 90:
        raise ValueError("Declination must be between -90 and 90 degrees")
    coord = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame="icrs")
    return TargetCoordinates(
        ra_deg=ra,
        dec_deg=dec,
        ra_hms=coord.ra.to_string(unit=u.hourangle, sep="hms", precision=3, pad=True),
        dec_dms=coord.dec.to_string(
            unit=u.deg, sep="dms", precision=2, pad=True, alwayssign=True
        ),
    )


def _value(row, column):
    value = row[column]
    return None if value is None or getattr(value, "mask", False) else value


def _text(row, column):
    value = _value(row, column)
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    return str(value).strip() if value is not None else None


def _number(row, column):
    value = _value(row, column)
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def resolve_name(name: str, cache: CacheManager) -> ResolvedTarget | None:
    key = name.casefold()
    cached = cache.get(key, CACHE_NAMESPACE)
    if cached is not None:
        try:
            result = ResolvedTarget.model_validate(cached)
            if result.source_url in SIMBAD_URLS and result.retrieved_at is not None:
                return result.model_copy(update={"query": name, "cached": True})
        except (ValidationError, TypeError):
            pass
    table = query_simbad(name)
    if table is None:
        raise InvalidCatalogResponse
    if len(table) == 0:
        return None
    if len(table) > 1:
        raise AmbiguousTarget
    try:
        row = table[0]
        ra, dec = _number(row, "ra"), _number(row, "dec")
        if ra is None or dec is None or not _text(row, "main_id"):
            raise ValueError("Missing catalog position or identifier")
        pmra, pmdec = _number(row, "pmra"), _number(row, "pmdec")
        proper_motion = None
        if pmra is not None or pmdec is not None:
            proper_motion = ProperMotion(
                pm_ra_mas_yr=pmra,
                pm_dec_mas_yr=pmdec,
                reference=_text(row, "pm_bibcode"),
            )
        result = ResolvedTarget(
            query=name,
            canonical_name=_text(row, "main_id"),
            object_type=_text(row, "otype") or "Astronomical Source",
            coordinates=format_coordinates(ra, dec),
            proper_motion=proper_motion,
            provenance="CDS / SIMBAD via TAP",
            source_url=table.meta.get("source_url", SIMBAD_URL),
            coordinate_reference=_text(row, "coo_bibcode"),
            retrieved_at=datetime.now(UTC),
        )
    except (KeyError, ValueError, TypeError, IndexError) as error:
        raise InvalidCatalogResponse from error
    cache.set(key, result.model_dump(mode="json"), CACHE_NAMESPACE, CACHE_TTL_SECONDS)
    return result
