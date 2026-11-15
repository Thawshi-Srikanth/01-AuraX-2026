"""Persistent example-target metadata fallback and server-side cache warming."""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING

from pydantic import ValidationError

from app.db.cache import CacheManager
from app.schemas.observation import ObservationsResponse
from app.services.cache_policy import DEFAULT_IDLE_SECONDS, DEFAULT_QUOTA_BYTES
from app.services.fits_parser import MAX_FILE_BYTES

if TYPE_CHECKING:
    from app.schemas.comparison_matches import MatchRequest
    from app.services.comparison_candidates import CandidateBatch
    from app.services.fits_download import FitsStore

logger = logging.getLogger(__name__)

FALLBACK_NAMESPACE = "observations:fallback:v1"
DEFAULT_OBSERVATIONS_LIMIT = 100
DEFAULT_CUTOUT_SIZE_DEG = 50 * 6.2 / 3600
EXAMPLE_OBSERVATIONS_PATH = (
    Path(__file__).resolve().parents[1] / "data" / "examples" / "observations.json"
)
FALLBACK_NOTICE = (
    "IRSA is currently unavailable; showing persisted example metadata."
)

# J2025.5 reference sky fields matching frontend/src/data/challengeTargets.ts.
EXAMPLE_TARGETS: tuple[dict[str, object], ...] = (
    {
        "id": "barnard",
        "name": "Barnard's Star",
        "ra": 269.4463796045393,
        "dec": 4.766765193798326,
    },
    {
        "id": "epsilon_indi",
        "name": "Epsilon Indi B",
        "ra": 331.0956582664693,
        "dec": -56.80030697842581,
    },
    {
        "id": "wise0855",
        "name": "WISE 0855",
        "ra": 133.76090262281798,
        "dec": -7.242275827996202,
    },
    {
        "id": "rw_aur",
        "name": "RW Aurigae",
        "ra": 76.95658541124078,
        "dec": 30.401294169708795,
    },
    {
        "id": "r_dra",
        "name": "R Draconis",
        "ra": 248.1672403367638,
        "dec": 66.75502297220227,
    },
)

# Checked Epsilon Indi B comparison cutouts from frontend/src/data/checkedComparison.ts.
CHECKED_COMPARISON_CUTOUTS: tuple[dict[str, object], ...] = (
    {
        "ra": 331.0956582664693,
        "dec": -56.80030697842581,
        "size_deg": DEFAULT_CUTOUT_SIZE_DEG,
        "access_url": (
            "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/"
            "2025W18_2B/l2b-v27-2026-197/3/"
            "level2_2025W18_2B_0011_4D3_spx_l2b-v27-2026-197.fits"
        ),
    },
    {
        "ra": 331.0956582664693,
        "dec": -56.80030697842581,
        "size_deg": DEFAULT_CUTOUT_SIZE_DEG,
        "access_url": (
            "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/"
            "2026W39_1A/l2b-v27-2026-268/3/"
            "level2_2026W39_1A_0276_1D3_spx_l2b-v27-2026-268.fits"
        ),
    },
)


def _ra_diff_deg(a: float, b: float) -> float:
    diff = abs((a % 360.0) - (b % 360.0))
    return min(diff, 360.0 - diff)


def match_example_target(
    ra: float, dec: float, tol_deg: float = 1e-9
) -> dict[str, object] | None:
    if not (math.isfinite(ra) and math.isfinite(dec)):
        return None
    for target in EXAMPLE_TARGETS:
        if (
            _ra_diff_deg(ra, float(target["ra"])) <= tol_deg
            and abs(dec - float(target["dec"])) <= tol_deg
        ):
            return target
    return None


def is_example_position(ra: float, dec: float, tol_deg: float = 1e-9) -> bool:
    return match_example_target(ra, dec, tol_deg=tol_deg) is not None


def _cache_key(ra: float, dec: float, limit: int) -> str:
    return json.dumps([ra, dec, limit], separators=(",", ":"))


