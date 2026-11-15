"""Time-window allocation and baseline rules, with labelled synthetic candidates."""

from datetime import UTC, date, datetime
from unittest.mock import Mock

import pytest

from app.schemas.compare import ComparisonEpoch
from app.schemas.comparison_matches import MatchRequest, ObservationCheck
from app.schemas.observation import SPHERExObservation
from app.services import comparison_candidates as archive
from app.services.comparison_candidates import CandidateBatch
from app.services.comparison_matches import _pairs
from app.services.observations import ArchiveUnavailable


def product(index, mjd):
    return SPHERExObservation(
        artifact_id=f"test-{index}",
        obs_id=f"test-{index}",
        detector="D1",
        band_name="SPHEREx-D1",
        release="dr1",
        processing_version="test-only",
        mjd_start=mjd,
        utc_date="2025-01-01T00:00:00Z",
        date_only="2025-01-01",
        wavelength_min_um=0.75,
        wavelength_max_um=1.1,
        access_url=f"https://example.invalid/{index}.fits",
    )


def batch(products, *, truncated=False, fallback=False):
    return CandidateBatch(
        observations=products,
        metadata_rows=len(products),
        truncated=truncated,
        rejected_count=0,
        duplicate_exposure_count=0,
        retrieved_at=datetime.now(UTC),
        fallback_notice="TAP unavailable; SIA used" if fallback else None,
    )


def test_two_date_windows_are_bounded_interleaved_and_share_sia_failover(monkeypatch):
    left, right = (
        [product(1, 60000), product(2, 60001)],
        [product(3, 60200), product(4, 60201)],
    )
    lookup = Mock(
        side_effect=[batch(left, truncated=True, fallback=True), batch(right)]
    )
    monkeypatch.setattr(archive, "query_window", lookup)
    request = MatchRequest(
        ra=1,
        dec=2,
        candidate_limit=4,
        time_sampling="spread",
        from_date="2025-01-01",
        to_date="2025-12-31",
    )
    result = archive.query_candidates(request)
    a, b = [call.args[0] for call in lookup.call_args_list]
    assert a.from_date == date(2025, 1, 1) and b.to_date == date(2025, 12, 31)
    assert (b.from_date - a.to_date).days == 1
    assert a.candidate_limit == b.candidate_limit == 2
    assert lookup.call_args_list[1].kwargs["sia_only"] is True
    assert [p.obs_id for p in result.observations] == [
        "test-1",
        "test-3",
        "test-2",
        "test-4",
    ]
    assert result.truncated and result.fallback_notice
    assert "Not a complete" in result.candidate_scope


def test_failure_in_a_window_cannot_claim_no_coverage(monkeypatch):
    monkeypatch.setattr(
        archive, "query_window", Mock(side_effect=[batch([]), ArchiveUnavailable])
    )
    with pytest.raises(ArchiveUnavailable):
        archive.query_candidates(MatchRequest(ra=1, dec=2, time_sampling="spread"))


def test_minimum_baseline_excludes_same_visit_and_keeps_long_pairs():
    checks = []
    for i, (date_string, mjd) in enumerate(
        [
            ("2025-01-01T00:00:00Z", 60676),
            ("2025-01-01T00:02:00Z", 60676.0014),
            ("2025-07-01T00:00:00Z", 60857),
        ]
    ):
        epoch = ComparisonEpoch(
            obs_id=f"test-{i}",
            detector="D1",
            utc_date=date_string,
            mjd_start=mjd,
            access_url=f"https://example.invalid/{i}",
            source_request_url=f"https://example.invalid/{i}",
            processing_version="test-only",
            cached_fits=True,
            target_wavelength_um=1.0,
            target_bandwidth_um=0.04,
        )
        checks.append(
            ObservationCheck(
                artifact_id=f"test-{i}",
                status="verified",
                checked_at=datetime.now(UTC),
                epoch=epoch,
            )
        )
    pairs = _pairs(checks, MatchRequest(ra=1, dec=2, min_baseline_days=30))
    assert len(pairs) == 2 and all(pair.baseline_days >= 30 for pair in pairs)
    assert len(_pairs(checks, MatchRequest(ra=1, dec=2))) == 3
