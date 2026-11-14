"""Verify the public API foundation without external services."""

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


def test_health_and_api_contract(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    with TestClient(create_app()) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {
            "status": "healthy",
            "service": "AURAx API",
            "version": "0.1.0",
        }
        schema = client.get("/openapi.json").json()
        assert set(schema["paths"]) == {"/health", "/api/resolve"}
        assert client.get("/api/observations").status_code == 404


@pytest.mark.parametrize(
    ("configuration", "origin", "allowed"),
    [
        (None, "http://localhost:5173", True),
        (None, "https://untrusted.example", False),
        (
            " https://aurax.example ,https://second.example",
            "https://aurax.example",
            True,
        ),
        ("https://aurax.example", "http://localhost:5173", False),
        ("", "http://localhost:5173", False),
    ],
)
def test_browser_origin_configuration(monkeypatch, configuration, origin, allowed):
    if configuration is None:
        monkeypatch.delenv("CORS_ORIGINS", raising=False)
    else:
        monkeypatch.setenv("CORS_ORIGINS", configuration)
    with TestClient(create_app()) as client:
        response = client.options(
            "/health",
            headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
        )
        assert response.status_code == (200 if allowed else 400)
        assert response.headers.get("access-control-allow-origin") == (
            origin if allowed else None
        )


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "https://*.example",
        "https://example/path",
        "https://user:password@example",
        "https://example:invalid",
        "file:///tmp",
    ],
)
def test_invalid_origins_fail_at_startup(monkeypatch, origin):
    monkeypatch.setenv("CORS_ORIGINS", origin)
    with pytest.raises(ValueError):
        create_app()
