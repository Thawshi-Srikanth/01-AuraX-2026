"""Observation contracts using synthetic, explicitly labelled archive metadata."""

from unittest.mock import Mock

import pytest
import requests
from astropy.table import MaskedColumn, Table
from fastapi.testclient import TestClient

from app.main import create_app
from app.services import observations as service


@pytest.fixture
def archive_table():
    # These are artificial product identifiers, not real archive observations.
    table = Table(
        rows=[
            (
                60000.0,
                100.0,
                "SPHEREx-D1",
                0.75e-6,
                1.1e-6,
                "ibe/data/spherex/dr1/level2/fixture/v1/1/level2_fixture_001D1_spx_v1.fits",
                "fixture-artifact-1",
            ),
            (
                60001.0,
                110.0,
                "SPHEREx-D2",
                1.1e-6,
                1.6e-6,
                "ibe/data/spherex/qr3/level2/fixture/v2/1/level2_fixture_001D2_spx_v2.fits",
                "fixture-artifact-2",
            ),
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
    return table


@pytest.fixture
def query(monkeypatch, archive_table):
    query = Mock(return_value=archive_table)
    monkeypatch.setattr(service, "query_archive", query)
    return query


@pytest.fixture
def client(query):
    with TestClient(create_app()) as client:
        yield client


def test_metadata_conversion_and_persistent_reuse(client, query):
    response = client.get("/api/observations", params={"ra": 180, "dec": -15.5})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["total_count"] == 2
    assert data["truncated"] is False
    assert data["cached"] is False
    assert data["detectors_available"] == ["D1", "D2"]
    assert data["distinct_dates"] == ["2023-02-25", "2023-02-26"]
    first = data["observations"][0]
    assert first["artifact_id"] == "fixture-artifact-1"
    assert first["obs_id"] == "fixture_001"
    assert first["detector"] == "D1"
    assert first["release"] == "dr1"
    assert first["processing_version"] == "v1"
    assert first["utc_date"] == "2023-02-25T00:00:00.000Z"
    assert first["wavelength_min_um"] == pytest.approx(0.75)
    assert first["wavelength_max_um"] == pytest.approx(1.1)
    assert first["wavelength_center_um"] is None
    assert first["exptime_sec"] == 100
    assert first["access_url"].startswith("https://irsa.ipac.caltech.edu/ibe/")
    with TestClient(create_app()) as reopened:
        repeat = reopened.get("/api/observations", params={"ra": 180, "dec": -15.5})
        assert repeat.json()["cached"] is True
        assert repeat.json()["retrieved_at"] == data["retrieved_at"]
    query.assert_called_once_with(180.0, -15.5, 100)


def test_limit_is_not_an_archive_total(client):
    data = client.get(
        "/api/observations", params={"ra": 180, "dec": 0, "limit": 1}
    ).json()
    assert data["total_count"] == 1
    assert len(data["observations"]) == 1
    assert data["truncated"] is True
    assert "limited subset" in data["message"]


def test_server_overflow_is_not_hidden(client, archive_table):
    archive_table.meta["overflow"] = True
    data = client.get("/api/observations", params={"ra": 180, "dec": 0}).json()
    assert data["truncated"] is True


def test_no_coverage_is_not_cached(client, query, archive_table):
    query.return_value = archive_table[:0]
    for _ in range(2):
        response = client.get("/api/observations", params={"ra": 180, "dec": 0})
        assert response.status_code == 200
        assert response.json()["status"] == "no_coverage"
        assert response.json()["total_count"] == 0
    assert query.call_count == 2


def test_upstream_failure_is_not_no_coverage(client, query):
    query.side_effect = service.ArchiveUnavailable
    response = client.get("/api/observations", params={"ra": 180, "dec": 0})
    assert response.status_code == 503
    assert "unavailable" in response.json()["detail"]


def test_bad_schema_is_not_no_coverage(client, query):
    query.return_value = Table()
    assert (
        client.get("/api/observations", params={"ra": 180, "dec": 0}).status_code == 502
    )


@pytest.mark.parametrize(
    "column,value",
    [
        ("time_bounds_lower", float("nan")),
        ("time_exposure", -1),
        ("energy_bounds_lower", -1e-6),
        ("energy_bounds_upper", 0.1e-6),
        ("energy_bandpassname", "SPHEREx-D6"),
        ("uri", "https://untrusted.example/level2.fits"),
        ("uri", "ibe/data/spherex/dr1/level2/../level2_fixtureD1_spx_v1.fits"),
    ],
)
def test_bad_rows_produce_partial_results(client, query, archive_table, column, value):
    archive_table[column][0] = value
    for _ in range(2):
        data = client.get("/api/observations", params={"ra": 180, "dec": 0}).json()
        assert data["status"] == "partial"
        assert data["total_count"] == 1
        assert data["rejected_count"] == 1
        assert data["cached"] is False
    assert query.call_count == 2


def test_no_usable_rows_is_partial_not_no_coverage(client, archive_table):
    archive_table["energy_bounds_lower"] = [-1.0, -1.0]
    data = client.get("/api/observations", params={"ra": 180, "dec": 0}).json()
    assert data["status"] == "partial"
    assert data["total_count"] == 0
    assert data["rejected_count"] == 2


def test_missing_optional_exposure_is_null(client, archive_table):
    archive_table.replace_column("time_exposure", MaskedColumn([0.0, 0.0], mask=True))
    data = client.get("/api/observations", params={"ra": 180, "dec": 0}).json()
    assert data["status"] == "success"
    assert all(obs["exptime_sec"] is None for obs in data["observations"])


def test_distinct_artifacts_are_preserved(client, archive_table):
    archive_table["uri"][1] = archive_table["uri"][0]
    archive_table["energy_bandpassname"][1] = "SPHEREx-D1"
    data = client.get("/api/observations", params={"ra": 180, "dec": 0}).json()
    assert data["total_count"] == 2
    assert data["observations"][0]["obs_id"] == data["observations"][1]["obs_id"]
    assert len({obs["artifact_id"] for obs in data["observations"]}) == 2


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"ra": 10},
        {"ra": -1, "dec": 0},
        {"ra": 360, "dec": 0},
        {"ra": 1, "dec": 91},
        {"ra": "nan", "dec": 0},
        {"ra": 1, "dec": "inf"},
        {"ra": 1, "dec": 0, "limit": 0},
        {"ra": 1, "dec": 0, "limit": 501},
    ],
)
def test_invalid_parameters_skip_archive(client, query, params):
    assert client.get("/api/observations", params=params).status_code == 422
    query.assert_not_called()


