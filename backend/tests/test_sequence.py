"""Explicit synthetic sequences test registration and all-pair scientific gates."""

from unittest.mock import Mock

import numpy as np
import pytest
from astropy.io import fits
from astropy.wcs import WCS
from fastapi.testclient import TestClient

from app.main import create_app
from app.services import comparison_sequence as service
from app.services.fits_download import FitsDownloadError, RetrievedFits

ROOT = "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/synthetic/v1/1/"
URLS = [ROOT + f"level2_sequence-{i}D1_spx_v1.fits" for i in range(4)]
PAYLOAD = {"access_urls": URLS, "ra": 100, "dec": 20, "stretch": "linear"}


@pytest.fixture
def sequence_files(mef, tmp_path):
    files = {}
    for i, (url, angle, wave) in enumerate(
        zip(URLS, [0, 17, -11, 23], [1.2, 1.205, 1.21, 1.215])
    ):
        path = tmp_path / f"sequence-{i}.fits"
        path.write_bytes(mef.read_bytes())
        with fits.open(path, mode="update", memmap=False) as hdus:
            h = hdus["IMAGE"].header
            h["OBSID"], h["DETECTOR"], h["DATE-OBS"] = (
                f"sequence-{i}",
                1,
                f"2025-{i + 1:02d}-01T00:00:00",
            )
            h["CRPIX1"], h["CRPIX2"] = 8.25, 8.25
            theta = np.deg2rad(angle)
            for key, value in {
                "PC1_1": np.cos(theta),
                "PC1_2": -np.sin(theta),
                "PC2_1": np.sin(theta),
                "PC2_2": np.cos(theta),
            }.items():
                h[key] = value
            yy, xx = np.indices((16, 16), dtype=float)
            sky = WCS(h).pixel_to_world(xx, yy)
            hdus["IMAGE"].data = 5 + 20 * (sky.ra.deg - 100) + 30 * (sky.dec.deg - 20)
            hdus["FLAGS"].data[:] = 0
            hdus["VARIANCE"].data[:] = 0.25
            hdus["WCS-WAVE"].data["VALUES"][..., 0] = wave
        files[url] = path
    return files


@pytest.fixture
def client(sequence_files):
    with TestClient(create_app()) as client:

        def fetch(url, ra, dec, size):
            path = sequence_files[url]
            return RetrievedFits(path, url + "?synthetic=1", False, path.stat().st_size)

        client.app.state.fits_store.fetch = Mock(side_effect=fetch)
        yield client


def post(client, **kwargs):
    response = client.post("/api/compare/sequence", json={**PAYLOAD, **kwargs})
    assert response.status_code == 200, response.text
    return response.json()


def test_four_rotated_frames_share_full_sip_grid_mask_and_display_scale(
    client, monkeypatch
):
    reproject = service.reproject_interp
    calls = []

    def spy(input_data, output_wcs, **kwargs):
        calls.append((input_data[1], output_wcs, kwargs))
        return reproject(input_data, output_wcs, **kwargs)

    monkeypatch.setattr(service, "reproject_interp", spy)
    data = post(client)
    assert data["status"] == "ready" and data["blink_ready"] is True
    assert len(data["frames"]) == len(data["epochs"]) == 4
    assert len(data["pair_checks"]) == 6
    assert all(pair["target_wavelength_match"] for pair in data["pair_checks"])
    assert data["matched_pixel_count"] >= 16
    assert data["baseline_days"] == pytest.approx(90)
    assert data["reference_epoch_index"] == 0
    assert len(calls) == 3
    assert all(
        input_wcs.sip is not None and output_wcs.sip is not None
        for input_wcs, output_wcs, _ in calls
    )
    assert all(
        kwargs["order"] == "bilinear" and kwargs["roundtrip_coords"]
        for _, _, kwargs in calls
    )
    mask = np.asarray(data["valid_mask"])
    reference = np.asarray(data["frames"][0]["pixels"], dtype=float)
    for i, frame in enumerate(data["frames"]):
        assert frame["epoch_index"] == i
        assert len(frame["pixels"]) == 256
        values = np.asarray(frame["pixels"], dtype=float)
        assert np.max(np.abs(values[mask] - reference[mask])) < 0.001
        assert all(
            value is None for value, valid in zip(frame["pixels"], mask) if not valid
        )
    assert (
        WCS(fits.Header.fromstring(data["spatial_wcs_header"], sep="\n")).sip
        is not None
    )
    assert data["scientific_difference_available"] is False
    assert data["motion_measurement_available"] is False
    assert client.app.state.fits_store.fetch.call_count == 4
    sizes = [call.args[3] for call in client.app.state.fits_store.fetch.call_args_list]
    assert all(size > sizes[0] for size in sizes[1:])


