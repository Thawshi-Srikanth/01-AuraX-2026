"""Bounded matching with synthetic calibrated observations, never fake app data."""

from datetime import UTC, datetime
from unittest.mock import Mock

import pytest
from astropy.io import fits
from astropy.table import Table
from astropy.time import Time
from fastapi.testclient import TestClient

from app.main import create_app
from app.schemas.comparison_matches import MatchRequest
from app.schemas.observation import SPHERExObservation
from app.services import comparison_candidates as archive
from app.services import comparison_matches as service
from app.services.comparison_candidates import CandidateBatch
from app.services.fits_download import FitsDownloadError, RetrievedFits
from app.services.observations import ArchiveUnavailable, InvalidArchiveResponse

PAYLOAD = {"ra": 100, "dec": 20}


@pytest.fixture
def candidates(mef, tmp_path, monkeypatch):
    products, files, cached_urls = [], {}, set()
    for index, wave in enumerate([1.20, 1.23, 1.26, 1.20, 1.20]):
        date = f"2025-{index + 1:02d}-01T00:00:00"
        path = tmp_path / f"matching-{index}.fits"
        path.write_bytes(mef.read_bytes())
        with fits.open(path, mode="update", memmap=False) as hdus:
            header = hdus["IMAGE"].header
            header["OBSID"], header["DETECTOR"], header["DATE-OBS"] = (
                f"match-{index}",
                1,
                date,
            )
            header["CRPIX1"], header["CRPIX2"] = 8.25, 8.25
            hdus["WCS-WAVE"].data["VALUES"][..., 0] = wave
            hdus["FLAGS"].data[:] = 0
        url = (
            "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/"
            f"synthetic/v1/1/level2_match-{index}D1_spx_v1.fits"
        )
        product = SPHERExObservation(
            artifact_id=f"artifact-{index}",
            obs_id=f"match-{index}",
            detector="D1",
            band_name="SPHEREx-D1",
            release="dr1",
            processing_version="v1",
            mjd_start=float(Time(date, format="isot", scale="utc").mjd),
            utc_date=date + "Z",
            date_only=date[:10],
            wavelength_min_um=0.75,
            wavelength_max_um=1.4,
            exptime_sec=100,
            access_url=url,
        )
        products.append(product)
        files[url] = path

    def query(request):
        return CandidateBatch(
            observations=products[: request.candidate_limit],
            metadata_rows=min(len(products), request.candidate_limit),
            truncated=len(products) > request.candidate_limit,
            rejected_count=0,
            duplicate_exposure_count=0,
            retrieved_at=datetime.now(UTC),
        )

    lookup = Mock(side_effect=query)
    monkeypatch.setattr(service, "query_candidates", lookup)
    return products, files, cached_urls, lookup


@pytest.fixture
def client(candidates):
    products, files, cached_urls, _ = candidates
    with TestClient(create_app()) as client:

        def local(url, ra, dec, size):
            if url not in cached_urls:
                return None
            path = files[url]
            return RetrievedFits(path, url + "?synthetic=1", True, path.stat().st_size)

        def fetch(url, ra, dec, size):
            path = files[url]
            cached_urls.add(url)
            return RetrievedFits(path, url + "?synthetic=1", False, path.stat().st_size)

        client.app.state.fits_store.get_cached = Mock(side_effect=local)
        client.app.state.fits_store.fetch = Mock(side_effect=fetch)
        yield client


def post(client, **kwargs):
    response = client.post("/api/compare/matches", json={**PAYLOAD, **kwargs})
    assert response.status_code == 200, response.text
    return response.json()


def test_passive_requests_do_not_download_or_claim_no_matches(client, candidates):
    data = post(client)
    assert data["status"] == "partial" and data["search_complete"] is False
    assert data["pending_count"] == 5 and data["verified_count"] == 0
    assert data["new_download_attempts"] == 0
    assert data["can_continue"] is True
    again = post(client)
    assert again["state_cached"] is True
    assert again["pending_count"] == 5
    assert candidates[3].call_count == 1
    client.app.state.fits_store.fetch.assert_not_called()


