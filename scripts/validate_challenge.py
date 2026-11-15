"""Bounded sequential live validation; not a source-detection certificate.

Run with the backend virtualenv. --targets-json is exported from the shared
frontend challengeTargets module so benchmark coordinates are not duplicated.
"""

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.schemas.comparison_matches import MatchRequest
from app.schemas.observation import SPHERExObservation
from app.services.comparison_candidates import query_candidates


def post(base, path, payload):
    request = Request(
        base.rstrip("/") + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=120) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-base", default="http://127.0.0.1:8000")
    parser.add_argument("--targets-json", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--retry-failed", action="store_true",
        help="Retry only failed image checks using their recorded metadata, once.",
    )
    args = parser.parse_args()
    targets = json.loads(args.targets_json.read_text())
    if len(targets) != 5:
        raise ValueError("Expected exactly five shared benchmark targets")
    report = {
        "checked_at": datetime.now(UTC).isoformat(),
        "purpose": (
            "Bounded real-data image/registration validation, "
            "not source identification or detection of motion."
        ),
        "max_selected_images_per_target": 4,
        "downloads": "Sequential target cutouts; no full-sky or bulk image requests.",
        "results": [],
    }
    previous = (
        json.loads(args.output.read_text())["results"] if args.retry_failed else []
    )
    report["results"] = list(previous)
    for target in targets:
        old = next((r for r in previous if r["target"] == target["query"]), {})
        result = {**old, "target": target["query"], "coordinates": target["coordinates"]}
        if args.retry_failed and old.get("status") == "ready":
            continue
        try:
            ra = target["coordinates"]["ra_deg"]
            dec = target["coordinates"]["dec_deg"]
            if args.retry_failed and old.get("selected_products"):
                selected = [
                    SPHERExObservation.model_validate(p)
                    for p in old.get("selected_products", [])
                ]
            else:
                print(f"{target['query']}: querying two date windows", flush=True)
                batch = query_candidates(
                    MatchRequest(
                        ra=ra,
                        dec=dec,
                        candidate_limit=12,
                        time_sampling="spread",
                    )
                )
                result.update(
                    metadata_candidates=len(batch.observations),
                    metadata_truncated=batch.truncated,
                    metadata_source=batch.provenance,
                    candidate_scope=batch.candidate_scope,
                )
                selected = batch.observations[:4]
            result["selected_products"] = [p.model_dump(mode="json") for p in selected]
            if len(selected) < 2:
                result["status"] = "insufficient_candidates"
            else:
                print(
                    f"{target['query']}: preparing {len(selected)} cutouts "
                    "sequentially",
                    flush=True,
                )
                status, data = post(
                    args.api_base,
                    "/api/compare/sequence",
                    {
                        "ra": ra,
                        "dec": dec,
                        "access_urls": [p.access_url for p in selected],
                        "size_deg": 50 * 6.2 / 3600,
                        "comparison_kind": "general",
                    },
                )
                result.update(
                    http_status=status,
                    **{
                        key: data.get(key)
                        for key in [
                            "status",
                            "message",
                            "detail",
                            "width",
                            "height",
                            "baseline_days",
                            "visual_playback_ready",
                            "blink_ready",
                            "coverage_pixel_count",
                            "matched_pixel_count",
                            "epochs",
                        ]
                    },
                )
                result["returned_frames"] = len(data.get("frames", []))
                result["status"] = data.get("status") or "retrieval_failed"
                attempts = list(old.get("attempts", []))
                if old and not attempts:
                    attempts.append({key: old.get(key) for key in ("http_status", "detail")})
                attempts.append({
                    "checked_at": datetime.now(UTC).isoformat(),
                    "http_status": status, "detail": data.get("detail"),
                })
                result["attempts"] = attempts
        except Exception as error:  # noqa: BLE001 -- record a failed live check and continue
            result.update(status="failed", error=str(error))
        report["results"] = [
            r for r in report["results"] if r["target"] != target["query"]
        ] + [result]
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n")
        print(
            f"{target['query']}: {result.get('status')} / "
            f"frames={result.get('returned_frames', 0)} / "
            f"baseline={result.get('baseline_days')} days",
            flush=True,
        )
    args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
