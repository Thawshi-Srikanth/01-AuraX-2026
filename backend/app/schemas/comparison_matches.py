"""Resumable target-position matching; candidate pairs are not blink certificates."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.compare import CompareRequest, ComparisonEpoch


class MatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    ra: float = Field(ge=0, lt=360)
    dec: float = Field(ge=-90, le=90)
    detector: Literal["D1", "D2", "D3", "D4", "D5", "D6"] | None = None
    from_date: date | None = None
    to_date: date | None = None
    candidate_limit: int = Field(default=24, ge=2, le=64)
    advance: bool = False
    retry_failed: bool = False

    @model_validator(mode="after")
    def validate_controls(self):
        if self.from_date and self.to_date and self.from_date > self.to_date:
            raise ValueError("The end date must be on or after the start date")
        if self.to_date == date.max:
            raise ValueError("End date must allow an exclusive next-day bound")
        if self.retry_failed and not self.advance:
            raise ValueError("Retrying failures requires advance=true")
        return self


class ObservationCheck(BaseModel):
    artifact_id: str
    status: Literal["verified", "excluded", "failed"]
    checked_at: datetime
    epoch: ComparisonEpoch | None = None
    reason: (
        Literal[
            "unusable_target", "outside_dates", "download_failed", "invalid_calibration"
        ]
        | None
    ) = None

    @model_validator(mode="after")
    def consistent_result(self):
        if self.status == "verified" and (
            self.epoch is None or self.reason is not None
        ):
            raise ValueError("Verified checks require an epoch and no exclusion reason")
        if self.status != "verified" and self.reason is None:
            raise ValueError("Excluded and failed checks require a reason")
        return self


class MatchedPair(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    artifact_id_a: str
    artifact_id_b: str
    detector: str
    baseline_days: float = Field(gt=0)
    wavelength_a_um: float
    wavelength_b_um: float
    bandwidth_a_um: float
    bandwidth_b_um: float
    comparison_request: CompareRequest
    full_frame_verified: bool = False
    blink_ready: bool = False


class MatchResponse(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    ra: float
    dec: float
    detector: str | None
    from_date: date | None
    to_date: date | None
    candidate_limit: int
    candidate_count: int
    metadata_rows: int
    metadata_truncated: bool
    metadata_rejected_count: int
    duplicate_exposure_count: int
    metadata_retrieved_at: datetime
    checked_count: int
    verified_count: int
    excluded_count: int
    failed_count: int
    pending_count: int
    new_download_attempts: int
    candidate_inspections: int
    cached_file_checks: int
    reused_checks_count: int
    state_cached: bool
    state_persisted: bool
    search_complete: bool
    can_continue: bool
    can_retry_failed: bool
    pairs_count: int
    pairs_truncated: bool
    pairs: list[MatchedPair]
    checks: list[ObservationCheck]
    status: Literal["matches", "no_matches", "no_coverage", "partial"]
    message: str
    wavelength_method: str = "Approximate WCS-WAVE at target; 0.002 um pair margin"
    candidate_scope: str = (
        "Bounded archive-selected products in the requested detector/date scope"
    )
    matching_scope: str = (
        "Target-position candidates only; POST /api/compare must verify full images"
    )
    max_new_download_attempts: int = 2
    max_file_checks_per_request: int = 16
    scientific_difference_available: bool = False