def test_explicit_batches_advance_without_renewing_downloads_on_passive_read(
    client, candidates
):
    first = post(client, advance=True)
    assert first["new_download_attempts"] == 2
    assert first["verified_count"] == 2 and first["pending_count"] == 3
    assert first["pairs_count"] == 1
    assert first["pairs"][0]["blink_ready"] is False
    assert first["pairs"][0]["full_frame_verified"] is False
    assert first["pairs"][0]["comparison_request"]["ra"] == 100
    passive = post(client)
    assert passive["new_download_attempts"] == 0
    assert passive["reused_checks_count"] == 2
    assert client.app.state.fits_store.fetch.call_count == 2
    second = post(client, advance=True)
    assert second["new_download_attempts"] == 2
    assert second["verified_count"] == 4 and second["pending_count"] == 1
    third = post(client, advance=True)
    assert third["new_download_attempts"] == 1
    assert third["verified_count"] == 5 and third["pending_count"] == 0
    assert third["search_complete"] is True and third["status"] == "matches"
    assert candidates[3].call_count == 1


def test_search_progress_survives_application_restart(client, candidates):
    first = post(client, advance=True)
    assert first["verified_count"] == 2
    with TestClient(create_app()) as reopened:
        reopened.app.state.fits_store.fetch = Mock(
            side_effect=AssertionError("Passive read downloaded")
        )
        result = post(reopened)
        assert result["verified_count"] == 2 and result["state_cached"] is True
        reopened.app.state.fits_store.fetch.assert_not_called()
    assert candidates[3].call_count == 1


def test_cached_checks_do_not_group_nontransitive_wavelength_chains(client, candidates):
    products, _, cached_urls, _ = candidates
    cached_urls.update(product.access_url for product in products)
    data = post(client)
    assert data["status"] == "matches" and data["search_complete"] is True
    assert data["cached_file_checks"] == 5
    assert data["new_download_attempts"] == 0
    pairs = {(pair["artifact_id_a"], pair["artifact_id_b"]) for pair in data["pairs"]}
    assert ("artifact-0", "artifact-1") in pairs
    assert ("artifact-1", "artifact-2") in pairs
    assert ("artifact-0", "artifact-2") not in pairs
    baselines = [pair["baseline_days"] for pair in data["pairs"]]
    assert baselines == sorted(baselines, reverse=True)
    client.app.state.fits_store.fetch.assert_not_called()


def test_metadata_limit_stays_incomplete_even_when_all_returned_files_are_checked(
    client, candidates
):
    candidates[2].update(product.access_url for product in candidates[0])
    data = post(client, candidate_limit=2)
    assert data["metadata_truncated"] is True
    assert data["verified_count"] == 2 and data["pending_count"] == 0
    assert data["search_complete"] is False and data["status"] == "partial"
    assert data["can_continue"] is False
    assert "Narrow" in data["message"]


def test_bad_target_pixel_is_excluded_without_substitution(client, candidates):
    products, files, cached_urls, _ = candidates
    cached_urls.update(product.access_url for product in products)
    with fits.open(files[products[0].access_url], mode="update", memmap=False) as hdus:
        hdus["FLAGS"].data[7, 7] = 1
    data = post(client)
    assert data["excluded_count"] == 1 and data["verified_count"] == 4
    check = next(
        check for check in data["checks"] if check["artifact_id"] == "artifact-0"
    )
    assert check["status"] == "excluded" and check["reason"] == "unusable_target"
    assert all(
        pair["artifact_id_a"] != "artifact-0" and pair["artifact_id_b"] != "artifact-0"
        for pair in data["pairs"]
    )