@pytest.mark.parametrize("count", [2, 3])
def test_two_or_three_observations_are_not_padded_to_four(client, count):
    data = post(client, access_urls=URLS[:count])
    assert data["status"] == "ready"
    assert len(data["frames"]) == len(data["epochs"]) == count
    assert len(data["pair_checks"]) == count * (count - 1) // 2
    assert client.app.state.fits_store.fetch.call_count == count


def test_reference_and_frame_order_follow_request_not_time_sort(client):
    selected = [URLS[i] for i in [2, 0, 3, 1]]
    data = post(client, access_urls=selected)
    assert data["status"] == "ready"
    assert [epoch["access_url"] for epoch in data["epochs"]] == selected
    assert [frame["epoch_index"] for frame in data["frames"]] == [0, 1, 2, 3]
    assert data["baseline_days"] == pytest.approx(90)


def test_reference_matches_cannot_hide_an_incompatible_other_pair(
    client, sequence_files
):
    for url, wave in zip(URLS[:3], [1.2, 1.17, 1.23]):
        with fits.open(sequence_files[url], mode="update", memmap=False) as hdus:
            hdus["WCS-WAVE"].data["VALUES"][..., 0] = wave
    data = post(client, access_urls=URLS[:3])
    checks = {
        (pair["epoch_index_a"], pair["epoch_index_b"]): pair
        for pair in data["pair_checks"]
    }
    assert checks[0, 1]["target_wavelength_match"] is True
    assert checks[0, 2]["target_wavelength_match"] is True
    assert checks[1, 2]["target_wavelength_match"] is False
    assert data["status"] == "incompatible_wavelength"
    assert data["frames"] == [] and data["blink_ready"] is False


def test_contributor_cross_combinations_are_checked_between_nonreference_frames():
    shape = (2, 2)
    reference = service.AlignedFrame(
        np.ones(shape),
        np.ones(shape, dtype=bool),
        np.full((1, *shape), 1.2),
        np.full((1, *shape), 0.04),
    )
    waves = np.stack([np.full(shape, value) for value in [1.17, 1.23, 1.17, 1.23]])
    b = service.AlignedFrame(
        np.ones(shape), np.ones(shape, dtype=bool), waves, np.full((4, *shape), 0.04)
    )
    c = service.AlignedFrame(
        np.ones(shape),
        np.ones(shape, dtype=bool),
        waves.copy(),
        np.full((4, *shape), 0.04),
    )
    pairs = {(i, j): mask for i, j, mask in service.all_pair_masks([reference, b, c])}
    assert pairs[0, 1].all() and pairs[0, 2].all()
    assert not pairs[1, 2].any()
    # The two mean wavelengths would be identical, hiding the incompatible donors.
    assert np.allclose(waves.mean(axis=0), 1.2)


def test_bad_pixels_in_any_frame_are_shared_gaps(client, sequence_files):
    first = post(client)
    with fits.open(sequence_files[URLS[-1]], mode="update", memmap=False) as hdus:
        hdus["FLAGS"].data[1:3, 1:3] = 1
    second = post(client)
    assert second["status"] == "ready"
    assert second["matched_pixel_count"] < first["matched_pixel_count"]
    for frame in second["frames"]:
        assert all(
            value is None
            for value, valid in zip(frame["pixels"], second["valid_mask"])
            if not valid
        )


def test_no_common_quality_area_blocks_the_entire_sequence(client, sequence_files):
    with fits.open(sequence_files[URLS[2]], mode="update", memmap=False) as hdus:
        hdus["FLAGS"].data[:] = 1
    data = post(client)
    assert data["status"] == "no_usable_overlap"
    assert data["frames"] == []
    assert data["coverage_pixel_count"] == 0


