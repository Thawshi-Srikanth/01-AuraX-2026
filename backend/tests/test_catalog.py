"""Catalog queries use explicit synthetic records, never fabricated app fallbacks."""

from unittest.mock import Mock

import pytest
import requests
from astropy.table import MaskedColumn, Table
from fastapi.testclient import TestClient

from app.main import create_app
from app.services import catalog as service

PARAMS = {"ra": 100, "dec": 20}


@pytest.fixture
def catalog_table():
    table = Table(
        rows=[
            (
                "Fixture distant",
                100.01,
                20.005,
                "Star",
                1.0,
                2.0,
                "fixture-pos",
                "fixture-pm",
            ),
            (
                "Fixture central",
                100.0,
                20.0,
                "Galaxy",
                0.0,
                0.0,
                "fixture-pos",
                "fixture-pm",
            ),
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
    table["object_type_label"] = ["Star", "Galaxy"]
    table.meta["source_url"] = service.SIMBAD_URLS[0]
    return table


@pytest.fixture
def query(monkeypatch, catalog_table):
    query = Mock(return_value=catalog_table)
    monkeypatch.setattr(service, "query_catalog", query)
    return query


@pytest.fixture
def client(query):
    with TestClient(create_app()) as client:
        client.app.state.fits_store.fetch = Mock(
            side_effect=AssertionError("Catalog must not fetch images")
        )
        yield client
        client.app.state.fits_store.fetch.assert_not_called()


def test_real_record_contract_distance_order_and_persistent_cache(client, query):
    response = client.get("/api/catalog/sources", params=PARAMS)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["sources_count"] == 2
    assert data["cached"] is False
    assert data["truncated"] is False
    first, second = data["sources"]
    assert first["id"] == "Fixture central"
    assert first["name"] == first["id"]
    assert first["distance_arcsec"] == pytest.approx(0)
    assert second["distance_arcsec"] > 30
    assert second["proper_motion"]["pm_ra_mas_yr"] == 1
    assert second["coordinate_reference"] == "fixture-pos"
    assert data["proper_motion_applied"] is False
    assert data["image_match_verified"] is False
    assert data["coordinate_epoch"] is None
    assert "pixel_x" not in first and "brightness_rank" not in first
    with TestClient(create_app()) as reopened:
        cached = reopened.get("/api/catalog/sources", params=PARAMS).json()
        assert cached["cached"] is True
        assert cached["retrieved_at"] == data["retrieved_at"]
        assert cached["sources"] == data["sources"]
    query.assert_called_once_with(100.0, 20.0, 3, 50)


def test_missing_motion_and_reference_values_remain_null(client, catalog_table):
    for column in ["pmra", "pmdec", "coo_bibcode", "pm_bibcode"]:
        catalog_table.replace_column(
            column, MaskedColumn(catalog_table[column], mask=True)
        )
    data = client.get("/api/catalog/sources", params=PARAMS).json()
    assert all(source["proper_motion"] is None for source in data["sources"])
    assert all(source["coordinate_reference"] is None for source in data["sources"])


def test_partial_proper_motion_does_not_fill_missing_component(client, catalog_table):
    catalog_table.replace_column("pmra", MaskedColumn(catalog_table["pmra"], mask=True))
    data = client.get("/api/catalog/sources", params=PARAMS).json()
    assert data["sources"][0]["proper_motion"]["pm_ra_mas_yr"] is None
    assert data["sources"][0]["proper_motion"]["pm_dec_mas_yr"] == 0


def test_limit_is_explicit_not_catalog_total(client):
    data = client.get("/api/catalog/sources", params={**PARAMS, "limit": 1}).json()
    assert data["sources_count"] == 1
    assert data["truncated"] is True
    assert "limited subset" in data["message"]


def test_server_overflow_is_not_hidden(client, catalog_table):
    catalog_table.meta["overflow"] = True
    assert client.get("/api/catalog/sources", params=PARAMS).json()["truncated"] is True


def test_valid_empty_result_does_not_create_sources_or_cache_absence(
    client, query, catalog_table
):
    query.return_value = catalog_table[:0]
    for _ in range(2):
        response = client.get("/api/catalog/sources", params=PARAMS)
        assert response.status_code == 200
        assert response.json()["status"] == "no_sources"
        assert response.json()["sources"] == []
    assert query.call_count == 2


@pytest.mark.parametrize(
    "column,value",
    [
        ("ra", float("nan")),
        ("ra", 360.0),
        ("dec", 91.0),
        ("main_id", ""),
        ("ra", 200.0),
    ],
)
def test_invalid_or_out_of_cone_records_are_partial_and_not_cached(
    client, query, catalog_table, column, value
):
    catalog_table[column][0] = value
    for _ in range(2):
        data = client.get("/api/catalog/sources", params=PARAMS).json()
        assert data["status"] == "partial"
        assert data["sources_count"] == 1
        assert data["rejected_count"] == 1
        assert data["cached"] is False
    assert query.call_count == 2


def test_all_invalid_is_partial_not_no_sources(client, catalog_table):
    catalog_table["ra"] = [200.0, 200.0]
    data = client.get("/api/catalog/sources", params=PARAMS).json()
    assert data["status"] == "partial"
    assert data["sources_count"] == 0
    assert data["rejected_count"] == 2


def test_duplicate_identifiers_are_not_repeated(client, catalog_table):
    catalog_table["main_id"][0] = catalog_table["main_id"][1]
    data = client.get("/api/catalog/sources", params=PARAMS).json()
    assert data["sources_count"] == 1
    assert data["status"] == "partial"


def test_ra_wrap_uses_spherical_separation(client, catalog_table):
    catalog_table["ra"] = [359.999, 0.001]
    catalog_table["dec"] = [0.0, 0.0]
    data = client.get(
        "/api/catalog/sources", params={"ra": 0, "dec": 0, "radius_arcmin": 0.1}
    ).json()
    assert data["status"] == "success"
    assert all(
        source["distance_arcsec"] == pytest.approx(3.6, abs=1e-6)
        for source in data["sources"]
    )


def test_polar_search_uses_great_circle_distance(client, query, catalog_table):
    query.return_value = catalog_table[:1]
    query.return_value["ra"][0] = 180
    query.return_value["dec"][0] = 89.999
    data = client.get("/api/catalog/sources", params={"ra": 0, "dec": 89.999}).json()
    assert data["status"] == "success"
    assert data["sources"][0]["distance_arcsec"] == pytest.approx(7.2, abs=1e-6)


def test_schema_failure_is_not_no_sources(client, query):
    query.return_value = Table()
    assert client.get("/api/catalog/sources", params=PARAMS).status_code == 502


def test_service_failure_is_not_no_sources(client, query):
    query.side_effect = service.CatalogUnavailable
    response = client.get("/api/catalog/sources", params=PARAMS)
    assert response.status_code == 503
    assert set(response.json()) == {"detail"}


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"ra": 100},
        {"ra": -1, "dec": 0},
        {"ra": 360, "dec": 0},
        {"ra": "nan", "dec": 0},
        {"ra": 100, "dec": 91},
        {**PARAMS, "radius_arcmin": 0},
        {**PARAMS, "radius_arcmin": 31},
        {**PARAMS, "radius_arcmin": "inf"},
        {**PARAMS, "limit": 0},
        {**PARAMS, "limit": 201},
    ],
)
def test_invalid_parameters_skip_catalog(client, query, params):
    assert client.get("/api/catalog/sources", params=params).status_code == 422
    query.assert_not_called()


