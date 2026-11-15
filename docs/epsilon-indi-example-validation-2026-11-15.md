# Checked Epsilon Indi B time example — 15 November 2026

## Result and scope

The app now offers an explicit checked example from Home. It selects two real D3
observations, 508.64 days apart. Analyse retrieves small cutouts sequentially and
reruns the existing strict wavelength, quality and registration checks. Play
then blinks the two actual observations. No archive discovery is required to open
this particular example; current archive availability still governs FITS retrieval.
No image pixels are bundled in the app or substituted after a failure.

This is a catalog-consistent illustration of a known moving source, supported by
position and relative-displacement checks. It is not precision astrometry, a new
discovery, or a measurement of the individual components of the brown-dwarf binary.
The ordinary comparison continues to support two to four images. This example
uses exactly two independent epochs; none are duplicated to make four frames.

## Data and full-image checks

| Property | First image | Second image |
| --- | --- | --- |
| Observation | `2025W18_2B_0011_4` | `2026W39_1A_0276_1` |
| Actual FITS UTC | 2025-05-01T14:00:01.056Z | 2026-09-22T05:26:44.686Z |
| Release | DR1 | QR3 |
| Detector | D3 | D3 |
| Target wavelength | 1.724144 µm | 1.721821 µm |

The fixed sky field is RA 331.0956582664693°, Dec −56.80030697842581°, using the
same approximate J2025.5 field centre as the challenge preset. Individual frames
are not independently recentered on the moving source.

Both native FITS identities and timestamps agree with their selected archive
metadata. Full SIP registration and every-contributor wavelength checks pass on
**2,344 of 2,500 pixels (93.76%)**, including the requested position.
`blink_ready=true`. The local wavelength lookup is the app's approximate WCS-WAVE
visualization calibration, not precision CWAVE/CBAND source calibration.

Discovery was bounded: ten D3 candidates were returned from two date windows;
six were checked in three explicit batches of at most two new calibration cutouts.
Four candidates remained unchecked. The selected pair has the closest target
wavelengths among those checked; no archive-wide optimality or completeness is claimed.

Original product URLs, processing versions, masks and preparation diagnostics are
in the [matched sequence response](epsilon-indi-matched-sequence-2026-11-15.json).
The app's metadata-only definition is in
[checkedComparison.ts](../frontend/src/data/checkedComparison.ts).

## Source and reference checks

The first usable source peak within two pixels of the catalog expectation seeds
one fixed aperture. That aperture has the same centre in both registered images;
the expected catalog motion never moves the measurement aperture. Six independent
field peaks are selected by brightness, separation from the target, edge distance,
common quality and contrast in both images. They are not selected for having
small measured displacements, and their individual catalog identities are not certified.

Surface brightness in the original calibrated FITS is used for centroids, with
a local annulus background and a shared valid mask. Display stretch values are
not used as measurements. A median reference translation is removed from the
target shift. Every accepted reference and rejected candidate is recorded in the
[centroid report](epsilon-indi-motion-check-2026-11-15.json).

| Diagnostic | Result |
| --- | --- |
| Approximate catalog expectation, east / north | +5.548″ / −3.431″ |
| Target displacement after median reference correction | +5.083″ / −4.341″ |
| Expected displacement magnitude | 6.523″ |
| Exploratory target displacement magnitude | 6.685″ |
| RMS scatter of the six reference displacements about their median | 0.586″ |
| Centroid separation from the expected position, first / second image | 0.312″ / 0.844″ |

The displacement and both positions are consistent enough with the known
high-proper-motion source to support this visual example. The reference RMS is
a diagnostic of these selected field peaks, **not** a formal target error bar or
a detection significance. A compact galaxy may also serve as a field reference;
the six peaks are not all independently identified as stars.

Changing the fixed aperture radius from three to four pixels changes the inferred
displacement magnitude from 6.685″ to 6.690″. A smaller two-pixel aperture gives
4.929″, demonstrating why the result must not be presented as a precision motion
measurement. Parallax, perspective acceleration, PSF differences, interpolation
covariance and fully propagated centroid uncertainties are not modeled.

## Visual evidence

The [two-frame animation](validation/epsilon-indi-motion-check-2026-11-15.gif) uses
only the two real registered images with identical display scaling and a fixed
cyan coordinate marker. Blue pixels are excluded. There are no synthesized
intermediate images or dates.

The [reference-check figure](validation/epsilon-indi-motion-check-2026-11-15.png)
shows the wider field, reference candidates, and identical sky-grid crops around
the target. Orange circles are the approximate catalog expectations; cyan crosses
are the exploratory centroids. Excluded pixels are colored blue rather than
being confused with bright image pixels.

## Reproduce

After retrieving the original cutouts listed in the sequence report, run the
cache-only script with the backend environment. `--targets-json` is exported from
the shared `challengeTargets.ts` definitions. Optional figures use matplotlib;
it is an analysis dependency, not a new application/runtime dependency.

```sh
uv run --locked --with matplotlib python ../scripts/validate_motion_example.py \
  --sequence-json ../docs/epsilon-indi-matched-sequence-2026-11-15.json \
  --targets-json /tmp/aurax-challenge-targets.json \
  --cache-dir cache/native-dev/port-8000/fits \
  --output ../docs/epsilon-indi-motion-check-2026-11-15.json \
  --figure ../docs/validation/epsilon-indi-motion-check-2026-11-15.png \
  --animation ../docs/validation/epsilon-indi-motion-check-2026-11-15.gif
```

The Home link → Analyse → Play/Pause → frame stepping → Details path was checked
in the browser. Details reported matching target passbands, 93.8% usable blink
area and a 508.6-day span. The existing limits for the other four challenge
targets remain recorded in the [main audit](challenge-audit-2026-11-15.md).
