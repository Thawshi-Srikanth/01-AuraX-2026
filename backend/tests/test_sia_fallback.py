"""Offline contract checks; artificial rows are never application fallback data."""

from datetime import date
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from unittest.mock import Mock

import pytest
import pyvo
import requests
from astropy.io.votable import from_table
from astropy.table import Table
from fastapi.testclient import TestClient

from app.main import create_app
from app.schemas.comparison_matches import MatchRequest
from app.services import comparison_candidates, observations


@pytest.fixture
def sia(monkeypatch):
    raw = Table(
        rows=[
            (
                60001.0,
                90.0,
                "SPHEREx-D2",
                1.1e-6,
                1.6e-6,
                "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/fixture/v2/2/"
                "level2_fixture_002D2_spx_v2.fits",
            ),
            (
                60000.0,
                80.0,
                "SPHEREx-D1",
                0.75e-6,
                1.1e-6,
                "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/fixture/v1/1/"
                "level2_fixture_001D1_spx_v1.fits",
            ),
        ],
        names=[
            "t_min",
            "t_exptime",
            "energy_bandpassname",
            "em_min",
            "em_max",
            "access_url",
        ],
    )
    result = Mock(spec=pyvo.dal.SIA2Results, status=("OK", ""))
    result.to_table.return_value = raw
    search = Mock(return_value=result)
    factory = Mock(return_value=Mock(search=search))
    monkeypatch.setattr(observations.pyvo.dal, "SIA2Service", factory)
    monkeypatch.setattr(
        observations.pyvo.dal, "TAPService", Mock(side_effect=requests.Timeout)
    )
    return raw, result, search, factory


def test_failed_tap_uses_bounded_sia_and_records_real_source(sia):
    with TestClient(create_app()) as client:
        params = {"ra": 180, "dec": -15.5, "limit": 2}
        response = client.get("/api/observations", params=params)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success" and data["total_count"] == 2
        assert data["source_url"] == observations.IRSA_SIA_URL
        assert "SIA" in data["provenance"] and "TAP was unavailable" in data["message"]
        assert data["observations"][0]["mjd_start"] == 60000.0
        assert data["observations"][0]["wavelength_min_um"] == pytest.approx(0.75)
        assert data["observations"][0]["artifact_id"].endswith("spx_v1.fits")
        assert data["observations"][0]["wavelength_center_um"] is None
        cached = client.get("/api/observations", params=params).json()
        assert cached["cached"] and cached["source_url"] == data["source_url"]
    kwargs = sia[2].call_args.kwargs
    assert kwargs["POS"] == "CIRCLE 180.0 -15.5 0"
    assert kwargs["maxrec"] == 3
    assert set(kwargs["collection"]) == {
        "spherex_dr1",
        "spherex_qr3",
        "spherex_dr1_deep",
        "spherex_qr3_deep",
    }
    assert sia[3].call_args.kwargs["check_baseurl"] is False
    sia[2].assert_called_once()


def test_healthy_tap_does_not_call_sia(sia, monkeypatch):
    table = observations.query_sia(180.0, 0.0, 2)
    tap_result = Mock(query_status="OK")
    tap_result.to_table.return_value = table
    monkeypatch.setattr(
        observations.pyvo.dal,
        "TAPService",
        Mock(return_value=Mock(search=Mock(return_value=tap_result))),
    )
    sia[2].reset_mock()
    observations.query_archive(180.0, 0.0, 2)
    sia[2].assert_not_called()


def test_sia_schema_error_is_not_empty_coverage(sia):
    sia[1].to_table.return_value = Table()
    with TestClient(create_app()) as client:
        assert client.get("/api/observations?ra=180&dec=0").status_code == 502


def test_both_services_failing_is_not_cached(sia):
    sia[2].side_effect = requests.ConnectionError
    with TestClient(create_app()) as client:
        for _ in range(2):
            assert client.get("/api/observations?ra=180&dec=0").status_code == 503
    assert sia[2].call_count == 2


@pytest.mark.parametrize("overflow", [False, True])
def test_sia_empty_and_overflow_are_distinguished(sia, overflow):
    sia[1].to_table.return_value = sia[0][:0]
    sia[1].status = ("OVERFLOW" if overflow else "OK", "")
    with TestClient(create_app()) as client:
        data = client.get("/api/observations?ra=180&dec=0").json()
    assert data["status"] == ("partial" if overflow else "no_coverage")
    assert data["truncated"] is overflow


def test_bad_sia_rows_are_reported_as_partial(sia):
    sia[0]["t_min"][0] = float("nan")
    with TestClient(create_app()) as client:
        data = client.get("/api/observations?ra=180&dec=0").json()
    assert data["status"] == "partial" and data["rejected_count"] == 1


def test_comparison_fallback_preserves_detector_and_start_date_scope(sia):
    request = MatchRequest(
        ra=180,
        dec=0,
        detector="D2",
        from_date=date(2023, 2, 26),
        to_date=date(2023, 2, 26),
        candidate_limit=2,
    )
    batch = comparison_candidates.query_candidates(request)
    assert len(batch.observations) == 1
    assert batch.observations[0].detector == "D2"
    assert batch.observations[0].mjd_start == 60001.0
    assert batch.source_url == observations.IRSA_SIA_URL
    assert batch.fallback_notice
    assert sia[2].call_args.kwargs["TIME"] == "60001.0 60002.0"


@pytest.mark.parametrize(
    "start,end,expected",
    [
        (60001.0, 60002.0, "60001.0 60002.0"),
        (None, 60002.0, "-Inf 60002.0"),
        (60001.0, None, "60001.0 +Inf"),
    ],
)
def test_date_filters_pass_through_real_pyvo_query(sia, start, end, expected):
    observations.query_sia(180.0, 0.0, 2, start=start, end=end)
    # Exercise the actual query constructor; mocking search alone missed the
    # lowercase numeric-time conversion failure in live fallback searches.
    query = pyvo.dal.SIA2Query(observations.IRSA_SIA_URL, **sia[2].call_args.kwargs)
    assert query["TIME"] == [expected]


def test_filtered_overflow_cannot_claim_no_coverage(sia):
    sia[1].status = ("OVERFLOW", "")
    batch = comparison_candidates.query_candidates(
        MatchRequest(ra=180, dec=0, detector="D6", candidate_limit=2)
    )
    assert not batch.observations and batch.truncated


def test_actual_pyvo_sia_result_interface(sia):
    sia[2].return_value = pyvo.dal.SIA2Results(from_table(sia[0]))
    table = observations.query_archive(180.0, 0.0, 2)
    assert len(table) == 2 and table.meta["overflow"] is False


@pytest.mark.parametrize("recovers", [True, False])
def test_sia_proxy_retry_recovers_or_stops_after_two_requests(monkeypatch, recovers):
    calls = []

    class Proxy(BaseHTTPRequestHandler):
        def do_GET(self):
            calls.append(self.path)
            self.send_response(200 if recovers and len(calls) == 2 else 502)
            self.end_headers()

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Proxy)
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    url = f"http://127.0.0.1:{server.server_port}/SIA"
    monkeypatch.setattr(observations, "IRSA_SIA_URL", url)
    try:
        with observations.SiaSession() as session:
            session.trust_env = False
            if recovers:
                assert session.get(url).status_code == 200
            else:
                with pytest.raises(requests.RequestException):
                    session.get(url)
        assert calls == ["/SIA", "/SIA"]
    finally:
        server.shutdown()
        server.server_close()
        worker.join()
