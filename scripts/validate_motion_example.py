"""Exploratory two-epoch centroid check on cached real FITS, not a motion API.

Uses fixed apertures in a shared sky grid, independently selected field peaks,
and catalog proper motion only for an expected-position comparison. No download,
PSF fit, new source identification, formal significance or discovery is inferred.
Optional figures require matplotlib (run with uv --with matplotlib).
"""

import argparse
import hashlib
import json
import sys
import warnings
from contextlib import ExitStack
from datetime import UTC, datetime
from pathlib import Path

import astropy.units as u
import numpy as np
from astropy.coordinates import SkyCoord
from astropy.time import Time
from erfa import ErfaWarning
from reproject import reproject_interp
from scipy.ndimage import maximum_filter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.services.compare import calibrated_planes, sample_neighbourhood
from app.services.fits_parser import open_observation


def noise(image, mask):
    values = image[mask]
    median = np.median(values)
    return float(median), float(1.4826 * np.median(np.abs(values - median)))


def centroid(image, mask, anchor, radius=3):
    """Identical fixed aperture in each epoch: catalog motion cannot move it."""
    yy, xx = np.indices(image.shape)
    distance = np.hypot(xx - anchor[0], yy - anchor[1])
    aperture = distance <= radius
    annulus = (distance >= radius + 1) & (distance <= radius + 3) & mask
    if np.mean(mask[aperture]) < 0.9 or np.count_nonzero(annulus) < 12:
        return None
    background = float(np.median(image[annulus]))
    _, sigma = noise(image, mask)
    selected = aperture & mask
    if np.max(image[selected]) - background < 5 * sigma:
        return None
    weights = np.where(selected, np.maximum(image - background, 0), 0)
    weights = np.nan_to_num(weights)
    if weights.sum() <= 0:
        return None
    return np.array([(weights * xx).sum(), (weights * yy).sum()]) / weights.sum()


