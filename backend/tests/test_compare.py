"""Full-SIP scientific guardrails using synthetic images, not mission discoveries."""

from unittest.mock import Mock

import numpy as np
import pytest
from astropy.io import fits
from astropy.wcs import WCS
from fastapi.testclient import TestClient

from app.main import create_app
from app.services import compare as service
from app.services.fits_download import (
    FitsContentError,
    FitsDownloadError,
    RetrievedFits,
)

ROOT = "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/synthetic/v1/1/"
URL_A = ROOT + "level2_fixture-AD1_spx_v1.fits"
URL_B = ROOT + "level2_fixture-BD1_spx_v1.fits"
PAYLOAD = {
    "access_url_a": URL_A,
    "access_url_b": URL_B,
    "ra": 100,
    "dec": 20,
    "stretch": "linear",
}


@pytest.fixture
def pair(mef, tmp_path):
    files = {}
    for label, url, angle, date in [
        ("A", URL_A, 0, "2025-01-01T00:00:00"),
        ("B", URL_B, 17, "2025-07-01T00:00:00"),
    ]:
        path = tmp_path / f"pair-{label}.fits"
        path.write_bytes(mef.read_bytes())
        with fits.open(path, mode="update", memmap=False) as hdus:
            h = hdus["IMAGE"].header
            h["OBSID"], h["DETECTOR"], h["DATE-OBS"] = f"fixture-{label}", 1, date
            theta = np.deg2rad(angle)
            for key, value in {
                "PC1_1": np.cos(theta),
                "PC1_2": -np.sin(theta),
                "PC2_1": np.sin(theta),
                "PC2_2": np.cos(theta),
            }.items():
                h[key] = value
            wcs = WCS(h)
            yy, xx = np.indices((16, 16), dtype=float)
            sky = wcs.pixel_to_world(xx, yy)
            # Same smooth sky in two rotated detector frames; no moving source injected.
            hdus["IMAGE"].data = 5 + 20 * (sky.ra.deg - 100) + 30 * (sky.dec.deg - 20)
            hdus["FLAGS"].data[:] = 0
            hdus["VARIANCE"].data[:] = 0.25
            hdus["WCS-WAVE"].data["VALUES"][..., 0] = 1.2
            hdus["WCS-WAVE"].data["VALUES"][..., 1] = 0.04
        files[url] = path
    return files


@pytest.fixture
def client(pair):
    with TestClient(create_app()) as client:

        def fetch(url, ra, dec, size):
            path = pair[url]
            return RetrievedFits(path, url + "?synthetic=1", False, path.stat().st_size)

        client.app.state.fits_store.fetch = Mock(side_effect=fetch)
        yield client


def test_rotated_sky_registers_with_full_sip_and_shared_stretch(client, monkeypatch):
    reproject = service.reproject_interp
    calls = []

    def spy(input_data, output_wcs, **kwargs):
        calls.append((input_data[1], output_wcs, kwargs))
        return reproject(input_data, output_wcs, **kwargs)

    monkeypatch.setattr(service, "reproject_interp", spy)
    response = client.post("/api/compare", json=PAYLOAD)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "ready"
    assert data["blink_ready"] is True and data["registered"] is True
    assert data["target_wavelength_match"] is True
    assert data["baseline_days"] == pytest.approx(181)
    assert data["matched_pixel_count"] >= 16
    assert len(data["pixels_a"]) == len(data["pixels_b"]) == 256
    a, b = (
        np.array(data["pixels_a"], dtype=float),
        np.array(data["pixels_b"], dtype=float),
    )
    mask = np.array(data["valid_mask"])
    assert np.max(np.abs(a[mask] - b[mask])) < 0.001
    assert all(
        value is None for value, valid in zip(data["pixels_a"], mask) if not valid
    )
    assert len(calls) == 1
    assert calls[0][0].sip.a[2, 0] == 0.00005
    assert calls[0][1].sip.b[0, 2] == -0.00004
    assert calls[0][2]["roundtrip_coords"] is True
    assert calls[0][2]["order"] == "bilinear"
    header = fits.Header.fromstring(data["spatial_wcs_header"], sep="\n")
    assert WCS(header).sip is not None
    assert data["scientific_difference_available"] is False
    assert data["motion_measurement_available"] is False
    assert "pixels_diff" not in data and "metrics" not in data
    assert client.app.state.fits_store.fetch.call_count == 2
    sizes = [call.args[3] for call in client.app.state.fits_store.fetch.call_args_list]
    assert sizes[1] > sizes[0]


