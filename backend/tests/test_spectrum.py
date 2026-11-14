"""Real extraction logic with synthetic MEFs; no model spectra or archive traffic."""

from datetime import UTC, datetime
from unittest.mock import Mock

import numpy as np
import pytest
from astropy.io import fits
from fastapi.testclient import TestClient

from app.main import create_app
from app.schemas.observation import ObservationsResponse, SPHERExObservation
from app.services import spectrum as service
from app.services.fits_download import (
    FitsContentError,
    FitsDownloadError,
    RetrievedFits,
)
from app.services.observations import ArchiveUnavailable

PARAMS = {"ra": 100, "dec": 20}


@pytest.fixture
def sample_data(mef, tmp_path, monkeypatch):
    products, files = [], {}
    for index, detector in enumerate(["D2", "D1"]):
        path = tmp_path / f"sample-{index}.fits"
        path.write_bytes(mef.read_bytes())
        with fits.open(path, mode="update", memmap=False) as hdus:
            hdus["IMAGE"].header["CRPIX1"] = 8.25
            hdus["IMAGE"].header["CRPIX2"] = 8.25
            hdus["IMAGE"].data += index * 10
            if index == 0:
                hdus["WCS-WAVE"].data["VALUES"][..., 0] = 2.5
            else:
                # Known gradient verifies wavelength is evaluated at the sampled pixel.
                hdus["WCS-WAVE"].data["VALUES"][..., 0] = [[1.0, 1.6], [1.0, 1.6]]
        url = (
            "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/"
            f"synthetic/v1/1/level2_synthetic{index}{detector}_spx_v1.fits"
        )
        product = SPHERExObservation(
            artifact_id=f"fixture-{index}",
            obs_id=f"synthetic-{index}",
            detector=detector,
            band_name=f"SPHEREx-{detector}",
            release="dr1",
            processing_version="synthetic-only",
            mjd_start=60000 + index,
            utc_date=f"2023-02-{25 + index}T00:00:00Z",
            date_only=f"2023-02-{25 + index}",
            wavelength_min_um=0.75,
            wavelength_max_um=3.0,
            exptime_sec=100,
            access_url=url,
        )
        products.append(product)
        files[url] = path

    def metadata(ra, dec, limit, cache):
        return ObservationsResponse(
            ra_deg=ra,
            dec_deg=dec,
            limit=limit,
            total_count=min(limit, len(products)),
            observations=products[:limit],
            truncated=len(products) > limit,
            status="success" if products else "no_coverage",
            message="Synthetic fixture",
            retrieved_at=datetime(2026, 1, 1, tzinfo=UTC),
        )

    lookup = Mock(side_effect=metadata)
    monkeypatch.setattr(service, "find_observations", lookup)
    return products, files, lookup


@pytest.fixture
def client(sample_data):
    products, files, _ = sample_data
    with TestClient(create_app()) as client:

        def fetch(url, ra, dec, size):
            path = files[url]
            return RetrievedFits(path, url + "?synthetic=1", False, path.stat().st_size)

        client.app.state.fits_store.fetch = Mock(side_effect=fetch)
        yield client


def test_samples_are_measured_sorted_and_not_padded(client, sample_data):
    response = client.get("/api/spectrum", params=PARAMS)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["total_samples"] == 2
    assert len(data["spectral_points"]) == 2
    assert "total_channels" not in data
    assert "spectral_features" not in data
    first, second = data["spectral_points"]
    assert first["detector"] == "D1" and second["detector"] == "D2"
    assert first["wavelength_um"] == pytest.approx(1.28)
    assert second["wavelength_um"] == pytest.approx(2.5)
    assert (first["pixel_x"], first["pixel_y"]) == (7, 7)
    assert first["target_x"] == pytest.approx(7.25, abs=1e-6)
    assert first["flux_mjy_sr"] == 129
    assert second["flux_mjy_sr"] == 119
    assert first["flux_error_mjy_sr"] == 0.5
    assert first["snr"] == 258
    assert first["resolving_power"] == pytest.approx(32)
    assert first["sample_offset_arcsec"] > 0
    assert first["utc_date"] != second["utc_date"]
    assert first["artifact_id"] == "fixture-1"
    assert first["source_url"].endswith("?synthetic=1")
    assert data["proper_motion_applied"] is False
    assert data["background_subtracted"] is False
    assert "nearest-pixel" in data["method"]
    assert "systematic" in data["uncertainty"]
    assert client.app.state.fits_store.fetch.call_count == 2


def test_bounded_subset_is_explicitly_partial(client):
    data = client.get("/api/spectrum", params={**PARAMS, "limit": 1}).json()
    assert data["status"] == "partial"
    assert data["metadata_truncated"] is True
    assert data["total_samples"] == 1
    assert client.app.state.fits_store.fetch.call_count == 1


