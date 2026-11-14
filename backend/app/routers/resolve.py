"""Name lookup or validation of an explicit ICRS coordinate pair."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request

from app.schemas.target import ResolvedTarget
from app.services.resolver import (
    AmbiguousTarget,
    InvalidCatalogResponse,
    ResolverUnavailable,
    format_coordinates,
    resolve_name,
)

router = APIRouter(prefix="/api", tags=["Targets"])


@router.get("/resolve", response_model=ResolvedTarget)
def resolve_target(
    request: Request,
    target: Annotated[str | None, Query(max_length=200)] = None,
    ra: Annotated[float | None, Query(ge=0, lt=360, allow_inf_nan=False)] = None,
    dec: Annotated[float | None, Query(ge=-90, le=90, allow_inf_nan=False)] = None,
):
    """Resolve a name, or format coordinates without claiming a catalog match.

    Synchronous archive work runs in FastAPI's worker thread pool.
    """
    name = target.strip() if target is not None else None
    if name and ra is None and dec is None:
        if any(ord(character) < 32 or ord(character) == 127 for character in name):
            raise HTTPException(400, "Object names cannot contain control characters.")
        try:
            result = resolve_name(name, request.app.state.cache)
        except ResolverUnavailable as error:
            raise HTTPException(
                503, "SIMBAD is unavailable. Try again later."
            ) from error
        except InvalidCatalogResponse as error:
            raise HTTPException(502, "SIMBAD returned unusable target data.") from error
        except AmbiguousTarget as error:
            raise HTTPException(
                409, "Use a more specific catalog identifier."
            ) from error
        if result is None:
            raise HTTPException(404, "No matching object was found in SIMBAD.")
        return result
    if target is None and ra is not None and dec is not None:
        label = f"RA={ra:.8f}, Dec={dec:.8f}"
        return ResolvedTarget(
            query=label,
            canonical_name=label,
            object_type="Coordinate Location",
            coordinates=format_coordinates(ra, dec),
            provenance="User-supplied ICRS coordinates; no catalog verification",
        )
    raise HTTPException(400, "Provide an object name or both ra and dec, separately.")