def test_failed_downloads_do_not_repeat_until_retry_is_requested(client, candidates):
    url = candidates[0][0].access_url
    underlying = client.app.state.fits_store.fetch.side_effect

    def failing(url_arg, *args):
        if url_arg == url:
            raise FitsDownloadError("Synthetic unavailable product")
        return underlying(url_arg, *args)

    client.app.state.fits_store.fetch.side_effect = failing
    first = post(client, advance=True)
    assert first["failed_count"] == 1 and first["can_retry_failed"] is True
    assert first["search_complete"] is False
    post(client, advance=True)
    settled = post(client, advance=True)
    assert settled["pending_count"] == 0 and settled["failed_count"] == 1
    calls_before = client.app.state.fits_store.fetch.call_count
    post(client, advance=True)
    assert client.app.state.fits_store.fetch.call_count == calls_before
    client.app.state.fits_store.fetch.side_effect = underlying
    retried = post(client, advance=True, retry_failed=True)
    assert retried["new_download_attempts"] == 1
    assert retried["failed_count"] == 0 and retried["search_complete"] is True


def test_empty_complete_metadata_is_not_a_fabricated_match(client, candidates):
    candidates[0].clear()
    data = post(client, advance=True)
    assert data["status"] == "no_coverage" and data["search_complete"] is True
    assert data["pairs"] == [] and data["candidate_count"] == 0
    client.app.state.fits_store.fetch.assert_not_called()


def test_metadata_errors_are_http_failures_not_empty_matches(client, candidates):
    candidates[3].side_effect = ArchiveUnavailable
    response = client.post("/api/compare/matches", json=PAYLOAD)
    assert response.status_code == 503
    client.app.state.fits_store.fetch.assert_not_called()


def test_concurrent_matching_returns_busy_without_querying(client, candidates):
    assert service._SEARCH_LOCK.acquire(blocking=False)
    try:
        assert client.post("/api/compare/matches", json=PAYLOAD).status_code == 409
        candidates[3].assert_not_called()
    finally:
        service._SEARCH_LOCK.release()


def test_file_check_budget_remains_bounded(client, candidates, monkeypatch):
    candidates[2].update(product.access_url for product in candidates[0])
    monkeypatch.setattr(service, "MAX_FILE_CHECKS", 2)
    data = post(client)
    assert data["cached_file_checks"] == 2 and data["pending_count"] == 3
    assert data["search_complete"] is False


def test_pair_listing_limit_is_separate_from_search_completeness(
    client, candidates, monkeypatch
):
    candidates[2].update(product.access_url for product in candidates[0])
    monkeypatch.setattr(service, "MAX_PAIRS", 1)
    data = post(client)
    assert data["pairs_count"] > 1 and len(data["pairs"]) == 1
    assert data["pairs_truncated"] is True and data["search_complete"] is True


@pytest.mark.parametrize(
    "override",
    [
        {"ra": 360},
        {"dec": 91},
        {"candidate_limit": 1},
        {"candidate_limit": 65},
        {"detector": "D7"},
        {"from_date": "2025-03-01", "to_date": "2025-02-01"},
        {"to_date": "9999-12-31"},
        {"retry_failed": True},
        {"unexpected": "value"},
    ],
)
def test_invalid_requests_do_not_query_or_download(client, candidates, override):
    assert (
        client.post("/api/compare/matches", json={**PAYLOAD, **override}).status_code
        == 422
    )
    candidates[3].assert_not_called()
    client.app.state.fits_store.fetch.assert_not_called()


def metadata_table(products):
    return Table(
        rows=[
            (
                product.mjd_start,
                product.exptime_sec,
                product.band_name,
                product.wavelength_min_um * 1e-6,
                product.wavelength_max_um * 1e-6,
                product.access_url.replace("https://irsa.ipac.caltech.edu/", ""),
                product.artifact_id,
            )
            for product in products
        ],
        names=[
            "time_bounds_lower",
            "time_exposure",
            "energy_bandpassname",
            "energy_bounds_lower",
            "energy_bounds_upper",
            "uri",
            "artifactid",
        ],
    )


