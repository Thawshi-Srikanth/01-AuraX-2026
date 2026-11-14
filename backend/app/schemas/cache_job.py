"""Small explicit cache requests, with bounded in-memory job progress."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

ProductURL = Annotated[str, Field(min_length=1, max_length=2048)]


class CacheJobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    access_urls: list[ProductURL] = Field(min_length=1, max_length=4)
    ra: float = Field(ge=0, lt=360)
    dec: float = Field(ge=-90, le=90)
    size_deg: float = Field(default=0.03, gt=0, le=0.5)


class CacheJobItem(BaseModel):
    access_url: str
    status: Literal["pending", "running", "ready", "failed", "cancelled", "skipped"] = (
        "pending"
    )
    cached: bool | None = None
    size_bytes: int | None = None
    error: (
        Literal[
            "cache_unavailable", "download_failed", "invalid_data", "internal_error"
        ]
        | None
    ) = None


class CacheJobResponse(BaseModel):
    job_id: str
    status: Literal[
        "queued", "running", "completed", "partial", "failed", "cancelled", "expired"
    ] = "queued"
    ra: float
    dec: float
    size_deg: float
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    cancellation_requested: bool = False
    items: list[CacheJobItem]
