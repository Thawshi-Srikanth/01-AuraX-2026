"""A target and an actual archive product are required for every image request."""

from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Request

from app.schemas.cutout import CutoutResponse
from app.services.cutout import CutoutTooLarge, image_cutout
from app.services.fits_download import FitsContentError, FitsDownloadError, cutout_url
from app.services.fits_parser import InvalidFitsError

router = APIRouter(prefix="/api", tags=["Images"])


@router.get("/cutout", response_model=CutoutResponse)
def cutout(
    request: Request,
    access_url: Annotated[str, Query(min_length=1, max_length=2048)],
    ra: Annotated[float, Query(ge=0, lt=360, allow_inf_nan=False)],
    dec: Annotated[float, Query(ge=-90, le=90, allow_inf_nan=False)],
    size_deg: Annotated[float, Query(gt=0, le=0.5, allow_inf_nan=False)] = 0.03,
    stretch: Literal["zscale", "linear", "log"] = "zscale",
):
    """Return row-major arrays, quality masks, and full celestial WCS metadata."""
    try:
        cutout_url(access_url, ra, dec, size_deg)
    except ValueError as error:
        raise HTTPException(400, "Use a direct IRSA Level 2 product URL.") from error
    try:
        return image_cutout(
            request.app.state.fits_store, access_url, ra, dec, size_deg, stretch
        )
    except CutoutTooLarge as error:
        raise HTTPException(
            413, "Image response is too large. Reduce size_deg."
        ) from error
    except (FitsContentError, InvalidFitsError) as error:
        raise HTTPException(
            502, "IRSA image data or target calibration is unusable."
        ) from error
    except (FitsDownloadError, OSError) as error:
        raise HTTPException(
            503, "The image could not be retrieved. Try again later."
        ) from error