def test_archive_query_applies_bounded_detector_and_calendar_date_filters(
    candidates, monkeypatch
):
    result = Mock(query_status="OK")
    result.to_table.return_value = metadata_table(candidates[0])
    tap = Mock()
    tap.search.return_value = result
    monkeypatch.setattr(archive.pyvo.dal, "TAPService", Mock(return_value=tap))
    request = MatchRequest(
        **PAYLOAD,
        detector="D1",
        from_date="2025-01-01",
        to_date="2025-02-01",
        candidate_limit=6,
    )
    batch = archive.query_candidates(request)
    sql = tap.search.call_args.args[0]
    assert "SELECT TOP 7" in sql
    assert "p.energy_bandpassname = 'SPHEREx-D1'" in sql
    assert f"p.time_bounds_lower >= {float(Time('2025-01-01').mjd)!r}" in sql
    assert f"p.time_bounds_lower < {float(Time('2025-02-02').mjd)!r}" in sql
    assert tap.search.call_args.kwargs["maxrec"] == 7
    assert len(batch.observations) == 5


def test_reprocessed_products_are_not_counted_as_distinct_epochs(
    candidates, monkeypatch
):
    table = metadata_table(candidates[0])
    duplicate = list(table[0])
    duplicate[-1] = "another-artifact"
    table.add_row(duplicate)
    result = Mock(query_status="OK")
    result.to_table.return_value = table
    tap = Mock()
    tap.search.return_value = result
    monkeypatch.setattr(archive.pyvo.dal, "TAPService", Mock(return_value=tap))
    batch = archive.query_candidates(MatchRequest(**PAYLOAD, candidate_limit=6))
    assert len(batch.observations) == 5
    assert batch.duplicate_exposure_count == 1


def test_bad_metadata_schema_is_not_a_complete_empty_search(candidates, monkeypatch):
    result = Mock(query_status="OK")
    result.to_table.return_value = Table()
    tap = Mock()
    tap.search.return_value = result
    monkeypatch.setattr(archive.pyvo.dal, "TAPService", Mock(return_value=tap))
    with pytest.raises(InvalidArchiveResponse):
        archive.query_candidates(MatchRequest(**PAYLOAD))


def test_actual_header_dates_are_checked_against_requested_scope(client, candidates):
    candidates[2].update(product.access_url for product in candidates[0])
    data = post(client, from_date="2025-02-01", to_date="2025-03-01")
    assert data["verified_count"] == 2 and data["excluded_count"] == 3
    assert all(
        check["reason"] == "outside_dates"
        for check in data["checks"]
        if check["status"] == "excluded"
    )


def test_batch_time_budget_does_not_turn_pending_candidates_into_absence(
    client, monkeypatch
):
    monkeypatch.setattr(service, "BATCH_BUDGET_SECONDS", -1)
    data = post(client, advance=True)
    assert data["pending_count"] == 5 and data["new_download_attempts"] == 0
    assert data["status"] == "partial" and data["search_complete"] is False
    client.app.state.fits_store.fetch.assert_not_called()


def test_expired_search_refreshes_metadata_but_reuses_existing_files(
    client, candidates, monkeypatch
):
    monkeypatch.setattr("app.db.cache.time.time", lambda: 100.0)
    first = post(client, advance=True)
    assert first["verified_count"] == 2
    monkeypatch.setattr(
        "app.db.cache.time.time", lambda: 100.0 + service.STATE_TTL_SECONDS + 1
    )
    second = post(client)
    assert second["state_cached"] is False
    assert second["verified_count"] == 2 and second["new_download_attempts"] == 0
    assert candidates[3].call_count == 2


def test_progress_storage_failure_is_visible_without_inventing_results(
    client, candidates, monkeypatch
):
    candidates[2].update(product.access_url for product in candidates[0])
    monkeypatch.setattr(client.app.state.cache, "set", lambda *args: False)
    data = post(client)
    assert data["state_persisted"] is False
    assert data["verified_count"] == 5 and data["pairs_count"] > 0
    assert "could not be saved" in data["message"]