def offset(wcs, first, second):
    a = wcs.pixel_to_world(*first)
    b = wcs.pixel_to_world(*second)
    east, north = a.spherical_offsets_to(b)
    return np.array([east.arcsec, north.arcsec])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sequence-json", type=Path, required=True)
    parser.add_argument("--targets-json", type=Path, required=True)
    parser.add_argument("--target", default="Epsilon Indi B")
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--figure", type=Path)
    parser.add_argument("--animation", type=Path)
    args = parser.parse_args()
    sequence = json.loads(args.sequence_json.read_text())
    if not sequence["blink_ready"] or len(sequence["epochs"]) != 2:
        raise ValueError("A real, fully prepared, matched two-epoch sequence is required")
    target = next(
        t for t in json.loads(args.targets_json.read_text()) if t["query"] == args.target
    )
    benchmark, pm = target["benchmark"], target["proper_motion"]
    catalog = SkyCoord(
        ra=benchmark["reference_ra"] * u.deg,
        dec=benchmark["reference_dec"] * u.deg,
        pm_ra_cosdec=pm["pm_ra_mas_yr"] * u.mas / u.yr,
        pm_dec=pm["pm_dec_mas_yr"] * u.mas / u.yr,
        obstime=Time(benchmark["reference_epoch"], format="jyear"),
    )
    images, predictions = [], []
    mask = np.asarray(sequence["valid_mask"]).reshape(
        sequence["height"], sequence["width"]
    )
    with ExitStack() as stack:
        reference = None
        for epoch in sequence["epochs"]:
            key = hashlib.sha256(epoch["source_request_url"].encode()).hexdigest()
            data = stack.enter_context(open_observation(args.cache_dir / f"{key}.fits"))
            image, wave, band, valid = calibrated_planes(data)
            if reference is None:
                reference = data
                images.append(image)
            else:
                projected, footprint = reproject_interp(
                    (np.where(valid, image, np.nan), data.spatial_wcs),
                    reference.spatial_wcs, shape_out=reference.image.shape,
                    order="bilinear", roundtrip_coords=True,
                )
                coverage, _, _ = sample_neighbourhood(
                    reference, data, wave, band, valid, projected, footprint
                )
                mask &= coverage
                images.append(projected)
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", ErfaWarning)
                predicted = catalog.apply_space_motion(
                    new_obstime=Time(epoch["utc_date"])
                )
            predictions.append(np.array(reference.spatial_wcs.world_to_pixel(predicted)))

        # Seed the source from the first image only, near its catalog expectation.
        yy, xx = np.indices(images[0].shape)
        near = mask & (np.hypot(xx - predictions[0][0], yy - predictions[0][1]) < 2)
        if not near.any():
            raise ValueError("No usable pixels near the first expected position")
        iy, ix = np.unravel_index(
            np.argmax(np.where(near, images[0], -np.inf)), images[0].shape
        )
        anchor = (int(ix), int(iy))
        measured = [centroid(image, mask, anchor) for image in images]
        if any(value is None for value in measured):
            raise ValueError("Source aperture fails quality or contrast checks")

        baseline, sigma = noise(images[0], mask)
        filtered = np.where(mask, images[0], -np.inf)
        peaks = np.argwhere(
            mask & (filtered == maximum_filter(filtered, size=7))
            & (filtered > baseline + 8 * sigma)
        )
        peaks = sorted(peaks, key=lambda p: images[0][tuple(p)], reverse=True)
        references, rejected = [], []
        for y, x in peaks:
            if np.hypot(x - anchor[0], y - anchor[1]) < 7:
                continue
            if min(x, y, images[0].shape[1] - 1 - x, images[0].shape[0] - 1 - y) < 6:
                continue
            centers = [centroid(image, mask, (x, y)) for image in images]
            if any(value is None for value in centers):
                rejected.append({"anchor": [int(x), int(y)], "reason": "quality_or_contrast"})
                continue
            shift = offset(reference.spatial_wcs, *centers)
            references.append({
                "anchor": [int(x), int(y)],
                "centroids": [value.tolist() for value in centers],
                "offset_arcsec": shift.tolist(),
            })
            if len(references) == 8:
                break
        if not references:
            raise ValueError("No independent usable field peaks for an alignment check")
        shifts = np.array([value["offset_arcsec"] for value in references])
        translation = np.median(shifts, axis=0)
        residuals = shifts - translation
        scatter = float(np.sqrt(np.mean(np.sum(residuals ** 2, axis=1))))
        target_raw = offset(reference.spatial_wcs, *measured)
        expected = offset(reference.spatial_wcs, *predictions)
        corrected = target_raw - translation
        sensitivity = []
        for radius in (2, 3, 4):
            positions = [centroid(image, mask, anchor, radius) for image in images]
            sensitivity.append({
                "radius_pixels": radius,
                "offset_arcsec": (
                    (offset(reference.spatial_wcs, *positions) - translation).tolist()
                    if all(value is not None for value in positions) else None
                ),
            })
        report = {
            "checked_at": datetime.now(UTC).isoformat(), "target": args.target,
            "status": "exploratory_centroid_check" if len(references) >= 3 else "insufficient_references",
            "baseline_days": sequence["baseline_days"], "epochs": sequence["epochs"],
            "matched_pixels": int(mask.sum()), "field_pixels": int(mask.size),
            "fixed_aperture_anchor": list(anchor),
            "target_centroids": [value.tolist() for value in measured],
            "expected_pixels": [value.tolist() for value in predictions],
            "target_prediction_separations_arcsec": [
                float(np.linalg.norm(offset(reference.spatial_wcs, a, b)))
                for a, b in zip(measured, predictions)
            ],
            "offset_axes": ["east", "north"],
            "catalog_expected_offset_arcsec": expected.tolist(),
            "target_raw_offset_arcsec": target_raw.tolist(),
            "reference_translation_arcsec": translation.tolist(),
            "target_reference_corrected_offset_arcsec": corrected.tolist(),
            "reference_rms_arcsec": scatter, "reference_peaks": references,
            "rejected_reference_peaks": rejected, "aperture_sensitivity": sensitivity,
            "caveats": [
                "Exploratory fixed-aperture centroids, not a precision motion measurement.",
                "Field peaks are reference candidates; their catalog identities are not certified.",
                "Catalog expectation omits parallax and perspective acceleration.",
                "No PSF matching, interpolation covariance or propagated centroid errors.",
                "RMS and aperture sensitivity are diagnostics, not formal significance.",
                "No newly discovered source or resolved binary is claimed.",
            ],
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({k: report[k] for k in (
            "status", "catalog_expected_offset_arcsec", "target_reference_corrected_offset_arcsec",
            "reference_rms_arcsec", "target_prediction_separations_arcsec",
        )}), flush=True)
        print("references", len(references), "sensitivity", sensitivity, flush=True)
        if args.figure:
            make_figure(args.figure, images, mask, predictions, measured, references, report)
        if args.animation:
            make_animation(args.animation, images, mask, sequence["target_pixel"], report)


