"""Resolver contracts using explicitly synthetic catalog-response fixtures."""

from unittest.mock import Mock

import pytest
import requests
from astropy.table import MaskedColumn, Table
from fastapi.testclient import TestClient

from app.main import create_app
from app.services import resolver


@pytest.fixture
def catalog_table():
    return Table(
        rows=[
            (
                "Synthetic source",
                123.456789,
                -12.345678,
                "Star",
                1.25,
                -2.5,
                "fixture-coordinates",
                "fixture-motion",
            )
        ],
        names=[
            "main_id",
            "ra",
            "dec",
            "otype",
            "pmra",
            "pmdec",
            "coo_bibcode",
            "pm_bibcode",
        ],
    )


@pytest.fixture
def lookup(monkeypatch, catalog_table):
    lookup = Mock(return_value=catalog_table)
    monkeypatch.setattr(resolver, "query_simbad", lookup)
    return lookup


@pytest.fixture
def client(lookup):
    with TestClient(create_app()) as client:
        yield client


def test_name_resolution_and_persistent_reuse(client, lookup):
    response = client.get("/api/resolve", params={"target": " Fixture Object "})
    assert response.status_code == 200
    data = response.json()
    assert data["query"] == "Fixture Object"
    assert data["canonical_name"] == "Synthetic source"
    assert data["coordinates"]["ra_deg"] == 123.456789
    assert data["coordinates"]["dec_deg"] == -12.345678
    assert data["coordinates"]["ra_hms"].startswith("08h13m")
    assert data["coordinates"]["epoch"] is None
    assert data["proper_motion"]["pm_ra_mas_yr"] == 1.25
    assert data["coordinate_reference"] == "fixture-coordinates"
    assert data["retrieved_at"] is not None
    assert data["source_url"] == resolver.SIMBAD_URL
    assert data["aliases"] == []
    assert data["cached"] is False
    with TestClient(create_app()) as reopened:
        repeated = reopened.get("/api/resolve", params={"target": "fixture object"})
        assert repeated.status_code == 200
        assert repeated.json()["query"] == "fixture object"
        assert repeated.json()["cached"] is True
        assert repeated.json()["retrieved_at"] == data["retrieved_at"]
    lookup.assert_called_once_with("Fixture Object")


def test_unknown_is_not_cached(client, lookup, catalog_table):
    lookup.return_value = catalog_table[:0]
    for _ in range(2):
        assert (
            client.get("/api/resolve", params={"target": "Missing"}).status_code == 404
        )
    assert lookup.call_count == 2


def test_upstream_failure_is_distinct_from_not_found(client, lookup):
    lookup.side_effect = resolver.ResolverUnavailable
    response = client.get("/api/resolve", params={"target": "Any object"})
    assert response.status_code == 503
    assert "unavailable" in response.json()["detail"]


def test_ambiguous_response(client, lookup, catalog_table):
    catalog_table.add_row(catalog_table[0])
    assert client.get("/api/resolve", params={"target": "Ambiguous"}).status_code == 409


@pytest.mark.parametrize(
    "column,value",
    [("ra", 360.0), ("dec", 91.0), ("ra", float("nan")), ("main_id", "")],
)
def test_bad_catalog_data_is_not_a_match(client, catalog_table, column, value):
    catalog_table[column][0] = value
    assert client.get("/api/resolve", params={"target": "Bad data"}).status_code == 502


def test_masked_optional_values_are_null(client, catalog_table):
    for field in ["pmra", "pmdec", "pm_bibcode"]:
        catalog_table.replace_column(
            field, MaskedColumn(catalog_table[field], mask=[True])
        )
    response = client.get("/api/resolve", params={"target": "No motion"})
    assert response.status_code == 200
    assert response.json()["proper_motion"] is None


def test_partial_motion_preserves_missing_component(client, catalog_table):
    catalog_table.replace_column("pmra", MaskedColumn([0.0], mask=[True]))
    response = client.get("/api/resolve", params={"target": "Partial motion"})
    assert response.status_code == 200
    assert response.json()["proper_motion"]["pm_ra_mas_yr"] is None
    assert response.json()["proper_motion"]["pm_dec_mas_yr"] == -2.5


def test_manual_coordinates_do_not_query_catalog(client, lookup):
    response = client.get("/api/resolve", params={"ra": 180, "dec": -15.5})
    assert response.status_code == 200
    data = response.json()
    assert data["coordinates"]["ra_deg"] == 180
    assert data["coordinates"]["ra_hms"].startswith("12h00m")
    assert data["proper_motion"] is None
    assert data["source_url"] is None
    assert data["retrieved_at"] is None
    assert "User-supplied" in data["provenance"]
    lookup.assert_not_called()