def test_target_wavelength_mismatch_produces_no_blink_arrays(client, pair):
    with fits.open(pair[URL_B], mode="update", memmap=False) as hdus:
        hdus["WCS-WAVE"].data["VALUES"][..., 0] = 1.4
    data = client.post("/api/compare", json=PAYLOAD).json()
    assert data["status"] == "incompatible_wavelength"
    assert data["blink_ready"] is False
    assert data["pixels_a"] == data["pixels_b"] == []


def test_narrow_intervening_channels_are_not_hidden_by_interpolation():
    assert not bool(service.matching_wavelengths(1.2, 1.21, 0.04, 0.005))
    assert not bool(service.matching_wavelengths(1.2, 1.239, 0.04, 0.04))
    assert bool(service.matching_wavelengths(1.2, 1.21, 0.04, 0.04))
    assert not bool(service.matching_wavelengths(np.nan, 1.2, 0.04, 0.04))


def test_local_target_match_is_not_a_certificate_for_whole_field(client, pair):
    with fits.open(pair[URL_B], mode="update", memmap=False) as hdus:
        hdus["WCS-WAVE"].data["VALUES"][..., 0] = [[1.15, 1.25], [1.15, 1.25]]
    data = client.post("/api/compare", json=PAYLOAD).json()
    assert data["target_wavelength_match"] is True
    assert data["matched_pixel_count"] < data["coverage_pixel_count"]
    if data["blink_ready"]:
        assert any(
            coverage and not valid
            for coverage, valid in zip(data["coverage_mask"], data["valid_mask"])
        )
        assert all(
            value is None
            for value, valid in zip(data["pixels_b"], data["valid_mask"])
            if not valid
        )


def test_bad_bilinear_neighbour_masks_output_instead_of_filling_it(client, pair):
    initial = client.post("/api/compare", json=PAYLOAD).json()
    with fits.open(pair[URL_B], mode="update", memmap=False) as hdus:
        hdus["FLAGS"].data[6:10, 6:10] = 1
    data = client.post("/api/compare", json=PAYLOAD).json()
    assert data["coverage_pixel_count"] < initial["coverage_pixel_count"]
    assert data["blink_ready"] is False
    assert data["pixels_a"] == []


def test_no_quality_overlap_has_no_fake_frames(client, pair):
    with fits.open(pair[URL_B], mode="update", memmap=False) as hdus:
        hdus["FLAGS"].data[:] = 1
    data = client.post("/api/compare", json=PAYLOAD).json()
    assert data["status"] == "no_usable_overlap"
    assert data["coverage_pixel_count"] == 0
    assert data["pixels_a"] == data["pixels_b"] == []


def test_same_time_is_not_temporal_comparison(client, pair):
    with fits.open(pair[URL_B], mode="update", memmap=False) as hdus:
        hdus["IMAGE"].header["DATE-OBS"] = "2025-01-01T00:00:00"
    data = client.post("/api/compare", json=PAYLOAD).json()
    assert data["status"] == "no_time_baseline"
    assert data["baseline_days"] == 0
    assert data["blink_ready"] is False
    assert data["pixels_a"] == []


@pytest.mark.parametrize(
    "override,status",
    [
        ({"access_url_b": URL_A}, 400),
        ({"access_url_b": URL_A.replace("spx_v1", "spx_v2")}, 400),
        ({"access_url_b": URL_B.replace("D1_", "D2_")}, 400),
        ({"access_url_b": "https://example.invalid/file.fits"}, 400),
        ({"ra": 360}, 422),
        ({"ra": -1}, 422),
        ({"dec": 91}, 422),
        ({"size_deg": 0}, 422),
        ({"size_deg": 0.3}, 422),
        ({"stretch": "unknown"}, 422),
        ({"wavelength_um": 1.2}, 422),
    ],
)
def test_invalid_or_fabricated_inputs_are_rejected_before_download(
    client, override, status
):
    assert (
        client.post("/api/compare", json={**PAYLOAD, **override}).status_code == status
    )
    client.app.state.fits_store.fetch.assert_not_called()


