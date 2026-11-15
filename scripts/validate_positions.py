"""Inspect cached benchmark pixels at approximate observation-epoch positions.

No archive queries, new downloads, or source identifications are performed.
--targets-json is exported from frontend/src/data/challengeTargets.ts.
"""

import argparse
import json
import math
import sys
import warnings
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import astropy.units as u
import numpy as np
from astropy.coordinates import SkyCoord
from astropy.time import Time
from erfa import ErfaWarning

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.services.compare import calibrated_planes
from app.services.fits_download import FitsStore
from app.services.fits_parser import open_observation


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--targets-json", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    targets = json.loads(args.targets_json.read_text())
    report = json.loads(args.report.read_text())
    store = FitsStore(args.cache_dir)
    results = []
    for result in report["results"]:
        target = next(t for t in targets if t["query"] == result["target"])
        benchmark, pm = target["benchmark"], target["proper_motion"]
        reference = SkyCoord(
            ra=benchmark["reference_ra"] * u.deg,
            dec=benchmark["reference_dec"] * u.deg,
            pm_ra_cosdec=pm["pm_ra_mas_yr"] * u.mas / u.yr,
            pm_dec=pm["pm_dec_mas_yr"] * u.mas / u.yr,
            obstime=Time(benchmark["reference_epoch"], format="jyear"),
        )
        rows = []
        for epoch in result["epochs"]:
            size = float(parse_qs(urlsplit(epoch["source_request_url"]).query)["size"][0])
            cached = store.get_cached(
                epoch["access_url"], result["coordinates"]["ra_deg"],
                result["coordinates"]["dec_deg"], size,
            )
            row = {key: epoch[key] for key in ("obs_id", "detector", "utc_date")}
            row["cached"] = cached is not None
            if cached:
                # ERFA warns that distance is absent; this is deliberately a
                # tangential-motion approximation, disclosed in the output.
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", ErfaWarning)
                    predicted = reference.apply_space_motion(
                        new_obstime=Time(epoch["utc_date"])
                    )
                with open_observation(cached.path) as data:
                    image, _, _, valid = calibrated_planes(data)
                    x, y = data.target_pixel(predicted.ra.deg, predicted.dec.deg)
                    ix, iy = math.floor(x + 0.5), math.floor(y + 0.5)
                    flags = int(data.flags[iy, ix])
                    row.update(
                        predicted_ra=float(predicted.ra.deg),
                        predicted_dec=float(predicted.dec.deg),
                        predicted_x=x, predicted_y=y,
                        predicted_pixel_usable=bool(valid[iy, ix]),
                        predicted_flags=flags,
                        flag_names=[
                            str(data.hdus["FLAGS"].header.get(f"MSKN{b:04d}", f"Bit {b}"))
                            for b in range(64) if flags & (1 << b)
                        ],
                        usable_field_fraction=float(valid.mean()),
                        predicted_pixel_mjy_sr=(
                            float(image[iy, ix]) if np.isfinite(image[iy, ix]) else None
                        ),
                    )
            rows.append(row)
        results.append({"target": result["target"], "checks": rows})
    args.output.write_text(json.dumps({
        "checked_at": datetime.now(UTC).isoformat(),
        "method": (
            "Cached native FITS only; catalog proper motion propagated to each "
            "observation. No distance, radial velocity, parallax or perspective "
            "correction. Usable pixels do not establish a source detection. "
            "These are the original four-image selections."
        ),
        "results": results,
    }, indent=2) + "\n")


if __name__ == "__main__":
    main()