def test_exact_scopes_do_not_share_cached_results(client, query):
    for ra, radius, limit in [
        (100.00001, 3, 50),
        (100.00002, 3, 50),
        (100.00001, 2, 50),
        (100.00001, 3, 1),
    ]:
        assert (
            client.get(
                "/api/catalog/sources",
                params={"ra": ra, "dec": 20, "radius_arcmin": radius, "limit": limit},
            ).status_code
            == 200
        )
    assert query.call_count == 4


def test_expired_catalog_results_refresh(client, query, monkeypatch):
    monkeypatch.setattr("app.db.cache.time.time", lambda: 100.0)
    client.get("/api/catalog/sources", params=PARAMS)
    monkeypatch.setattr(
        "app.db.cache.time.time", lambda: 100 + service.CACHE_TTL_SECONDS
    )
    assert client.get("/api/catalog/sources", params=PARAMS).json()["cached"] is False
    assert query.call_count == 2


def test_mirror_fallback_preserves_actual_endpoint_and_query_bound(
    monkeypatch, catalog_table
):
    result = Mock(query_status="OK")
    result.to_table.return_value = catalog_table
    tap = Mock()
    tap.search.return_value = result
    factory = Mock(side_effect=[requests.Timeout, tap])
    monkeypatch.setattr(service.pyvo.dal, "TAPService", factory)
    table = service.query_catalog(100.0, 20.0, 3.0, 50)
    assert table.meta["source_url"] == service.SIMBAD_URLS[1]
    query = tap.search.call_args.args[0]
    assert "SELECT TOP 51" in query
    assert "LEFT JOIN otypedef AS t ON b.otype = t.otype" in query
    assert "t.description AS object_type_label" in query
    assert "CIRCLE('ICRS', 100.0, 20.0, 0.05)" in query
    assert "ORDER BY separation_deg ASC, main_id ASC" in query
    assert tap.search.call_args.kwargs["maxrec"] == 51
    assert factory.call_count == 2


