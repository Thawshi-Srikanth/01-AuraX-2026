"""Bounded live SIMBAD cone search, with spherical separation and provenance."""

import hashlib
import json
import math
from datetime import UTC, datetime

import astropy.units as u
import pyvo
import requests
from astropy.coordinates import SkyCoord
from pydantic import ValidationError

from app.db.cache import CacheManager
from app.schemas.catalog import (
    CatalogSource,
    CatalogSourcesResponse,
    SharedCatalogPosition,
)
from app.schemas.target import ProperMotion
from app.services.resolver import SIMBAD_URLS, TimeoutSession

CACHE_NAMESPACE = "catalog:v2"
CACHE_TTL_SECONDS = 21600
REQUIRED_COLUMNS = {
    "main_id",
    "ra",
    "dec",
    "otype",
    "object_type_label",
    "pmra",
    "pmdec",
    "coo_bibcode",
    "pm_bibcode",
}


class CatalogUnavailable(Exception):
    """No configured SIMBAD endpoint completed the catalog query."""


class InvalidCatalogData(Exception):
    """An archive response lacks a usable catalog schema."""


def query_catalog(ra: float, dec: float, radius_arcmin: float, limit: int):
    bound = limit + 1
    radius_deg = radius_arcmin / 60
    query = f"""SELECT TOP {bound}
        b.main_id, b.ra, b.dec, b.otype, b.pmra, b.pmdec,
        b.coo_bibcode, b.pm_bibcode, t.description AS object_type_label,
        DISTANCE(POINT('ICRS', b.ra, b.dec),
                 POINT('ICRS', {ra!r}, {dec!r})) AS separation_deg
        FROM basic AS b
        LEFT JOIN otypedef AS t ON b.otype = t.otype
        WHERE 1 = CONTAINS(
            POINT('ICRS', b.ra, b.dec), CIRCLE('ICRS', {ra!r}, {dec!r}, {radius_deg!r})
        )
        ORDER BY separation_deg ASC, main_id ASC"""
    last_error = None
    for endpoint in SIMBAD_URLS:
        try:
            with TimeoutSession() as session:
                results = pyvo.dal.TAPService(endpoint, session=session).search(
                    query, maxrec=bound
                )
                table = results.to_table()
                table.meta["source_url"] = endpoint
                table.meta["overflow"] = results.query_status == "OVERFLOW"
                return table
        except (pyvo.dal.DALAccessError, requests.RequestException, OSError) as error:
            last_error = error
    raise CatalogUnavailable from last_error


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


def _source(row, center, radius_arcmin):
    ra, dec = _number(row, "ra"), _number(row, "dec")
    if ra is None or dec is None or not (0 <= ra < 360 and -90 <= dec <= 90):
        raise ValueError("Missing or invalid catalog coordinates")
    sky = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame="icrs")
    distance = float(center.separation(sky).arcsec)
    if distance > radius_arcmin * 60 + 1e-7:
        raise ValueError("Catalog row lies outside the requested cone")
    pmra, pmdec = _number(row, "pmra"), _number(row, "pmdec")
    motion = None
    if pmra is not None or pmdec is not None:
        motion = ProperMotion(
            pm_ra_mas_yr=pmra,
            pm_dec_mas_yr=pmdec,
            reference=_text(row, "pm_bibcode"),
        )
    identifier = _text(row, "main_id")
    return CatalogSource(
        id=identifier,
        name=identifier,
        object_type=_text(row, "otype") or "Astronomical Source",
        object_type_label=_text(row, "object_type_label") or None,
        ra_deg=ra,
        dec_deg=dec,
        distance_arcsec=distance,
        coordinate_reference=_text(row, "coo_bibcode"),
        proper_motion=motion,
    )


