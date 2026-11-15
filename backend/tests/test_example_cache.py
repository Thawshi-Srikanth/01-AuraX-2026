import json
import os
import time
from datetime import date

import numpy as np
import pytest
from astropy.io import fits
from astropy.table import Table
from fastapi.testclient import TestClient

from app.db.cache import CacheManager
from app.main import create_app
from app.schemas.comparison_matches import MatchRequest
from app.services.cache_policy import PINNED_NAME, FitsCachePolicy
from app.services.comparison_candidates import query_candidates
from app.services.example_cache import (
    DEFAULT_CUTOUT_SIZE_DEG,
    EXAMPLE_TARGETS,
    FALLBACK_NAMESPACE,
    seed_bundled_observations,
    warm_example_cache,
)
from app.services.fits_download import FitsStore
from app.services.observations import ArchiveUnavailable, find_observations


def _make_sample_fits(path, ra: float, dec: float) -> bytes:
    """Create a minimal valid SPHEREx-like FITS file covering (ra, dec)."""
    primary = fits.PrimaryHDU()
    image = np.ones((16, 16), dtype=np.float32)
    hdu = fits.ImageHDU(data=image, name="IMAGE")
    hdu.header["CTYPE1"] = "RA---TAN"
    hdu.header["CTYPE2"] = "DEC--TAN"
    hdu.header["CRVAL1"] = ra
    hdu.header["CRVAL2"] = dec
    hdu.header["CRPIX1"] = 8.5
    hdu.header["CRPIX2"] = 8.5
    hdu.header["CDELT1"] = -6.2 / 3600.0
    hdu.header["CDELT2"] = 6.2 / 3600.0
    hdu.header["CUNIT1"] = "deg"
    hdu.header["CUNIT2"] = "deg"
    hdu.header["DETECTOR"] = 3
    hdu.header["OBSID"] = "2025W18_2B_0011_4"
    variance = fits.ImageHDU(data=np.ones((16, 16), dtype=np.float32), name="VARIANCE")
    flags = fits.ImageHDU(data=np.zeros((16, 16), dtype=np.int16), name="FLAGS")
    wave = fits.ImageHDU(
        data=np.ones((16, 16), dtype=np.float32) * 2.0, name="WCS-WAVE"
    )
    hdul = fits.HDUList([primary, hdu, variance, flags, wave])
    hdul.writeto(path, overwrite=True)
    return path.read_bytes()


def _sample_irsa_table(count: int = 3) -> Table:
    rows = []
    for idx in range(count):
        det = (idx % 3) + 1
        obs_id = f"2025W18_2B_001{idx}_1"
        uri = (
            f"https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/"
            f"2025W18_2B/l2b-v27-2026-197/{det}/"
            f"level2_{obs_id}D{det}_spx_l2b-v27-2026-197.fits"
        )
        rows.append(
            {
                "time_bounds_lower": 60796.5 + idx * 10.0,
                "time_exposure": 113.5,
                "energy_bandpassname": f"SPHEREx-D{det}",
                "energy_bounds_lower": 1.6e-6,
                "energy_bounds_upper": 2.4e-6,
                "uri": uri,
                "artifactid": uri,
            }
        )
    return Table(rows=rows)


def test_pinned_fits_survive_idle_expiry_and_lru_eviction(tmp_path):
    fits_dir = tmp_path / "fits"
    policy = FitsCachePolicy(fits_dir, quota_bytes=300, idle_seconds=60)
    pinned = fits_dir / ("a" * 64 + ".fits")
    unpinned = fits_dir / ("b" * 64 + ".fits")
    fits_dir.mkdir()
    pinned.write_bytes(b"x" * 150)
    unpinned.write_bytes(b"y" * 150)

    policy.pin_persistent(pinned)
    assert (fits_dir / PINNED_NAME).is_file()

    old = time.time() - 3600
    os.utime(pinned, (old, old))
    os.utime(unpinned, (old, old))

    result = policy.cleanup(required_bytes=100)
    assert pinned.exists()
    assert not unpinned.exists()
    assert result["removed_files"] == 1


def test_observations_live_updates_fallback_and_falls_back_when_irsa_down(
    monkeypatch, tmp_path
):
    cache = CacheManager(tmp_path / "aurax.db")
    target = EXAMPLE_TARGETS[0]
    ra, dec = float(target["ra"]), float(target["dec"])

    monkeypatch.setattr(
        "app.services.observations.query_archive",
        lambda r, d, lim: _sample_irsa_table(4),
    )
    live = find_observations(ra, dec, 100, cache)
    assert live.status == "success"
    assert live.total_count == 4
    assert not live.cached

    # Expire the short-lived cache, and simulate IRSA going down.
    cache.delete(json.dumps([ra, dec, 100], separators=(",", ":")), "observations:v1")

    def fail_archive(*_args, **_kwargs):
        raise ArchiveUnavailable("IRSA down")

    monkeypatch.setattr("app.services.observations.query_archive", fail_archive)

    fallback = find_observations(ra, dec, 100, cache)
    assert fallback.status == "success"
    assert fallback.cached is True
    assert fallback.total_count == 4
    assert "IRSA is currently unavailable" in fallback.message

    # Smaller limits (e.g. spectrum) slice from the persisted 100-limit entry.
    sliced = find_observations(ra, dec, 2, cache)
    assert sliced.total_count == 2
    assert sliced.truncated is True

    # Non-example coordinates still fail cleanly when IRSA is down.
    with pytest.raises(ArchiveUnavailable):
        find_observations(10.0, 20.0, 100, cache)