def test_empty_catalog_result_does_not_trigger_mirror(monkeypatch, catalog_table):
    result = Mock(query_status="OK")
    result.to_table.return_value = catalog_table[:0]
    tap = Mock()
    tap.search.return_value = result
    factory = Mock(return_value=tap)
    monkeypatch.setattr(service.pyvo.dal, "TAPService", factory)
    assert len(service.query_catalog(100.0, 20.0, 3.0, 50)) == 0
    factory.assert_called_once()


def test_distinct_catalog_records_at_same_position_are_preserved(client, catalog_table):
    catalog_table["ra"] = [100.0, 100.0]
    catalog_table["dec"] = [20.0, 20.0]
    data = client.get("/api/catalog/sources", params=PARAMS).json()
    assert data["sources_count"] == 2
    assert len({source["id"] for source in data["sources"]}) == 2
    assert all(source["distance_arcsec"] == 0 for source in data["sources"])
    assert data["image_match_verified"] is False


def test_classification_description_is_preserved_separately_from_code(
    client, catalog_table
):
    catalog_table["otype"] = ["Pl", "BY*"]
    catalog_table["object_type_label"] = ["Extra-solar Planet", "BY Dra Variable"]
    data = client.get("/api/catalog/sources", params=PARAMS).json()
    labels = {
        source["object_type"]: source["object_type_label"] for source in data["sources"]
    }
    assert labels == {"Pl": "Extra-solar Planet", "BY*": "BY Dra Variable"}


def test_unknown_classification_is_not_guessed(client, catalog_table):
    catalog_table["otype"] = ["UnknownCode", "OtherCode"]
    catalog_table.replace_column("object_type_label", MaskedColumn(["", ""], mask=True))
    data = client.get("/api/catalog/sources", params=PARAMS).json()
    assert all(source["object_type_label"] is None for source in data["sources"])
    assert {source["object_type"] for source in data["sources"]} == {
        "UnknownCode",
        "OtherCode",
    }


