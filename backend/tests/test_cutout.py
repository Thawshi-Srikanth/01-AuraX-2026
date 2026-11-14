"""Exercise the image API with synthetic MEFs and no archive network access."""

from unittest.mock import Mock

import pytest
from astropy.io import fits
from astropy.wcs import WCS
from fastapi.testclient import TestClient

from app.main import create_app
from app.services import cutout as service
from app.services.fits_download import (
    FitsContentError,
    FitsDownloadError,
    RetrievedFits,
)

URL = (
    "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/"
    "synthetic/v1/1/level2_syntheticD1_spx_v1.fits"
)
PARAMS = {"access_url": URL, "ra": 100, "dec": 20}


@pytest.fixture
def client(mef):
    with TestClient(create_app()) as client:
        client.app.state.fits_store.fetch = Mock(
            return_value=RetrievedFits(
                mef, URL + "?fixture=1", False, mef.stat().st_size
            )
        )
        yield client


def test_image_arrays_and_full_sip_metadata(client):
    response = client.get("/api/cutout", params={**PARAMS, "stretch": "linear"})
    assert response.status_code == 200
    data = response.json()
    assert (data["width"], data["height"]) == (16, 16)
    assert all(
        len(data[key]) == 256
        for key in ["pixels", "raw_flux", "variance", "flags", "valid_pixels"]
    )
    assert data["raw_flux"][0] is None
    assert data["pixels"][0] is None
    assert data["valid_pixels"][0] is False
    assert data["raw_flux"][17] == 17
    assert data["variance"][17] == 0.25
    assert data["flags"][17] == 1 << 21
    assert data["valid_pixels"][17] is True
    assert data["usable_pixel_count"] == 255
    assert data["masked_pixel_count"] == 1
    assert data["bunit"] == "MJy/sr"
    assert data["min_flux_mjy_sr"] == 1
    assert data["max_flux_mjy_sr"] == 255
    assert data["mean_flux_mjy_sr"] == 128
    assert data["wavelength_um"] == pytest.approx(1.234567)
    assert data["channel_width_um"] == pytest.approx(0.04)
    assert (data["target_x"], data["target_y"]) == pytest.approx((7.5, 7.5), abs=1e-6)
    header = fits.Header.fromstring(data["spatial_wcs_header"], sep="\n")
    wcs = WCS(header)
    assert wcs.sip.a[2, 0] == 0.00005
    assert wcs.world_to_pixel_values(100, 20) == pytest.approx((7.5, 7.5), abs=1e-6)
    assert data["processing_version"] == "synthetic-only"
    assert data["cached_fits"] is False
    client.app.state.fits_store.fetch.assert_called_once_with(URL, 100.0, 20.0, 0.03)


def test_display_stretches_leave_physical_values_unchanged(client):
    results = [
        client.get("/api/cutout", params={**PARAMS, "stretch": stretch}).json()
        for stretch in ["linear", "log", "zscale"]
    ]
    assert all(data["raw_flux"] == results[0]["raw_flux"] for data in results)
    assert all(data["variance"] == results[0]["variance"] for data in results)
    assert all(data["flags"] == results[0]["flags"] for data in results)
    assert results[1]["pixels"][17] > results[0]["pixels"][17]
    for data in results:
        values = [value for value in data["pixels"] if value is not None]
        assert values == sorted(values)
        assert min(values) >= 0 and max(values) <= 1


def test_flagged_and_negative_variance_pixels_are_gaps_with_raw_values_preserved(
    client, mef
):
    with fits.open(mef, mode="update", memmap=False) as hdus:
        hdus["FLAGS"].data[1, 2] = 1
        hdus["VARIANCE"].data[1, 3] = -1
        hdus["FLAGS"].header["MSKN0021"] = "SOURCE"
    data = client.get("/api/cutout", params=PARAMS).json()
    assert data["pixels"][18] is None and data["raw_flux"][18] == 18
    assert data["pixels"][19] is None and data["variance"][19] == -1
    assert not data["valid_pixels"][18] and not data["valid_pixels"][19]
    assert data["flags"][18] == 1
    assert data["masked_pixel_count"] == 3
    assert data["flag_definitions"]["MSKN0021"] == "SOURCE"


def test_informational_bits_remain_usable(client, mef):
    with fits.open(mef, mode="update", memmap=False) as hdus:
        hdus["FLAGS"].data[1, 2] = (1 << 12) | (1 << 21)
    data = client.get("/api/cutout", params=PARAMS).json()
    assert data["valid_pixels"][18] is True
    assert data["informational_flag_mask"] == (1 << 12) | (1 << 21)


def test_compatible_units_are_converted_with_correct_variance_scale(client, mef):
    with fits.open(mef, mode="update", memmap=False) as hdus:
        hdus["IMAGE"].header["BUNIT"] = "Jy/sr"
        hdus["VARIANCE"].header["BUNIT"] = "Jy2/sr2"
    data = client.get("/api/cutout", params={**PARAMS, "stretch": "linear"}).json()
    assert data["raw_flux"][17] == pytest.approx(17e-6)
    assert data["variance"][17] == pytest.approx(0.25e-12)
    assert data["max_flux_mjy_sr"] == pytest.approx(255e-6)


