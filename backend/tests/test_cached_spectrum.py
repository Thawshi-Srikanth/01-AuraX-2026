"""Cached sampling is local only; explicit synthetic MEFs are test fixtures."""

import hashlib
from unittest.mock import Mock

import pytest
from astropy.io import fits
from fastapi.testclient import TestClient

from app.main import create_app
from app.services.fits_download import cutout_url
from app.services.fits_parser import open_observation

URL = "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/synthetic/v1/1/level2_synthetic0D1_spx_v1.fits"
BODY = dict(access_url=URL, center_ra=100, center_dec=20, size_deg=0.03, ra=100, dec=20)


@pytest.fixture
def cached_client(mef):
    with TestClient(create_app()) as client:
        store = client.app.state.fits_store
        directory = store.directory
        directory.mkdir(parents=True, exist_ok=True)
        key = hashlib.sha256(cutout_url(URL, 100.0, 20.0, 0.03).encode()).hexdigest()
        path = directory / f"{key}.fits"
        path.write_bytes(mef.read_bytes())
        store.fetch = Mock(
            side_effect=AssertionError("Cached sampling must not download")
        )
        yield client, path


def test_reuses_display_file_with_full_wcs_variance_and_local_wavelength(cached_client):
    client, path = cached_client
    with open_observation(path) as data:
        sky = data.spatial_wcs.pixel_to_world(5, 9)
    response = client.post(
        "/api/spectrum/cached", json={**BODY, "ra": sky.ra.deg, "dec": sky.dec.deg}
    )
    assert response.status_code == 200
    sample = response.json()["sample"]
    assert sample["pixel_x"] == 5 and sample["pixel_y"] == 9
    assert sample["flux_mjy_sr"] == pytest.approx(149)
    assert sample["flux_error_mjy_sr"] == pytest.approx(0.5)
    assert sample["wavelength_um"] == pytest.approx(1.234567)
    assert sample["sample_offset_arcsec"] < 1e-5
    client.app.state.fits_store.fetch.assert_not_called()


def test_cached_miss_does_not_start_network_work(cached_client):
    client, _ = cached_client
    response = client.post("/api/spectrum/cached", json={**BODY, "size_deg": 0.04})
    assert response.status_code == 409
    client.app.state.fits_store.fetch.assert_not_called()


def test_masked_pixel_is_not_a_zero_or_a_sample(cached_client):
    client, path = cached_client
    with open_observation(path) as data:
        sky = data.spatial_wcs.pixel_to_world(0, 0)
    response = client.post(
        "/api/spectrum/cached", json={**BODY, "ra": sky.ra.deg, "dec": sky.dec.deg}
    )
    assert response.status_code == 200
    assert response.json()["sample"] is None
    assert response.json()["status"] == "no_usable_data"


def test_outside_position_fails_without_network(cached_client):
    client, _ = cached_client
    assert (
        client.post("/api/spectrum/cached", json={**BODY, "ra": 101}).status_code == 422
    )
    client.app.state.fits_store.fetch.assert_not_called()


def test_uses_selected_pixel_wavelength_not_image_center(cached_client):
    client, path = cached_client
    with fits.open(path, mode="update", memmap=False) as hdus:
        hdus["WCS-WAVE"].data["VALUES"][..., 0] = [[1.0, 1.6], [1.0, 1.6]]
    with open_observation(path) as data:
        sky = data.spatial_wcs.pixel_to_world(5, 9)
        expected = data.wavelength_at(5, 9)[0]
    response = client.post(
        "/api/spectrum/cached", json={**BODY, "ra": sky.ra.deg, "dec": sky.dec.deg}
    )
    assert response.json()["sample"]["wavelength_um"] == pytest.approx(expected)


@pytest.mark.parametrize(
    "change",
    [
        {"access_url": "https://example.com/a.fits"},
        {"size_deg": 0.6},
        {"ra": 360},
        {"dec": 91},
        {"unexpected": 1},
    ],
)
def test_invalid_request_is_rejected(cached_client, change):
    client, _ = cached_client
    assert client.post("/api/spectrum/cached", json={**BODY, **change}).status_code in (
        400,
        422,
    )
    client.app.state.fits_store.fetch.assert_not_called()


def test_cached_sample_does_not_wait_for_download_writer(cached_client):
    from concurrent.futures import ThreadPoolExecutor

    client, _ = cached_client
    # A slow network download owns this writer lock. Cached reads must bypass it.
    with ThreadPoolExecutor(max_workers=1) as pool:
        with client.app.state.fits_store.policy.state.writer:
            future = pool.submit(client.post, "/api/spectrum/cached", json=BODY)
            response = future.result(timeout=2)
    assert response.status_code == 200
    client.app.state.fits_store.fetch.assert_not_called()
