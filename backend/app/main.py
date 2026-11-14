"""Application entry point, with no archive requests during startup."""

import os
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.db.cache import CacheManager
from app.routers.cutout import router as cutout_router
from app.routers.observations import router as observations_router
from app.routers.resolve import router as resolve_router
from app.services.fits_download import FitsStore

VERSION = "0.1.0"
DEFAULT_CACHE_PATH = Path(__file__).resolve().parents[1] / "cache" / "aurax.db"
DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


def allowed_origins() -> list[str]:
    origins = []
    for value in os.getenv("CORS_ORIGINS", DEFAULT_ORIGINS).split(","):
        origin = value.strip()
        if not origin:
            continue
        parsed = urlsplit(origin)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or parsed.query
            or parsed.fragment
            or "*" in origin
        ):
            raise ValueError("CORS_ORIGINS must contain HTTP(S) origins only")
        try:
            parsed.port
        except ValueError as error:
            raise ValueError("Invalid port in CORS_ORIGINS") from error
        if origin not in origins:
            origins.append(origin)
    return origins


@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.cache = CacheManager(
        os.getenv("CACHE_DB_PATH", str(DEFAULT_CACHE_PATH))
    )
    application.state.fits_store = FitsStore(
        os.getenv(
            "FITS_CACHE_DIR", str(application.state.cache.db_path.parent / "fits")
        )
    )
    yield


def create_app() -> FastAPI:
    application = FastAPI(
        title="AURAx API",
        description="Scientific API for SPHEREx observations.",
        version=VERSION,
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins(),
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["Accept", "Content-Type"],
    )

    application.include_router(resolve_router)
    application.include_router(observations_router)
    application.include_router(cutout_router)

    @application.get("/health", response_model=HealthResponse, tags=["Health"])
    async def health() -> HealthResponse:
        return HealthResponse(status="healthy", service="AURAx API", version=VERSION)

    return application


app = create_app()