def test_shared_position_group_preserves_all_records_and_raw_astrometry(
    client, query, catalog_table
):
    # Five synthetic records mimic the shared-coordinate shape, not real detections.
    table = Table(
        rows=[
            (
                "Fixture host",
                100.0,
                20.0,
                "BY*",
                1.0,
                2.0,
                "fixture-pos",
                "fixture-pm",
                "BY Dra Variable",
            ),
            *[
                (
                    f"Fixture planet {letter}",
                    100.0,
                    20.0,
                    "Pl",
                    1.0,
                    2.0,
                    "fixture-pos",
                    "fixture-pm",
                    "Extra-solar Planet",
                )
                for letter in "bcde"
            ],
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
            "object_type_label",
        ],
    )
    table.meta = dict(catalog_table.meta)
    query.return_value = table
    data = client.get("/api/catalog/sources", params=PARAMS).json()
    assert data["sources_count"] == 5
    assert data["distinct_positions_count"] == 1
    assert len(data["shared_position_groups"]) == 1
    group = data["shared_position_groups"][0]
    assert group["records_count"] == 5
    assert set(group["member_ids"]) == {source["id"] for source in data["sources"]}
    assert all(source["position_group_id"] == group["id"] for source in data["sources"])
    assert all(
        source["proper_motion"]["pm_ra_mas_yr"] == 1.0 for source in data["sources"]
    )
    assert all(source["ra_deg"] == 100 for source in data["sources"])
    assert "unverified" in group["meaning"]
    assert "host_id" not in group
    assert data["image_match_verified"] is False
    assert "5 catalog records" in data["message"]
    assert "1 distinct reported position" in data["message"]
    with TestClient(create_app()) as reopened:
        cached = reopened.get("/api/catalog/sources", params=PARAMS).json()
        assert cached["cached"] is True
        assert cached["shared_position_groups"] == data["shared_position_groups"]
        assert cached["sources"] == data["sources"]
    query.assert_called_once()


def test_nearby_but_unequal_coordinates_are_not_grouped(client, catalog_table):
    catalog_table["ra"] = [100.0, 100.0000000001]
    catalog_table["dec"] = [20.0, 20.0]
    data = client.get("/api/catalog/sources", params=PARAMS).json()
    assert data["distinct_positions_count"] == 2
    assert data["shared_position_groups"] == []
    assert all(source["position_group_id"] is None for source in data["sources"])


def test_group_membership_covers_only_returned_records(client, catalog_table):
    catalog_table["ra"] = [100.0, 100.0]
    catalog_table["dec"] = [20.0, 20.0]
    data = client.get("/api/catalog/sources", params={**PARAMS, "limit": 1}).json()
    assert data["truncated"] is True
    assert data["sources_count"] == data["distinct_positions_count"] == 1
    assert data["shared_position_groups"] == []
    assert "incomplete" in data["grouping_scope"]


def test_legacy_cache_does_not_hide_new_classification_and_group_fields(client, query):
    import json

    # Recreate the prior response at the exact request key and old namespace.
    response = client.get("/api/catalog/sources", params=PARAMS).json()
    legacy = dict(response)
    for field in [
        "distinct_positions_count",
        "shared_position_groups",
        "grouping_method",
        "grouping_scope",
    ]:
        legacy.pop(field)
    legacy["sources"] = [
        {
            key: value
            for key, value in source.items()
            if key not in {"object_type_label", "position_group_id"}
        }
        for source in response["sources"]
    ]
    key = json.dumps([100.0, 20.0, 3, 50], separators=(",", ":"))
    cache = client.app.state.cache
    assert cache.delete(key, service.CACHE_NAMESPACE)
    assert cache.set(key, legacy, "catalog:v1")
    query.reset_mock()
    data = client.get("/api/catalog/sources", params=PARAMS).json()
    assert data["cached"] is False
    assert "shared_position_groups" in data
    assert "object_type_label" in data["sources"][0]
    assert cache.get(key, "catalog:v1") == legacy
    query.assert_called_once()