def test_same_time_observations_are_not_compatible_dates(client, candidates):
    products, files, cached_urls, _ = candidates
    with fits.open(files[products[1].access_url], mode="update", memmap=False) as hdus:
        hdus["IMAGE"].header["DATE-OBS"] = products[0].utc_date.rstrip("Z")
    products[1].utc_date = products[0].utc_date
    products[1].mjd_start = products[0].mjd_start
    cached_urls.update(product.access_url for product in products)
    data = post(client, candidate_limit=2)
    assert data["verified_count"] == 2 and data["pairs_count"] == 0
    assert data["metadata_truncated"] is True


def test_cache_misses_are_bounded_and_passive_scan_reaches_later_cached_files(
    client, candidates, monkeypatch
):
    monkeypatch.setattr(service, "MAX_FILE_CHECKS", 2)
    candidates[2].add(candidates[0][4].access_url)
    first = post(client)
    second = post(client)
    third = post(client)
    assert first["candidate_inspections"] == second["candidate_inspections"] == 2
    assert first["verified_count"] == second["verified_count"] == 0
    assert third["candidate_inspections"] <= 2
    assert third["verified_count"] == 1
    assert client.app.state.fits_store.get_cached.call_count <= 6
    client.app.state.fits_store.fetch.assert_not_called()


def test_matching_metadata_requests_have_a_bounded_read_window(monkeypatch):
    import requests

    request = Mock()
    monkeypatch.setattr(requests.Session, "request", request)
    with archive.MatchingSession() as session:
        session.get("https://example.invalid")
    assert request.call_args.kwargs["timeout"] == (5, 45)


def test_bounded_archive_subset_is_sorted_locally_by_observation_time(
    candidates, monkeypatch
):
    result = Mock(query_status="OK")
    result.to_table.return_value = metadata_table(list(reversed(candidates[0])))
    tap = Mock()
    tap.search.return_value = result
    monkeypatch.setattr(archive.pyvo.dal, "TAPService", Mock(return_value=tap))
    batch = archive.query_candidates(MatchRequest(**PAYLOAD, candidate_limit=6))
    assert [product.obs_id for product in batch.observations] == [
        product.obs_id for product in candidates[0]
    ]


@pytest.mark.parametrize(
    "failure", ["ReadTimeout", "ConnectTimeout", "ConnectionError"]
)
def test_real_pyvo_transport_failures_do_not_create_empty_or_poisoned_searches(
    candidates, monkeypatch, failure
):
    import requests

    # Exercise actual PyVO wrapping (including DALFormatError), not a stubbed
    # ArchiveUnavailable. No request is allowed to reach the network.
    transport = Mock(
        side_effect=getattr(requests.exceptions, failure)("test transport failure")
    )
    monkeypatch.setattr(requests.Session, "request", transport)
    monkeypatch.setattr(service, "query_candidates", archive.query_candidates)
    with TestClient(create_app()) as client:
        fetch = Mock(side_effect=AssertionError("Metadata failure downloaded FITS"))
        client.app.state.fits_store.fetch = fetch
        save = Mock(wraps=client.app.state.cache.set)
        client.app.state.cache.set = save
        response = client.post("/api/compare/matches", json=PAYLOAD)
        assert response.status_code == 503
        assert response.json() == {
            "detail": "IRSA metadata is unavailable. Try again later."
        }
        assert transport.call_count == 1
        save.assert_not_called()
        fetch.assert_not_called()

        # A subsequent successful metadata query must still run and report its
        # actual unchecked candidates, with no false absence cached by failure.
        result = Mock(query_status="OK")
        result.to_table.return_value = metadata_table(candidates[0][:2])
        tap = Mock()
        tap.search.return_value = result
        factory = Mock(return_value=tap)
        monkeypatch.setattr(archive.pyvo.dal, "TAPService", factory)
        recovered = client.post("/api/compare/matches", json=PAYLOAD)
        assert recovered.status_code == 200
        data = recovered.json()
        assert data["status"] == "partial" and data["candidate_count"] == 2
        assert data["pending_count"] == 2 and data["pairs_count"] == 0
        assert data["state_cached"] is False and data["state_persisted"] is True
        assert data["new_download_attempts"] == 0
        factory.assert_called_once()
        save.assert_called_once()
        fetch.assert_not_called()