def test_no_usable_pixels_has_no_fabricated_statistics(client, mef):
    with fits.open(mef, mode="update", memmap=False) as hdus:
        hdus["FLAGS"].data[:] = 1
    response = client.get("/api/cutout", params=PARAMS)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "no_usable_pixels"
    assert data["usable_pixel_count"] == 0
    assert all(value is None for value in data["pixels"])
    assert data["min_flux_mjy_sr"] is None
    assert data["max_flux_mjy_sr"] is None
    assert data["mean_flux_mjy_sr"] is None
    assert data["display_min_mjy_sr"] is None
    assert data["raw_flux"][17] == 17


def test_constant_image_has_honest_display_limits(client, mef):
    with fits.open(mef, mode="update", memmap=False) as hdus:
        hdus["IMAGE"].data[:] = -5
    data = client.get("/api/cutout", params={**PARAMS, "stretch": "log"}).json()
    assert data["display_min_mjy_sr"] == data["display_max_mjy_sr"] == -5
    assert data["min_flux_mjy_sr"] == data["max_flux_mjy_sr"] == -5
    assert data["pixels"][17] == 0.5
    assert data["raw_flux"][17] == -5


@pytest.mark.parametrize(
    "override",
    [
        {"ra": -1},
        {"ra": 360},
        {"ra": "nan"},
        {"dec": 91},
        {"size_deg": 0},
        {"size_deg": 0.6},
        {"size_deg": "inf"},
        {"stretch": "unknown"},
    ],
)
def test_invalid_parameters_skip_retrieval(client, override):
    assert client.get("/api/cutout", params={**PARAMS, **override}).status_code == 422
    client.app.state.fits_store.fetch.assert_not_called()


def test_missing_observation_has_no_sample_fallback(client):
    assert client.get("/api/cutout", params={"ra": 100, "dec": 20}).status_code == 422
    client.app.state.fits_store.fetch.assert_not_called()


def test_untrusted_url_skips_retrieval(client):
    response = client.get(
        "/api/cutout",
        params={**PARAMS, "access_url": "https://example.invalid/file.fits"},
    )
    assert response.status_code == 400
    client.app.state.fits_store.fetch.assert_not_called()


@pytest.mark.parametrize(
    "error,status",
    [
        (FitsDownloadError("fixture network failure"), 503),
        (FitsContentError("fixture bad calibration"), 502),
        (OSError("fixture local cache failure"), 503),
    ],
)
def test_failures_are_http_errors_without_fake_images(client, error, status):
    client.app.state.fits_store.fetch.side_effect = error
    response = client.get("/api/cutout", params=PARAMS)
    assert response.status_code == status
    assert set(response.json()) == {"detail"}
    assert "fixture" not in response.json()["detail"]


def test_response_dimensions_are_bounded(client, monkeypatch):
    monkeypatch.setattr(service, "MAX_RESPONSE_AXIS", 8)
    assert client.get("/api/cutout", params=PARAMS).status_code == 413


def test_default_runtime_cache_location(monkeypatch, tmp_path):
    from pathlib import Path

    from app import main

    assert main.DEFAULT_CACHE_PATH == (
        Path(main.__file__).resolve().parent.parent / "cache" / "aurax.db"
    )
    configured_default = tmp_path / "backend" / "cache" / "aurax.db"
    monkeypatch.setattr(main, "DEFAULT_CACHE_PATH", configured_default)
    monkeypatch.delenv("CACHE_DB_PATH", raising=False)
    monkeypatch.delenv("FITS_CACHE_DIR", raising=False)
    with TestClient(main.create_app()) as client:
        assert client.app.state.cache.db_path == configured_default
        assert (
            client.app.state.fits_store.directory == configured_default.parent / "fits"
        )


def test_sip_coordinate_grid_and_catalog_projection_roundtrip(client):
    data = client.get("/api/cutout", params=PARAMS).json()
    index = 2 * data["width"] + 13
    response = client.post(
        "/api/catalog/project",
        json={
            "spatial_wcs_header": data["spatial_wcs_header"],
            "positions": [
                {
                    "ra": data["wcs"]["ra_grid"][index],
                    "dec": data["wcs"]["dec_grid"][index],
                }
            ],
        },
    )
    assert response.status_code == 200
    assert response.json()["pixels"][0] == pytest.approx([13, 2], abs=1e-5)
    assert response.json()["image_match_verified"] is False
    assert data["wcs"]["has_valid_wcs"] is True
    assert -180 <= data["wcs"]["north_angle_deg"] <= 180
    bad = client.post(
        "/api/catalog/project", json={"spatial_wcs_header": "invalid", "positions": []}
    )
    assert bad.status_code == 422