def test_precise_positions_and_limits_have_separate_cache_keys(client, query):
    for ra, limit in [(10.00001, 100), (10.00002, 100), (10.00001, 1)]:
        assert (
            client.get(
                "/api/observations", params={"ra": ra, "dec": 0, "limit": limit}
            ).status_code
            == 200
        )
    assert query.call_count == 3


def test_expired_metadata_refreshes(client, query, monkeypatch):
    monkeypatch.setattr("app.db.cache.time.time", lambda: 100.0)
    client.get("/api/observations", params={"ra": 1, "dec": 0})
    monkeypatch.setattr(
        "app.db.cache.time.time", lambda: 100 + service.CACHE_TTL_SECONDS
    )
    data = client.get("/api/observations", params={"ra": 1, "dec": 0}).json()
    assert data["cached"] is False
    assert query.call_count == 2


def test_query_is_bounded_and_uses_current_tables(monkeypatch, archive_table):
    result = Mock(query_status="OVERFLOW")
    result.to_table.return_value = archive_table
    tap = Mock()
    tap.search.return_value = result
    factory = Mock(return_value=tap)
    monkeypatch.setattr(service.pyvo.dal, "TAPService", factory)
    table = service.query_archive(12.123456789, -1.5, 24)
    query = tap.search.call_args.args[0]
    assert "SELECT TOP 25" in query
    assert "spherex.artifact" in query and "spherex.plane" in query
    assert "12.123456789" in query
    assert "ORDER BY p.time_bounds_lower ASC, a.artifactid ASC" in query
    assert tap.search.call_args.kwargs["maxrec"] == 25
    assert table.meta["overflow"] is True
    factory.assert_called_once()


def test_archive_timeout_is_unavailable(monkeypatch):
    monkeypatch.setattr(
        service.pyvo.dal, "TAPService", Mock(side_effect=requests.Timeout)
    )
    monkeypatch.setattr(
        service.pyvo.dal, "SIA2Service", Mock(side_effect=requests.Timeout)
    )
    with pytest.raises(service.ArchiveUnavailable):
        service.query_archive(10.0, 0.0, 1)


def test_archive_requests_have_timeouts(monkeypatch):
    request = Mock()
    monkeypatch.setattr(requests.Session, "request", request)
    with service.IrsaSession() as session:
        session.get("https://example.invalid")
    assert request.call_args.kwargs["timeout"] == (5, 30)