@pytest.mark.parametrize(
    "field,value", [("OBSID", "wrong"), ("DETECTOR", 2), ("DATE-OBS", "invalid")]
)
def test_fits_identity_and_date_override_untrusted_request_metadata(
    client, pair, field, value
):
    with fits.open(pair[URL_B], mode="update", memmap=False) as hdus:
        hdus["IMAGE"].header[field] = value
    response = client.post("/api/compare", json=PAYLOAD)
    assert response.status_code == 502
    assert set(response.json()) == {"detail"}


@pytest.mark.parametrize(
    "error,status",
    [(FitsDownloadError("fixture"), 503), (FitsContentError("fixture"), 502)],
)
def test_archive_failures_are_honest_http_errors(client, error, status):
    client.app.state.fits_store.fetch.side_effect = error
    assert client.post("/api/compare", json=PAYLOAD).status_code == status


def test_constant_images_keep_actual_joint_display_limits(client, pair):
    for path in pair.values():
        with fits.open(path, mode="update", memmap=False) as hdus:
            hdus["IMAGE"].data[:] = -5
    data = client.post("/api/compare", json={**PAYLOAD, "stretch": "log"}).json()
    assert data["status"] == "ready"
    assert data["display_min_mjy_sr"] == pytest.approx(-5, abs=1e-12)
    assert data["display_max_mjy_sr"] == pytest.approx(-5, abs=1e-12)
    assert {value for value in data["pixels_a"] if value is not None} == {0.5}


def test_compare_post_is_available_to_configured_frontend_origin(client):
    response = client.options(
        "/api/compare",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_all_bilinear_neighbours_must_match_even_if_average_bandwidth_would_pass():
    from types import SimpleNamespace

    a_wcs = WCS(naxis=2)
    a_wcs.wcs.crpix = [1, 1]
    a_wcs.wcs.crval = [100, 20]
    a_wcs.wcs.cdelt = [-0.001, 0.001]
    a_wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    b_wcs = a_wcs.deepcopy()
    b_wcs.wcs.crpix = [1.25, 1.25]
    a = SimpleNamespace(image=np.ones((2, 2)), spatial_wcs=a_wcs)
    b = SimpleNamespace(image=np.ones((3, 3)), spatial_wcs=b_wcs)
    band_b = np.full((3, 3), 0.04)
    band_b[0, 0] = 0.001
    wave_a, band_a = np.full((2, 2), 1.2), np.full((2, 2), 0.04)
    wave_b = np.full((3, 3), 1.21)
    coverage, usable = service._common_masks(
        a,
        b,
        wave_a,
        band_a,
        np.ones((2, 2), dtype=bool),
        wave_b,
        band_b,
        np.ones((3, 3), dtype=bool),
        np.ones((2, 2)),
        np.ones((2, 2)),
    )
    assert coverage[0, 0]
    assert not usable[0, 0]
    assert bool(service.matching_wavelengths(1.2, 1.21, 0.04, 0.03))


def test_shared_display_limits_preserve_relative_brightness(client, pair):
    with fits.open(pair[URL_A], mode="update", memmap=False) as hdus:
        hdus["IMAGE"].data[:] = 1
    with fits.open(pair[URL_B], mode="update", memmap=False) as hdus:
        hdus["IMAGE"].data[:] = 10
    data = client.post("/api/compare", json=PAYLOAD).json()
    assert data["status"] == "ready"
    assert data["display_min_mjy_sr"] == pytest.approx(1)
    assert data["display_max_mjy_sr"] == pytest.approx(10)
    assert max(value for value in data["pixels_a"] if value is not None) < 1e-12
    assert min(value for value in data["pixels_b"] if value is not None) > 1 - 1e-12