@pytest.mark.parametrize(
    "params,status",
    [
        ({}, 400),
        ({"target": " "}, 400),
        ({"ra": 10}, 400),
        ({"target": "Fixture", "ra": 1, "dec": 2}, 400),
        ({"target": "bad\x00name"}, 400),
        ({"target": "a" * 201}, 422),
        ({"ra": -1, "dec": 0}, 422),
        ({"ra": 360, "dec": 0}, 422),
        ({"ra": 10, "dec": 91}, 422),
        ({"ra": "nan", "dec": 0}, 422),
        ({"ra": 10, "dec": "inf"}, 422),
    ],
)
def test_invalid_input_does_not_query_catalog(client, lookup, params, status):
    assert client.get("/api/resolve", params=params).status_code == status
    lookup.assert_not_called()


def test_expired_resolution_is_refreshed(client, lookup, monkeypatch):
    monkeypatch.setattr("app.db.cache.time.time", lambda: 100.0)
    assert client.get("/api/resolve", params={"target": "Fixture"}).status_code == 200
    monkeypatch.setattr(
        "app.db.cache.time.time", lambda: 100 + resolver.CACHE_TTL_SECONDS
    )
    response = client.get("/api/resolve", params={"target": "Fixture"})
    assert response.status_code == 200
    assert response.json()["cached"] is False
    assert lookup.call_count == 2


def test_unusable_cached_payload_is_refreshed(client, lookup):
    client.app.state.cache.set("fixture", {"invalid": True}, resolver.CACHE_NAMESPACE)
    response = client.get("/api/resolve", params={"target": "Fixture"})
    assert response.status_code == 200
    assert response.json()["cached"] is False
    lookup.assert_called_once()


def test_cache_write_failure_does_not_hide_catalog_result(client, monkeypatch):
    monkeypatch.setattr(client.app.state.cache, "set", lambda *args: False)
    assert client.get("/api/resolve", params={"target": "Fixture"}).status_code == 200


def test_adql_escapes_names(monkeypatch, catalog_table):
    service = Mock()
    service.search.return_value.to_table.return_value = catalog_table
    factory = Mock(return_value=service)
    monkeypatch.setattr(resolver.pyvo.dal, "TAPService", factory)
    assert resolver.query_simbad("Barnard's star") is catalog_table
    assert "WHERE i.id = 'Barnard''s star'" in service.search.call_args.args[0]
    assert "SELECT TOP 2" in service.search.call_args.args[0]
    assert isinstance(factory.call_args.kwargs["session"], resolver.TimeoutSession)


def test_transport_timeout_is_service_unavailable(monkeypatch):
    monkeypatch.setattr(
        resolver.pyvo.dal, "TAPService", Mock(side_effect=requests.Timeout)
    )
    with pytest.raises(resolver.ResolverUnavailable):
        resolver.query_simbad("Fixture")


def test_network_requests_have_timeouts(monkeypatch):
    request = Mock()
    monkeypatch.setattr(requests.Session, "request", request)
    with resolver.TimeoutSession() as session:
        session.get("https://example.invalid")
    assert request.call_args.kwargs["timeout"] == (5, 15)


def test_mirror_fallback_records_actual_source(monkeypatch, catalog_table, tmp_path):
    service = Mock()
    service.search.return_value.to_table.return_value = catalog_table
    factory = Mock(side_effect=[requests.Timeout, service])
    monkeypatch.setattr(resolver.pyvo.dal, "TAPService", factory)
    cache = resolver.CacheManager(tmp_path / "mirror.db")
    result = resolver.resolve_name("Fixture", cache)
    assert result.source_url == resolver.SIMBAD_URLS[1]
    assert factory.call_args_list[0].args[0] == resolver.SIMBAD_URLS[0]
    assert factory.call_args_list[1].args[0] == resolver.SIMBAD_URLS[1]
    assert resolver.resolve_name("Fixture", cache).cached is True
    assert factory.call_count == 2


def test_empty_response_does_not_trigger_mirror(monkeypatch, catalog_table):
    service = Mock()
    service.search.return_value.to_table.return_value = catalog_table[:0]
    factory = Mock(return_value=service)
    monkeypatch.setattr(resolver.pyvo.dal, "TAPService", factory)
    assert len(resolver.query_simbad("Missing")) == 0
    factory.assert_called_once()