def test_duplicate_actual_times_are_not_accepted_as_new_epochs(client, sequence_files):
    with fits.open(sequence_files[URLS[2]], mode="update", memmap=False) as hdus:
        hdus["IMAGE"].header["DATE-OBS"] = "2025-01-01T00:00:00"
    data = post(client)
    assert data["status"] == "duplicate_time"
    assert data["frames"] == []


def test_same_calendar_day_with_different_times_is_valid(client, sequence_files):
    with fits.open(sequence_files[URLS[1]], mode="update", memmap=False) as hdus:
        hdus["IMAGE"].header["DATE-OBS"] = "2025-01-01T12:00:00"
    data = post(client, access_urls=URLS[:2])
    assert data["status"] == "ready" and data["baseline_days"] == pytest.approx(0.5)


def test_one_joint_stretch_preserves_four_relative_brightness_levels(
    client, sequence_files
):
    for index, url in enumerate(URLS):
        with fits.open(sequence_files[url], mode="update", memmap=False) as hdus:
            hdus["IMAGE"].data[:] = index + 1
    data = post(client)
    assert data["status"] == "ready"
    assert data["display_min_mjy_sr"] == pytest.approx(1)
    assert data["display_max_mjy_sr"] == pytest.approx(4)
    for index, frame in enumerate(data["frames"]):
        assert all(
            value == pytest.approx(index / 3, abs=1e-12)
            for value in frame["pixels"]
            if value is not None
        )


@pytest.mark.parametrize(
    "override,status",
    [
        ({"access_urls": URLS[:1]}, 422),
        ({"access_urls": URLS + [URLS[0]]}, 422),
        ({"access_urls": [URLS[0], URLS[0]]}, 400),
        ({"access_urls": [URLS[0], URLS[0].replace("spx_v1", "spx_v2")]}, 400),
        ({"access_urls": [URLS[0], URLS[1].replace("D1_", "D2_")]}, 400),
        ({"access_urls": [URLS[0], "https://example.invalid/f.fits"]}, 400),
        ({"access_urls": [URLS[0], "a" * 2049]}, 422),
        ({"ra": 360}, 422),
        ({"dec": 91}, 422),
        ({"size_deg": 0}, 422),
        ({"size_deg": 0.3}, 422),
        ({"stretch": "unknown"}, 422),
        ({"utc_dates": []}, 422),
    ],
)
def test_invalid_sequences_are_rejected_before_downloads(client, override, status):
    assert (
        client.post("/api/compare/sequence", json={**PAYLOAD, **override}).status_code
        == status
    )
    client.app.state.fits_store.fetch.assert_not_called()


def test_third_image_failure_returns_error_and_closes_open_files(client, monkeypatch):
    from contextlib import contextmanager

    fetch = client.app.state.fits_store.fetch.side_effect

    def fail_third(url, *args):
        if url == URLS[2]:
            raise FitsDownloadError("Synthetic retrieval failure")
        return fetch(url, *args)

    client.app.state.fits_store.fetch.side_effect = fail_third
    original = service.open_observation
    opened = []

    @contextmanager
    def track(path):
        with original(path) as data:
            opened.append(data.hdus)
            yield data

    monkeypatch.setattr(service, "open_observation", track)
    response = client.post("/api/compare/sequence", json=PAYLOAD)
    assert response.status_code == 503
    assert set(response.json()) == {"detail"}
    assert len(opened) == 2 and all(hdus._file.closed for hdus in opened)


def test_identity_mismatch_does_not_drop_a_frame_silently(client, sequence_files):
    with fits.open(sequence_files[URLS[3]], mode="update", memmap=False) as hdus:
        hdus["IMAGE"].header["OBSID"] = "wrong-source"
    response = client.post("/api/compare/sequence", json=PAYLOAD)
    assert response.status_code == 502
    assert set(response.json()) == {"detail"}


def test_image_dimensions_are_bounded_before_loading_more_frames(client, monkeypatch):
    monkeypatch.setattr(service, "MAX_REFERENCE_AXIS", 8)
    assert client.post("/api/compare/sequence", json=PAYLOAD).status_code == 502
    assert client.app.state.fits_store.fetch.call_count == 1