def make_figure(path, images, mask, predictions, measured, references, report):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from astropy.visualization import AsinhStretch, ImageNormalize
    from matplotlib.patches import Patch

    values = np.concatenate([image[mask] for image in images])
    low, high = np.percentile(values, [5, 99.7])
    norm = ImageNormalize(vmin=low, vmax=high, stretch=AsinhStretch(0.05))
    colormap = plt.get_cmap("gray").copy()
    colormap.set_bad("#46617b")
    fig, axes = plt.subplots(2, 2, figsize=(12, 10), constrained_layout=True)
    for i, ax in enumerate(axes[0]):
        ax.imshow(np.ma.array(images[i], mask=~mask), origin="lower", cmap=colormap, norm=norm)
        ax.plot(*predictions[i], "o", color="#ffba38", fillstyle="none", ms=15,
                label="Catalog expectation (proper motion only)")
        ax.plot(*measured[i], "+", color="#38d7ff", ms=12, label="Fixed-aperture centroid")
        for j, source in enumerate(references):
            x, y = source["centroids"][i]
            ax.plot(x, y, "o", ms=9, fillstyle="none", color="#68d391")
            ax.text(x + 1, y + 1, f"R{j + 1}", color="#68d391", fontsize=8)
        epoch = report["epochs"][i]
        ax.set_title(f"{epoch['utc_date'][:10]} · D3 · {epoch['target_wavelength_um']:.4f} µm")
        ax.set_xlabel("Reference-grid x (pixel)"); ax.set_ylabel("Reference-grid y (pixel)")
    handles, labels = axes[0, 0].get_legend_handles_labels()
    axes[0, 0].legend(
        handles + [Patch(color="#46617b")], labels + ["Excluded pixels"],
        loc="lower left", fontsize=7,
    )
    for i, ax in enumerate(axes[1]):
        ax.imshow(np.ma.array(images[i], mask=~mask), origin="lower", cmap=colormap, norm=norm)
        ax.plot(*predictions[i], "o", fillstyle="none", color="#ffba38", ms=18)
        ax.plot(*measured[i], "+", color="#38d7ff", ms=14)
        x, y = report["fixed_aperture_anchor"]
        ax.set_xlim(x - 6, x + 6); ax.set_ylim(y - 6, y + 6)
        ax.set_title("Same fixed sky-grid area · excluded pixels remain masked")
        ax.set_xlabel("Reference-grid x (pixel)"); ax.set_ylabel("Reference-grid y (pixel)")
    fig.suptitle(
        f"Epsilon Indi B field · {report['baseline_days']:.1f}-day baseline\n"
        "Real SPHEREx images; exploratory centroid/reference check, not a discovery claim",
        fontsize=13,
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=160)
    plt.close(fig)


def make_animation(path, images, mask, fixed_position, report):
    """Two actual frames only; one fixed marker and no invented in-between dates."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from astropy.visualization import AsinhStretch, ImageNormalize
    from PIL import Image

    values = np.concatenate([image[mask] for image in images])
    low, high = np.percentile(values, [5, 99.7])
    norm = ImageNormalize(vmin=low, vmax=high, stretch=AsinhStretch(0.05))
    colormap = plt.get_cmap("gray").copy()
    colormap.set_bad("#46617b")
    frames = []
    x, y = report["fixed_aperture_anchor"]
    for i, image in enumerate(images):
        fig = plt.figure(figsize=(6, 6), dpi=110)
        ax = fig.add_axes((0.12, 0.15, 0.78, 0.72))
        ax.imshow(np.ma.array(image, mask=~mask), origin="lower", cmap=colormap, norm=norm)
        ax.set_xlim(x - 6, x + 6); ax.set_ylim(y - 6, y + 6)
        ax.plot(fixed_position["x"], fixed_position["y"], "+", color="#38d7ff", ms=16)
        ax.set_xlabel("Fixed reference-grid x (pixel)")
        ax.set_ylabel("Fixed reference-grid y (pixel)")
        epoch = report["epochs"][i]
        fig.text(0.5, 0.95, "Epsilon Indi B field · real SPHEREx cutouts", ha="center")
        fig.text(0.5, 0.91, f"{epoch['utc_date'][:10]}   {epoch['target_wavelength_um']:.4f} µm",
                 ha="center", family="monospace")
        fig.text(0.5, 0.05, "Cyan cross stays fixed; blue pixels are excluded.", ha="center", fontsize=9)
        fig.text(0.5, 0.02, "Two real epochs; no interpolated frames. Not a discovery claim.",
                 ha="center", fontsize=8)
        fig.canvas.draw()
        frames.append(Image.fromarray(np.asarray(fig.canvas.buffer_rgba()).copy()).convert("RGB"))
        plt.close(fig)
    path.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=1200, loop=0)


if __name__ == "__main__":
    main()