def group_reported_positions(sources):
    """Group exact reported positions without inferring a physical relationship."""
    positions = {}
    for source in sources:
        source.position_group_id = None
        # Normalize signed zero, preserving every other reported coordinate bit.
        key = (source.ra_deg or 0.0, source.dec_deg or 0.0)
        positions.setdefault(key, []).append(source)
    shared = []
    for (ra, dec), members in sorted(positions.items()):
        if len(members) < 2:
            continue
        identity = json.dumps([ra, dec], separators=(",", ":"))
        group_id = "position_" + hashlib.sha256(identity.encode()).hexdigest()
        for member in members:
            member.position_group_id = group_id
        shared.append(
            SharedCatalogPosition(
                id=group_id,
                ra_deg=ra,
                dec_deg=dec,
                member_ids=sorted(member.id for member in members),
                records_count=len(members),
            )
        )
    return len(positions), shared


def find_catalog_sources(
    ra: float, dec: float, radius_arcmin: float, limit: int, cache: CacheManager
) -> CatalogSourcesResponse:
    if not (math.isfinite(ra) and 0 <= ra < 360):
        raise ValueError("Invalid right ascension")
    if not (math.isfinite(dec) and -90 <= dec <= 90):
        raise ValueError("Invalid declination")
    if not (
        math.isfinite(radius_arcmin) and 0 < radius_arcmin <= 30 and 1 <= limit <= 200
    ):
        raise ValueError("Invalid search radius or limit")
    key = json.dumps([ra, dec, radius_arcmin, limit], separators=(",", ":"))
    cached = cache.get(key, CACHE_NAMESPACE)
    if cached is not None:
        try:
            result = CatalogSourcesResponse.model_validate(cached)
            scope = (
                result.target_ra,
                result.target_dec,
                result.radius_arcmin,
                result.limit,
            )
            if (
                scope == (ra, dec, radius_arcmin, limit)
                and result.source_url in SIMBAD_URLS
            ):
                return result.model_copy(update={"cached": True})
        except (ValidationError, TypeError):
            pass
    table = query_catalog(ra, dec, radius_arcmin, limit)
    if table is None or not REQUIRED_COLUMNS.issubset(table.colnames):
        raise InvalidCatalogData
    endpoint = table.meta.get("source_url")
    if endpoint not in SIMBAD_URLS:
        raise InvalidCatalogData
    center = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame="icrs")
    sources, identities, rejected = [], set(), 0
    for row in table[:limit]:
        try:
            source = _source(row, center, radius_arcmin)
            if source.id in identities:
                raise ValueError("Duplicate catalog identifier")
            identities.add(source.id)
            sources.append(source)
        except (ValueError, TypeError, KeyError, IndexError):
            rejected += 1
    sources.sort(key=lambda source: (source.distance_arcsec, source.id))
    distinct_positions, shared_groups = group_reported_positions(sources)
    truncated = len(table) > limit or bool(table.meta.get("overflow", False))
    if rejected or (not sources and truncated):
        status, message = "partial", "Some catalog records could not be used."
    elif sources:
        status = "success"
        position_word = "position" if distinct_positions == 1 else "positions"
        message = (
            f"Returned {len(sources)} catalog records at "
            f"{distinct_positions} distinct reported {position_word}."
        )
        if truncated:
            message += " More records exist; this is a limited subset."
    else:
        status = "no_sources"
        message = "SIMBAD returned no catalog records in this cone."
    result = CatalogSourcesResponse(
        target_ra=ra,
        target_dec=dec,
        radius_arcmin=radius_arcmin,
        limit=limit,
        sources_count=len(sources),
        sources=sources,
        distinct_positions_count=distinct_positions,
        shared_position_groups=shared_groups,
        truncated=truncated,
        rejected_count=rejected,
        status=status,
        message=message,
        source_url=endpoint,
        retrieved_at=datetime.now(UTC),
    )
    if result.status == "success":
        cache.set(
            key, result.model_dump(mode="json"), CACHE_NAMESPACE, CACHE_TTL_SECONDS
        )
    return result