def test_bad_target_pixel_is_not_replaced_with_neighbour(client, sample_data):
    _, files, _ = sample_data
    path = next(iter(files.values()))
    with fits.open(path, mode="update", memmap=False) as hdus:
        hdus["FLAGS"].data[7, 7] = 1
    data = client.get("/api/spectrum", params=PARAMS).json()
    assert data["status"] == "partial"
    assert data["total_samples"] == 1
    excluded = data["excluded_observations"][0]
    assert excluded["reason"] == "unusable_pixel"
    assert excluded["flags"] == 1
    assert (excluded["pixel_x"], excluded["pixel_y"]) == (7, 7)


@pytest.mark.parametrize(
    "kind", ["negative_flux", "zero_variance", "bad_variance", "nan_flux"]
)
def test_physical_edge_cases_are_not_fabricated(client, sample_data, kind):
    _, files, _ = sample_data
    path = next(iter(files.values()))
    with fits.open(path, mode="update", memmap=False) as hdus:
        if kind == "negative_flux":
            hdus["IMAGE"].data[7, 7] = -4
        elif kind == "zero_variance":
            hdus["VARIANCE"].data[7, 7] = 0
        elif kind == "bad_variance":
            hdus["VARIANCE"].data[7, 7] = -1
        else:
            hdus["IMAGE"].data[7, 7] = np.nan
    data = client.get("/api/spectrum", params=PARAMS).json()
    points = {point["artifact_id"]: point for point in data["spectral_points"]}
    if kind == "negative_flux":
        assert points["fixture-0"]["flux_mjy_sr"] == -4
        assert points["fixture-0"]["snr"] == -8
    elif kind == "zero_variance":
        assert points["fixture-0"]["flux_error_mjy_sr"] == 0
        assert points["fixture-0"]["snr"] is None
    else:
        assert "fixture-0" not in points
        assert data["excluded_observations"][0]["reason"] == "unusable_pixel"


def test_no_usable_pixels_is_not_no_coverage(client, sample_data):
    _, files, _ = sample_data
    for path in files.values():
        with fits.open(path, mode="update", memmap=False) as hdus:
            hdus["FLAGS"].data[7, 7] = 1
    data = client.get("/api/spectrum", params=PARAMS).json()
    assert data["status"] == "no_usable_data"
    assert data["total_samples"] == 0
    assert len(data["excluded_observations"]) == 2


def test_valid_empty_archive_result_has_no_samples(client, sample_data):
    products, _, _ = sample_data
    products.clear()
    data = client.get("/api/spectrum", params=PARAMS).json()
    assert data["status"] == "no_coverage"
    assert data["spectral_points"] == []
    assert data["excluded_observations"] == []
    client.app.state.fits_store.fetch.assert_not_called()


@pytest.mark.parametrize(
    "error,reason",
    [
        (FitsDownloadError("fixture timeout"), "download_failed"),
        (FitsContentError("fixture calibration failure"), "invalid_calibration"),
    ],
)
def test_download_failures_remain_incomplete_not_empty(client, error, reason):
    client.app.state.fits_store.fetch.side_effect = error
    response = client.get("/api/spectrum", params=PARAMS)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "partial"
    assert data["total_samples"] == 0
    assert all(item["reason"] == reason for item in data["excluded_observations"])


def test_metadata_failure_is_http_error(client, sample_data):
    sample_data[2].side_effect = ArchiveUnavailable
    assert client.get("/api/spectrum", params=PARAMS).status_code == 503
    client.app.state.fits_store.fetch.assert_not_called()


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"ra": 100},
        {"ra": -1, "dec": 0},
        {"ra": 360, "dec": 0},
        {"ra": "nan", "dec": 0},
        {"ra": 100, "dec": 91},
        {**PARAMS, "limit": 0},
        {**PARAMS, "limit": 7},
    ],
)
def test_invalid_inputs_do_not_query_or_download(client, sample_data, params):
    assert client.get("/api/spectrum", params=params).status_code == 422
    sample_data[2].assert_not_called()
    client.app.state.fits_store.fetch.assert_not_called()


def test_surface_brightness_and_sigma_unit_conversion(client, sample_data):
    path = next(iter(sample_data[1].values()))
    with fits.open(path, mode="update", memmap=False) as hdus:
        hdus["IMAGE"].header["BUNIT"] = "Jy/sr"
        hdus["VARIANCE"].header["BUNIT"] = "Jy2/sr2"
    points = client.get("/api/spectrum", params=PARAMS).json()["spectral_points"]
    point = next(point for point in points if point["artifact_id"] == "fixture-0")
    assert point["flux_mjy_sr"] == pytest.approx(119e-6)
    assert point["flux_error_mjy_sr"] == pytest.approx(0.5e-6)
