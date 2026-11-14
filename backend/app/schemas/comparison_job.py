"""Process-local date-search job progress; completion is one bounded pass."""

from typing import Literal

from pydantic import BaseModel

from app.schemas.comparison_matches import MatchRequest, MatchResponse


class ComparisonJobResponse(BaseModel):
    job_id: str
    status: Literal[
        "queued", "running", "completed", "failed", "cancelled", "expired"
    ] = "queued"
    stage: Literal[
        "queued",
        "waiting_for_search",
        "metadata",
        "checking_files",
        "waiting_for_download",
        "saving",
        "finished",
    ] = "queued"
    request: MatchRequest
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    cancellation_requested: bool = False
    candidate_count: int | None = None
    processed_count: int = 0
    new_download_attempts: int = 0
    error: (
        Literal["archive_unavailable", "invalid_metadata", "internal_error"] | None
    ) = None
    result: MatchResponse | None = None
