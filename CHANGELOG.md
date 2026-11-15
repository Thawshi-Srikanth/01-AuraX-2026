# Changelog

Numbered releases use vMAJOR.MINOR.PATCH. Deployment tags and verification links appear on [GitHub Releases](https://github.com/Thawshi-Srikanth/01-AuraX-2026/releases). See [release instructions](docs/releases.md).

## v1.1.1 — 2026-11-15

- Fix Ruff formatting on `example_cache.py`, `test_example_cache.py`, and `scripts/warm_example_cache.py`.

## v1.1.0 — 2026-11-15

Persistent server-side example-target cache and IRSA outage fallback.

- Added `app.services.example_cache` (`python -m app.services.example_cache`) and `scripts/warm_example_cache.py` to warm `aurax.db` and `FITS_CACHE_DIR` on the server without bundling `.fits` images in the repository.
- Added persistent non-expiring observation fallback (`observations:fallback:v1`) for example targets and comparison candidates when IRSA TAP/SIA is unavailable, while continuing live IRSA queries whenever IRSA is reachable.
- Added persistent FITS cutout pinning (`.aurax-fits-pinned`) in `FitsCachePolicy` / `FitsStore` so warmed example cutouts survive idle expiry and LRU eviction.

## v1.0.0 — 2026-11-15

First numbered release of the existing AURAx application.

- Real SPHEREx cutouts, SIMBAD target resolution, and official IRSA SIA fallback after TAP failures.
- Small target-centred fields, controlled sequential requests, and persistent caching.
- Two-to-four-image aligned general comparison and stricter matched-wavelength blink.
- Checked Epsilon Indi B time example, recorded validation, quality masks, and provenance.
- Saved targets and bounded nearest-pixel spectral samples with uncertainties.
- Direct Home example navigation and the coordinate-adjacent Open images action.
- Home video, project cover, workspace walkthroughs, developer/contributor guides, credits, and Codex/Gemini disclosure.
- Version-tagged frontend/backend images, pull-only release verification, and automated GitHub Releases.

Scientific limitations remain documented: image retrieval is not source identification; spectral samples include background; known-motion examples are not precision astrometry or new discoveries. See the [challenge audit](docs/challenge-audit-2026-11-15.md).
