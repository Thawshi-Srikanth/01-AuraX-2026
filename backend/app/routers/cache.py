"""Read-only runtime cache usage; cleanup remains an internal storage operation."""

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/cache", tags=["Cache"])


@router.get("/status")
def cache_status(request: Request):
    try:
        return request.app.state.fits_store.status()
    except OSError as error:
        raise HTTPException(503, "Cache status is unavailable.") from error