def test_comparison_candidates_fall_back_when_irsa_down(monkeypatch, tmp_path):
    cache = CacheManager(tmp_path / "aurax.db")
    target = EXAMPLE_TARGETS[0]
    ra, dec = float(target["ra"]), float(target["dec"])

    monkeypatch.setattr(
        "app.services.observations.query_archive",
        lambda r, d, lim: _sample_irsa_table(3),
    )
    find_observations(ra, dec, 100, cache)

    monkeypatch.setattr(
        "app.services.comparison_candidates.query_window",
        lambda req: (_ for _ in ()).throw(ArchiveUnavailable("IRSA down")),
    )
    req = MatchRequest(
        ra=ra,
        dec=dec,
        detector="D2",
        from_date=date(2025, 1, 1),
        to_date=date(2026, 1, 1),
    )
    batch = query_candidates(req, cache=cache)
    assert len(batch.observations) == 1
    assert batch.observations[0].detector == "D2"
    assert batch.fallback_notice is not None


def test_warm_example_cache_populates_db_and_pins_fits(monkeypatch, tmp_path):
    db_path = tmp_path / "aurax.db"
    fits_dir = tmp_path / "fits"
    queries_path = tmp_path / "observations.json"
    cache = CacheManager(db_path)
    store = FitsStore(fits_dir)

    monkeypatch.setattr(
        "app.services.observations.query_archive",
        lambda r, d, lim: _sample_irsa_table(2),
    )

    sample_path = tmp_path / "sample.fits"

    def fake_fetch(self, access_url, ra, dec, size_deg=DEFAULT_CUTOUT_SIZE_DEG):
        from hashlib import sha256

        from app.services.fits_download import RetrievedFits, cutout_url

        req_url = cutout_url(access_url, ra, dec, size_deg)
        key = sha256(req_url.encode()).hexdigest()
        dest = self.directory / f"{key}.fits"
        self.policy._ensure_owned(create=True)
        payload = _make_sample_fits(sample_path, ra, dec)
        dest.write_bytes(payload)
        return RetrievedFits(dest, req_url, False, len(payload))

    monkeypatch.setattr(FitsStore, "fetch", fake_fetch)

    stats = warm_example_cache(
        cache,
        store,
        cutouts_per_target=1,
        save_queries=True,
        queries_path=queries_path,
    )
    assert stats["queries_ok"] == len(EXAMPLE_TARGETS)
    assert stats["cutouts_ok"] > 0
    assert queries_path.is_file()

    # Persisted fallback survives purge_expired().
    assert cache.purge_expired() == 0
    target0 = EXAMPLE_TARGETS[0]
    key0 = json.dumps([target0["ra"], target0["dec"], 100], separators=(",", ":"))
    assert cache.get(key0, FALLBACK_NAMESPACE) is not None

    # Pinned FITS files survive cleanup().
    assert (fits_dir / PINNED_NAME).is_file()
    cleanup = store.cleanup()
    assert cleanup["removed_files"] == 0


def test_seed_bundled_observations_on_startup(monkeypatch, tmp_path):
    db_path = tmp_path / "aurax.db"
    queries_path = tmp_path / "observations.json"
    target0 = EXAMPLE_TARGETS[0]
    ra, dec = float(target0["ra"]), float(target0["dec"])

    # Prepare a valid bundled observations.json without any network calls.
    seed_cache = CacheManager(tmp_path / "prep.db")
    monkeypatch.setattr(
        "app.services.observations.query_archive",
        lambda r, d, lim: _sample_irsa_table(2),
    )
    resp = find_observations(ra, dec, 100, seed_cache)
    key = json.dumps([ra, dec, 100], separators=(",", ":"))
    queries_path.write_text(
        json.dumps({key: resp.model_dump(mode="json")}), encoding="utf-8"
    )

    monkeypatch.setattr(
        "app.services.example_cache.EXAMPLE_OBSERVATIONS_PATH", queries_path
    )
    from app.services.example_cache import _load_bundled_observations

    _load_bundled_observations.cache_clear()

    monkeypatch.setenv("CACHE_DB_PATH", str(db_path))
    monkeypatch.setenv("FITS_CACHE_DIR", str(tmp_path / "fits"))
    app = create_app()
    with TestClient(app):
        assert app.state.cache.get(key, FALLBACK_NAMESPACE) is not None
        assert seed_bundled_observations(app.state.cache, queries_path) == 0