@lru_cache(maxsize=4)
def _load_bundled_observations(
    path: Path | None = None,
) -> dict[str, dict[str, object]]:
    resolved = path or EXAMPLE_OBSERVATIONS_PATH
    if not resolved.is_file():
        return {}
    try:
        raw = json.loads(resolved.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        logger.warning("Failed to read bundled example observations from %s", resolved)
        return {}
    if not isinstance(raw, dict):
        return {}
    entries: dict[str, dict[str, object]] = {}
    for key, payload in raw.items():
        if isinstance(key, str) and isinstance(payload, dict):
            entries[key] = payload
    return entries


def _slice_observations_response(
    response: ObservationsResponse, ra: float, dec: float, limit: int
) -> ObservationsResponse:
    sliced = list(response.observations[:limit])
    truncated = response.truncated or len(response.observations) > limit
    message = (
        f"Returned {len(sliced)} image products. {FALLBACK_NOTICE}"
        if sliced
        else f"{response.message} {FALLBACK_NOTICE}"
    )
    return response.model_copy(
        update={
            "ra_deg": ra,
            "dec_deg": dec,
            "limit": limit,
            "total_count": len(sliced),
            "truncated": truncated,
            "distinct_dates": sorted({obs.date_only for obs in sliced}),
            "detectors_available": sorted({obs.detector for obs in sliced}),
            "observations": sliced,
            "cached": True,
            "message": message,
        }
    )


def store_fallback_observations(
    cache: CacheManager, response: ObservationsResponse
) -> bool:
    """Persist an observation query in SQLite without expiry."""
    if response.status != "success" or not response.observations:
        return False
    key = _cache_key(response.ra_deg, response.dec_deg, response.limit)
    return cache.set(
        key,
        response.model_dump(mode="json"),
        FALLBACK_NAMESPACE,
        ttl_seconds=None,
    )


def seed_bundled_observations(
    cache: CacheManager, path: Path | None = None
) -> int:
    """Seed bundled example observation queries into the persistent fallback DB."""
    seeded = 0
    for key, payload in _load_bundled_observations(path).items():
        if cache.get(key, FALLBACK_NAMESPACE) is not None:
            continue
        try:
            validated = ObservationsResponse.model_validate(payload)
        except (ValidationError, TypeError):
            continue
        if validated.status != "success":
            continue
        if cache.set(
            key, validated.model_dump(mode="json"), FALLBACK_NAMESPACE, ttl_seconds=None
        ):
            seeded += 1
    return seeded


def get_fallback_observations(
    ra: float,
    dec: float,
    limit: int,
    cache: CacheManager,
    path: Path | None = None,
) -> ObservationsResponse | None:
    """Return persisted example observations when IRSA is unavailable."""
    candidates: list[tuple[float, float, int]] = [(ra, dec, limit)]
    if limit != DEFAULT_OBSERVATIONS_LIMIT:
        candidates.append((ra, dec, DEFAULT_OBSERVATIONS_LIMIT))
    target = match_example_target(ra, dec)
    if target is not None:
        t_ra, t_dec = float(target["ra"]), float(target["dec"])
        candidates.append((t_ra, t_dec, limit))
        if limit != DEFAULT_OBSERVATIONS_LIMIT:
            candidates.append((t_ra, t_dec, DEFAULT_OBSERVATIONS_LIMIT))

    for c_ra, c_dec, c_limit in candidates:
        if c_limit < limit:
            continue
        cached = cache.get(_cache_key(c_ra, c_dec, c_limit), FALLBACK_NAMESPACE)
        if cached is None:
            continue
        try:
            parsed = ObservationsResponse.model_validate(cached)
            if parsed.status == "success" and parsed.observations:
                return _slice_observations_response(parsed, ra, dec, limit)
        except (ValidationError, TypeError):
            continue

    bundled = _load_bundled_observations(path)
    for c_ra, c_dec, c_limit in candidates:
        if c_limit < limit:
            continue
        payload = bundled.get(_cache_key(c_ra, c_dec, c_limit))
        if payload is None:
            continue
        try:
            parsed = ObservationsResponse.model_validate(payload)
            if parsed.status == "success" and parsed.observations:
                store_fallback_observations(cache, parsed)
                return _slice_observations_response(parsed, ra, dec, limit)
        except (ValidationError, TypeError):
            continue

    return None


def get_fallback_comparison_candidates(
    request: MatchRequest,
    cache: CacheManager | None = None,
    path: Path | None = None,
) -> CandidateBatch | None:
    """Build a bounded comparison CandidateBatch from persisted example metadata."""
    from app.services.comparison_candidates import CandidateBatch

    target = match_example_target(request.ra, request.dec)
    if target is None:
        return None
    t_ra, t_dec = float(target["ra"]), float(target["dec"])
    source: ObservationsResponse | None = None

    if cache is not None:
        source = get_fallback_observations(
            t_ra, t_dec, DEFAULT_OBSERVATIONS_LIMIT, cache, path=path
        )
    if source is None:
        payload = _load_bundled_observations(path).get(
            _cache_key(t_ra, t_dec, DEFAULT_OBSERVATIONS_LIMIT)
        )
        if payload is not None:
            try:
                source = ObservationsResponse.model_validate(payload)
            except (ValidationError, TypeError):
                source = None
    if source is None or not source.observations:
        return None

    filtered = []
    identities: set[tuple[str, str]] = set()
    duplicates = 0
    for obs in source.observations:
        if request.detector and obs.detector != request.detector:
            continue
        obs_date = datetime.strptime(obs.date_only, "%Y-%m-%d").date()
        if request.from_date and obs_date < request.from_date:
            continue
        if request.to_date and obs_date > request.to_date:
            continue
        identity = (obs.obs_id, obs.detector)
        if identity in identities:
            duplicates += 1
            continue
        identities.add(identity)
        filtered.append(obs)

    filtered.sort(key=lambda product: (product.mjd_start, product.artifact_id))
    truncated = len(filtered) > request.candidate_limit or source.truncated
    selected = filtered[: request.candidate_limit]
    return CandidateBatch(
        observations=selected,
        metadata_rows=len(filtered),
        truncated=truncated,
        rejected_count=0,
        duplicate_exposure_count=duplicates,
        retrieved_at=source.retrieved_at or datetime.now(UTC),
        provenance=source.provenance,
        source_url=source.source_url,
        fallback_notice=FALLBACK_NOTICE,
    )


def _select_representative_observations(observations, count: int):
    """Pick up to `count` observations spread across distinct detectors and dates."""
    if count <= 0 or not observations:
        return []
    selected = []
    seen_detectors: set[str] = set()
    seen_ids: set[str] = set()
    for obs in observations:
        if obs.detector not in seen_detectors:
            selected.append(obs)
            seen_detectors.add(obs.detector)
            seen_ids.add(obs.artifact_id)
            if len(selected) >= count:
                return selected
    for obs in observations:
        if obs.artifact_id not in seen_ids:
            selected.append(obs)
            seen_ids.add(obs.artifact_id)
            if len(selected) >= count:
                return selected
    return selected


def warm_example_cache(
    cache: CacheManager,
    fits_store: FitsStore,
    *,
    limit: int = DEFAULT_OBSERVATIONS_LIMIT,
    cutouts_per_target: int = 2,
    save_queries: bool = False,
    queries_path: Path | None = None,
) -> dict[str, int]:
    """Query IRSA and populate the server's persistent DB and FITS cache."""
    from app.services.fits_download import FitsDownloadError
    from app.services.observations import CACHE_NAMESPACE, find_observations

    resolved_queries_path = queries_path or EXAMPLE_OBSERVATIONS_PATH

    stats = {
        "targets_total": len(EXAMPLE_TARGETS),
        "queries_ok": 0,
        "queries_failed": 0,
        "cutouts_ok": 0,
        "cutouts_failed": 0,
    }
    collected_queries: dict[str, dict[str, object]] = dict(
        _load_bundled_observations(resolved_queries_path)
    )
    cutout_requests: list[tuple[str, float, float, float]] = []

    for target in EXAMPLE_TARGETS:
        ra = float(target["ra"])
        dec = float(target["dec"])
        key = _cache_key(ra, dec, limit)
        response: ObservationsResponse | None = None
        try:
            # Query live IRSA if the short-lived cache entry is missing/expired.
            response = find_observations(ra, dec, limit, cache)
            if response.status == "success":
                store_fallback_observations(cache, response)
                collected_queries[key] = response.model_dump(mode="json")
                stats["queries_ok"] += 1
            else:
                stats["queries_failed"] += 1
        except Exception as exc:
            logger.warning("Observation warm failed for %s: %s", target["name"], exc)
            stats["queries_failed"] += 1
            response = get_fallback_observations(
                ra, dec, limit, cache, path=resolved_queries_path
            )

        if response and response.observations:
            for obs in _select_representative_observations(
                response.observations, cutouts_per_target
            ):
                cutout_requests.append(
                    (obs.access_url, ra, dec, DEFAULT_CUTOUT_SIZE_DEG)
                )

    for checked in CHECKED_COMPARISON_CUTOUTS:
        cutout_requests.append(
            (
                str(checked["access_url"]),
                float(checked["ra"]),
                float(checked["dec"]),
                float(checked["size_deg"]),
            )
        )

    seen_cutouts: set[tuple[str, float, float, float]] = set()
    for access_url, ra, dec, size_deg in cutout_requests:
        item = (access_url, ra, dec, size_deg)
        if item in seen_cutouts:
            continue
        seen_cutouts.add(item)
        try:
            retrieved = fits_store.fetch(access_url, ra, dec, size_deg)
            fits_store.pin(access_url, ra, dec, size_deg)
            logger.info(
                "Cached and pinned FITS %s (%d bytes)",
                retrieved.path.name,
                retrieved.size_bytes,
            )
            stats["cutouts_ok"] += 1
        except (FitsDownloadError, OSError, ValueError) as exc:
            logger.warning("FITS warm failed for %s: %s", access_url, exc)
            stats["cutouts_failed"] += 1

    if save_queries and collected_queries:
        resolved_queries_path.parent.mkdir(parents=True, exist_ok=True)
        resolved_queries_path.write_text(
            json.dumps(collected_queries, indent=2) + "\n", encoding="utf-8"
        )
        _load_bundled_observations.cache_clear()

    # Keep short-lived cache namespace consistent if needed.
    _ = CACHE_NAMESPACE
    return stats


def _default_db_path() -> Path:
    return Path(
        os.getenv(
            "CACHE_DB_PATH",
            str(Path(__file__).resolve().parents[2] / "cache" / "aurax.db"),
        )
    )


def _default_fits_dir(db_path: Path) -> Path:
    return Path(os.getenv("FITS_CACHE_DIR", str(db_path.parent / "fits")))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Warm the persistent server DB and FITS cache for example targets."
    )
    parser.add_argument("--db", type=Path, default=None, help="Path to aurax.db")
    parser.add_argument(
        "--fits-dir", type=Path, default=None, help="Path to FITS cache directory"
    )
    parser.add_argument(
        "--cutouts-per-target",
        type=int,
        default=2,
        help="Representative FITS cutouts to cache per example target (default: 2)",
    )
    parser.add_argument(
        "--save-queries",
        action="store_true",
        help="Write observation query JSON to app/data/examples/observations.json",
    )
    args = parser.parse_args(argv)

    from app.services.fits_download import FitsStore

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    db_path = args.db or _default_db_path()
    fits_dir = args.fits_dir or _default_fits_dir(db_path)

    cache = CacheManager(db_path)
    fits_store = FitsStore(
        fits_dir,
        max_bytes=int(os.getenv("FITS_CACHE_MAX_FILE_BYTES", str(MAX_FILE_BYTES))),
        quota_bytes=int(os.getenv("FITS_CACHE_MAX_BYTES", str(DEFAULT_QUOTA_BYTES))),
        idle_seconds=int(
            os.getenv("FITS_CACHE_MAX_IDLE_SECONDS", str(DEFAULT_IDLE_SECONDS))
        ),
    )
    stats = warm_example_cache(
        cache,
        fits_store,
        cutouts_per_target=args.cutouts_per_target,
        save_queries=args.save_queries,
    )
    print(json.dumps(stats, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
