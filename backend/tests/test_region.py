"""Region science uses explicit synthetic MEFs, never invented mission data."""

import hashlib
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock

import numpy as np
import pytest
from astropy.io import fits
from fastapi.testclient import TestClient
from photutils.aperture import CircularAnnulus, CircularAperture

from app.main import create_app
from app.services.fits_download import cutout_url
from app.services.fits_parser import open_observation
from app.services.region import pixel_solid_angles

URL = "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/synthetic/v1/1/level2_synthetic0D1_spx_v1.fits"
BODY = dict(
    access_url=URL, center_ra=100.0, center_dec=20.0, size_deg=0.03, ra=100.0, dec=20.0
)


@pytest.fixture
def region_client(mef):
    with TestClient(create_app()) as client:
        store = client.app.state.fits_store
        store.directory.mkdir(parents=True, exist_ok=True)
        key = hashlib.sha256(cutout_url(URL, 100.0, 20.0, 0.03).encode()).hexdigest()
        path = store.directory / f"{key}.fits"
        path.write_bytes(mef.read_bytes())
        with fits.open(path, mode="update", memmap=False) as hdus:
            hdus["IMAGE"].data[:] = 10
            hdus["FLAGS"].data[:] = 0
        store.fetch = Mock(side_effect=AssertionError("Region must not download"))
        yield client, path


def test_flat_background_has_zero_excess(region_client):
    client, _ = region_client
    response = client.post("/api/region", json=BODY)
    assert response.status_code == 200
    data = response.json()
    m = data["measurements"]
    assert data["status"] == "success"
    assert m["mean_brightness_mjy_sr"] == pytest.approx(10)
    assert m["background_mjy_sr"] == pytest.approx(10)
    assert m["usable_aperture_flux_mjy"] == pytest.approx(0, abs=1e-10)
    assert abs(m["snr"]) < 1e-8
    assert m["flux_error_mjy"] > 0
    client.app.state.fits_store.fetch.assert_not_called()


def test_flux_pixel_area_and_background_uncertainty(region_client):
    client, path = region_client
    with fits.open(path, mode="update", memmap=False) as hdus:
        hdus["IMAGE"].data[7, 7] += 100
    data = client.post("/api/region", json=BODY).json()
    with open_observation(path) as observation:
        x, y = observation.target_pixel(100, 20)
        yy, xx = np.indices((16, 16))
        omega = pixel_solid_angles(observation.spatial_wcs, xx, yy)
        wa = CircularAperture((x, y), 3).to_mask(method="exact").to_image((16, 16))
        wb = CircularAnnulus((x, y), 5, 8).to_mask(method="exact").to_image((16, 16))
        expected_error = (
            np.sqrt(
                0.25
                * (
                    np.sum((wa * omega) ** 2)
                    + (wa * omega).sum() ** 2 * np.sum((wb / wb.sum()) ** 2)
                )
            )
            * 1e9
        )
    m = data["measurements"]
    assert m["usable_aperture_flux_mjy"] == pytest.approx(
        100 * omega[7, 7] * 1e9, rel=1e-6
    )
    assert m["flux_error_mjy"] == pytest.approx(expected_error, rel=1e-6)
    assert m["snr"] > 5
    assert "unverified" in data["summary"]
    assert m["solid_angle_sr"] == pytest.approx(float(np.sum(wa * omega)), rel=1e-6)


def test_full_sip_pixel_areas_and_ra_wrap(mef):
    with open_observation(mef) as data:
        wcs = data.spatial_wcs
        areas = pixel_solid_angles(wcs, np.array([1.0, 14.0]), np.array([1.0, 14.0]))
        assert np.allclose(areas, np.deg2rad(0.001) ** 2, rtol=0.01, atol=0)
        assert not np.isclose(areas[0], areas[1], rtol=1e-5, atol=0)
        wcs.wcs.crval[0] = 359.999
        wrapped = pixel_solid_angles(wcs, np.array([1.0, 14.0]), np.array([1.0, 14.0]))
        assert np.allclose(wrapped, areas, rtol=1e-5, atol=0)


def test_masked_region_does_not_return_zero_measurements(region_client):
    client, path = region_client
    with fits.open(path, mode="update", memmap=False) as hdus:
        hdus["FLAGS"].data[4:12, 4:12] = 1
    data = client.post("/api/region", json=BODY).json()
    assert data["status"] == "insufficient_data"
    assert data["measurements"] is None
    assert data["masked_pixels"] > 0


def test_small_mask_reports_partial_usable_flux(region_client):
    client, path = region_client
    with fits.open(path, mode="update", memmap=False) as hdus:
        hdus["FLAGS"].data[7, 7] = 1
    data = client.post("/api/region", json=BODY).json()
    assert data["status"] == "partial"
    assert data["measurements"] is not None
    assert 0.8 < data["aperture_coverage"] < 1


def test_edge_region_lacks_background_coverage(region_client):
    client, path = region_client
    with open_observation(path) as data:
        sky = data.spatial_wcs.pixel_to_world(1, 1)
    result = client.post(
        "/api/region", json={**BODY, "ra": sky.ra.deg, "dec": sky.dec.deg}
    ).json()
    assert result["status"] == "insufficient_data"
    assert result["measurements"] is None


def test_background_clips_an_isolated_bright_neighbor(region_client):
    client, path = region_client
    with fits.open(path, mode="update", memmap=False) as hdus:
        hdus["IMAGE"].data[2, 7] = 10000
    data = client.post("/api/region", json=BODY).json()
    assert data["background_clipped_pixels"] >= 1
    assert data["measurements"]["background_mjy_sr"] == pytest.approx(10)


def test_negative_excess_is_not_an_absorption_claim(region_client):
    client, path = region_client
    with fits.open(path, mode="update", memmap=False) as hdus:
        hdus["IMAGE"].data[7, 7] -= 100
    data = client.post("/api/region", json=BODY).json()
    assert data["measurements"]["snr"] < -5
    assert "does not establish absorption" in data["summary"]


def test_cached_miss_and_busy_writer_never_download(region_client):
    client, _ = region_client
    assert (
        client.post("/api/region", json={**BODY, "size_deg": 0.04}).status_code == 409
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        with client.app.state.fits_store.policy.state.writer:
            response = pool.submit(client.post, "/api/region", json=BODY).result(
                timeout=3
            )
    assert response.status_code == 200
    client.app.state.fits_store.fetch.assert_not_called()


@pytest.mark.parametrize(
    "change",
    [
        {"ra": 360},
        {"dec": 91},
        {"radius_px": 7},
        {"size_deg": 0.6},
        {"extra": 1},
        {"access_url": "https://example.test/file.fits"},
    ],
)
def test_invalid_region_requests_are_rejected(region_client, change):
    client, _ = region_client
    assert client.post("/api/region", json={**BODY, **change}).status_code in [400, 422]
    client.app.state.fits_store.fetch.assert_not_called()


def test_different_local_passbands_cannot_form_a_region_excess(region_client):
    client, path = region_client
    with fits.open(path, mode="update", memmap=False) as hdus:
        hdus["WCS-WAVE"].data["VALUES"][..., 0] = [[1.0, 1.6], [1.0, 1.6]]
    response = client.post("/api/region", json=BODY)
    assert response.status_code == 200
    data = response.json()
    assert data["wavelength_rejected_pixels"] > 0
    assert data["status"] == "insufficient_data"
    assert data["measurements"] is None
