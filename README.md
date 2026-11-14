# AURAx

AURAx is an astronomical exploration application for SPHEREx infrared observations.
This repository is being built progressively, starting with the backend.

## Available now

- A minimal FastAPI backend with a health endpoint.
- Real SIMBAD name resolution and manual ICRS coordinate validation.
- Bounded SPHEREx Level 2 observation metadata search through IRSA.
- Complete-FITS retrieval and calibration-preserving parsing.
- Image cutout API with physical values, quality masks, and display stretching.
- Measured nearest-pixel spectral samples with variance-derived uncertainties.
- Real SIMBAD catalog cone search with source references and angular distances.
- Full-SIP, wavelength-screened visual comparison of two observations.
- Bounded compatible-date discovery with saved progress and explicit retrieval batches.
- Background date-search jobs with polling, cancellation, and bounded queues.
- Two-to-four-observation sequence preparation with every-pair wavelength screening.
- Quota-limited FITS cache and explicit bounded background cache jobs.
- Explicit configuration of allowed browser origins.
- Persistent SQLite metadata cache with namespaces and optional expiry.
- Automated backend tests.

The frontend currently provides a branded workspace shell, validated navigation
and session restoration, a real backend connection check, and target search by
name or ICRS coordinates, plus the copied Explore sky map. The image viewer and
remaining science views have not yet been migrated.

## Run the backend

Requires Python 3.11 or newer and [uv](https://docs.astral.sh/uv/).

```sh
cd backend
uv sync --locked
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000/health> for the health response and
<http://127.0.0.1:8000/docs> for the API documentation.
The health response confirms that the API is running; it does not check external archives.

## Run the frontend

Frontend development takes place on `codex/frontend-development`. Use Bun for
installation, scripts, and builds. The foundation is verified with Bun 1.3.5.

Start the backend as above, then in another terminal:

```sh
cd frontend
bun install --frozen-lockfile
bun run dev
```

Open <http://127.0.0.1:5173>. The workspace checks the real `/health` response
on load and on **Check connection**, with a five-second timeout. Failed requests,
HTTP errors, and invalid responses show **Backend unavailable** with a retry.
Connection status verifies the API, not archive availability. No observations or
targets are fabricated, and the shell makes no astronomy archive requests.

The development server proxies `/backend` to `http://127.0.0.1:8000`. To change
the backend, copy `frontend/.env.example` to `frontend/.env` and set
`AURAX_BACKEND_URL`; restart Vite after configuration changes.
`VITE_API_BASE_URL` defaults to `/backend`. For a production static deployment,
configure a reverse proxy for that path or supply the backend's public URL at
build time and configure its `CORS_ORIGINS` for the frontend origin. `VITE_*`
settings are public browser configuration and must never contain credentials.
The Vite development proxy is not a production deployment server.

The shell reuses `aura.svg` and defines the shared dark palette in
`frontend/src/tokens.css`. It includes responsive layout and keyboard focus/skip
navigation. Home includes target search; other science views remain separate migration chunks.

Navigation uses the original view paths: Home `/`, Explore `/sky`, Observations
`/images`, Compare dates `/compare`, Wavelengths `/wavelengths`, Collections
`/saved`, and Help `/docs`. Views whose tools are not migrated display an explicit
unavailable state; route availability does not imply scientific tools are ready.
Normal clicks use browser history, and modified clicks retain normal link behavior.
Back/Forward restores the view and coordinates encoded in that history entry.

The current tab stores only the last valid view and optional ICRS coordinates in
`sessionStorage`, with schema versioning and bounded input validation. A bare `/`
visit resumes this session; explicit view paths and coordinate links take priority.
Direct links can include `?ra=...&dec=...`; both coordinates are required, checked
against the backend's ranges, and preserve numeric precision. Coordinates are
labelled unverified positions, never catalog matches or propagated epochs.
No default object, observations, credentials, job records, or science arrays are
saved. Unknown paths and malformed coordinates show an error with a Home recovery
link. Invalid links do not overwrite the previous valid session. Missing, corrupt,
blocked, or full session storage does not prevent navigation. A static host must
serve `index.html` for these application paths to support direct links and reloads.

On Home, **Search the sky** supports either an object name/catalog identifier
(up to 200 characters) or RA/Dec in decimal degrees. Both modes use the real
`/api/resolve` endpoint. Coordinates are locally validated before a request;
named results preserve catalog provenance, source links, and coordinate references.
Manual positions never claim a catalog match, and missing coordinate epochs remain
unspecified. Catalog type codes are displayed as returned by the backend.

The browser stops waiting after 40 seconds. **Cancel search**, a changed history
position, or leaving Home invalidates the pending result so it cannot replace a
later selection. Cancelling does not guarantee an already running backend/catalog
request stops. Input errors, not-found and ambiguous names, unavailable catalogs,
and malformed responses remain errors; failed searches preserve the prior selected
position. There is no synthetic target or fallback name resolution.

A successful lookup updates the coordinate URL and tab session. Catalog metadata
is kept only in memory during this app visit; reloads retain coordinates but show
an unverified position until another lookup, rather than restoring a catalog match
from user-editable storage. No proper-motion propagation is performed. Live browser
checks verified a real Barnard's Star lookup and manual-coordinate validation;
external SIMBAD availability is still independent of backend health.

Explore now uses the existing application's `SkyMapView` renderer, controls,
star/constellation files, and local `noirlab_galactic_4k.jpg` background. Its
original 3D/flat projections, pan/zoom/reset, and layer toggles are retained.
The copied map uses the original Tailwind configuration and icon dependency.
No replacement atlas service or Aladin dependency is included.

Static footprints, including a generated target-field rectangle, are illustrative
legacy overlays and are explicitly labelled as such; they are not queried or
verified SPHEREx observations or exposure coverage. The photo is a reference
background, not calibrated SPHEREx imagery. Selecting **Observe** validates the
position through the real coordinate resolver and opens the Observations route.
Failure shows an error instead of constructing a catalog identity or epoch.
The Observations tools themselves are a later migration chunk.

Verify the frontend from `frontend/`:

```sh
bun run lint
bun test
bun run build
```

The frontend workflow runs these checks on pushes to the frontend branch or main
and on frontend pull requests. Generated builds, dependencies, and local `.env`
files remain outside Git.

## Configuration

`CORS_ORIGINS` accepts a comma-separated list of browser origins.
By default, it allows `http://localhost:5173` and `http://127.0.0.1:5173`.
Set it explicitly for a deployed frontend. Wildcard origins are rejected.

```sh
CORS_ORIGINS=https://your-frontend.example uv run uvicorn app.main:app
```

## Resolve a target

```sh
curl --get http://127.0.0.1:8000/api/resolve --data-urlencode "target=M101"
curl 'http://127.0.0.1:8000/api/resolve?ra=180&dec=-15.5'
```

Supply either a name (up to 200 characters) or both RA and Dec, in degrees.
RA must be in `[0, 360)` and Dec in `[-90, 90]`. Coordinates are not silently
wrapped. Manual positions are labelled user supplied and are not catalog matches.

Named targets are queried through the [SIMBAD TAP service](https://simbad.cds.unistra.fr/simbad/sim-tap)
with fallback on service failure to the
[Harvard mirror published by CDS](https://cds.unistra.fr/). The response records
the actual endpoint used. Queries use [PyVO](https://pyvo.readthedocs.io/en/stable/api/pyvo.dal.TAPService.html).
Coordinates are formatted with Astropy. The response preserves numeric precision,
SIMBAD object-type codes, available coordinate/motion references, the retrieval
time, and a `cached` flag. Missing proper motions remain null; RA proper motion
is the catalog's mu-alpha times cos(delta). No observation epoch is inferred from
the ICRS reference frame. Aliases are not queried in this initial feature.

Successful named results are cached for 24 hours. There are no hard-coded target
records or synthetic fallbacks. Unknown names return 404, ambiguous matches 409,
service failures 503, and unusable catalog data 502. Invalid/mixed inputs return
400 or validation error 422. Unknown names and failures are not cached.
Network requests use a 5-second connect timeout and 15-second read-inactivity
timeout per endpoint; these are not a total request deadline. Archive work runs in a worker
thread so it does not block the API event loop.

## Find observations

```sh
curl 'http://127.0.0.1:8000/api/observations?ra=269.4520769586187&dec=4.693364966576667&limit=10'
```

Supply ICRS RA/Dec in degrees. `limit` defaults to 100 and accepts 1–500.
The query follows [IRSA's plane/artifact search example](https://caltech-ipac.github.io/irsa-tutorials/spherex-cutouts/).
It returns covering Level 2 image-product metadata ordered by start time and
artifact identity. Products from different processing versions remain distinct;
`artifact_id` identifies an archive product, while `obs_id` alone is not unique.

Timestamps are converted from UTC MJD with Astropy. Detector wavelength bounds
are converted from metres to micrometres. `wavelength_center_um` remains null:
the wavelength at the requested target requires FITS calibration, and cannot be
inferred from the detector range. Product URLs are not downloaded or checked for
availability by this metadata search. They are not cutout URLs yet.

`total_count` counts returned records, not all matching archive products.
`truncated` indicates more results or archive-side overflow. This first version
returns only the earliest bounded subset; paging and date filtering are not
included. A valid empty result returns `no_coverage` for this public-product query.
Unusable rows produce `partial` with `rejected_count`, including when all rows
are unusable. Archive failures return HTTP 503; invalid response schemas return
502. Neither is reported as no coverage.

Successful metadata responses are cached for one hour, keyed by exact query
coordinates and limit. Empty and partial responses are not cached. Responses
include retrieval time, source, and cache status. Network requests have a 5-second
connect timeout and 30-second read-inactivity timeout, not a total deadline.
No image downloads or background jobs run when searching.

## Retrieve an image

Open <http://127.0.0.1:8000/docs> and expand `GET /api/cutout` to try it.
Supply a direct `access_url` from an observation-search response and its target
RA/Dec. An observation URL and both coordinates are required; there is no sample
fallback. `size_deg` is the angular box width (default 0.03, maximum 0.5 degrees),
and `stretch` accepts `zscale` (default), `linear`, or `log`.

The response contains flattened row-major arrays, with index `y * width + x`.
Rows retain FITS array order and coordinates are zero based. Images are limited
to 512 pixels per axis; oversized responses return HTTP 413.

- `pixels`: display values in [0, 1], with nulls for unusable pixels.
- `raw_flux`: un-stretched surface brightness in MJy/sr, including finite flagged values.
- `variance`: physical variance in (MJy/sr)^2, with squared unit conversion.
- `flags`: original integer bitmasks; `valid_pixels` records the display mask.

Nonfinite values are null, not zero. Display masks exclude nonfinite image data,
nonfinite or negative variance, and quality bits other than SOURCE (21) and
FULLSAMPLE (12). This is a conservative display policy, not a certification for
photometry. Available flag definitions are carried from the FITS header.
See [IRSA's flag documentation](https://irsa.ipac.caltech.edu/onlinehelp/spherex/help.pdf).
Statistics and contrast limits use only usable pixels. Linear and logarithmic
modes use min/max limits; logarithmic display applies Astropy LogStretch after
normalization, preserving negative physical values. ZScale uses Astropy's
ZScaleInterval. A constant field displays at 0.5 with unchanged physical limits.
An image with no usable pixels returns `no_usable_pixels` with null statistics.

The response includes the full celestial FITS WCS header with SIP coefficients,
the target pixel location, calibrated target wavelength and channel width,
processing version, exact source request URL, and FITS-cache status. Coordinates
and wavelength are computed before stretching. No background subtraction,
reprojection, aperture photometry, or integrated flux is performed.

Unusable archive/calibration content returns HTTP 502. Retrieval or local storage
failures return 503; invalid product URLs return 400. Invalid query parameters
return 422. Errors do not return placeholder images.

## Find catalog references

```sh
curl 'http://127.0.0.1:8000/api/catalog/sources?ra=269.4520769586187&dec=4.693364966576667&radius_arcmin=3&limit=5'
```

The SIMBAD cone search returns reference objects around an ICRS sky position.
`radius_arcmin` defaults to 3 and must be greater than zero and at most 30;
`limit` defaults to 50 and accepts 1–200. RA/Dec are required and follow the same
strict coordinate validation as other endpoints.

The query uses spherical cone geometry, ordering by angular distance and catalog
identifier. Astropy independently computes great-circle separations and checks
that returned positions lie within the cone. The API handles RA wrap and polar
positions without a flat-sky approximation. Each record includes its canonical
identifier, unmodified SIMBAD object-type code, coordinates, angular separation,
and available coordinate/proper-motion references. Missing values remain null.

`object_type` preserves the original SIMBAD code. `object_type_label` comes from
SIMBAD's `otypedef.description` table (for example, `Pl` is “Extra-solar Planet”
and `BY*` is “BY Dra Variable”). Missing descriptions remain null; unknown codes
are not guessed or replaced.

`sources_count` counts catalog records. `distinct_positions_count` counts exact
reported RA/Dec pairs among those records. `shared_position_groups` lists multiple
identifiers with exactly equal reported coordinates, and each member carries a
`position_group_id`. Every record, coordinate, reference, and proper motion is
preserved. Groups use no angular tolerance and infer no physical association,
host–planet hierarchy, independent astrometry, or image resolution. Nearby but
unequal coordinates stay separate. Group membership covers returned records only,
so a truncated result can contain an incomplete group.

For example, the five returned Barnard system records can describe one shared
reported position; this does not mean five separately detected image sources.
The response explicitly explains the grouping and keeps `image_match_verified`
false. The upgraded catalog cache uses a new namespace so older responses cannot
hide the new classification or grouping fields.

The endpoint records the actual SIMBAD primary/mirror service and retrieval time.
The response marks limited results with `truncated`; `sources_count` counts only
returned records. Bad rows produce `partial` and `rejected_count`, rather than a
false claim that no sources exist. A valid empty response is `no_sources`, which
means no records in this SIMBAD query, not an absence of astronomical objects.
Service failures return HTTP 503 and unusable response schemas return 502.

Successful searches are cached for six hours with exact coordinates, radius,
and limit. Empty and partial responses are not cached. Mirror fallback follows
the resolver's connection/read timeout policy and occurs for service failures,
not for an empty result. No FITS download or image processing is triggered.

These are catalog references, not verified image detections or source matches.
There are no invented identifiers, magnitudes, brightness rankings, reference
field lists, or generated fallback stars. Distinct records sharing coordinates
remain separate and do not imply resolved image components. Proper motion is
reported when available but is not propagated to an observation epoch. Image
pixel overlays and cross-identification are separate work.

## Extract spectral samples

```sh
curl 'http://127.0.0.1:8000/api/spectrum?ra=269.4520769586187&dec=4.693364966576667&limit=2'
```

This endpoint returns **nearest-pixel surface-brightness samples at a fixed ICRS
position**, not integrated source flux or PSF/aperture photometry. RA and Dec are
required. `limit` defaults to 2 and accepts 1–6 observations. Discovery uses the
same earliest-first bounded metadata search as `/api/observations`. Files are
fetched serially as 0.03-degree complete cutouts and reuse the validated FITS cache.
A first request may take time while IRSA searches and delivers files.

For each selected product, the full celestial WCS locates the requested position.
The nearest pixel supplies the un-stretched IMAGE value, VARIANCE, and FLAGS.
Wavelength and bandwidth come from the tabulated WCS **at that same pixel**.
The response records both the fractional target position and sampled pixel, plus
their angular offset. Samples are sorted by calibrated wavelength, with separate
artifact identities, detector, processing version, dates, and exact source URLs.

Brightness is reported in MJy/sr; the formal pixel uncertainty is the square root
of its variance after unit conversion. Systematic calibration uncertainty is not
included. Negative brightness is retained. Zero variance retains zero reported
uncertainty and gives null S/N. There is no synthetic noise floor, feature
injection, smoothing, interpolation, epoch averaging, or padding to 102 channels.

The shared conservative quality policy excludes bad target pixels without moving
to a neighbour. Excluded observations remain listed with reasons: bad pixel,
unusable calibration, or download failure. Metadata truncation and rejection are
reported. Empty archive results are `no_coverage`; all quality-rejected pixels
are `no_usable_data`; incomplete searches/downloads are `partial`. Metadata service
failures are HTTP errors, not empty spectra.

Background subtraction, deblending, source identification, aperture corrections,
and proper-motion propagation are not performed. Different dates can have real
variability; reprocessed products are correlated. These samples must not be
presented as a complete, simultaneous source spectrum. See the
[IRSA spectrophotometry description](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/sp.html)
for the distinct source-fitting workflow.

## Compare two observations

Use `POST /api/compare` in <http://127.0.0.1:8000/docs>. Supply:

- `access_url_a` and `access_url_b`: real direct product URLs from observation search.
- `ra` and `dec`: the common ICRS sky position.
- `size_deg`: image A angular width, default 0.03 and maximum 0.25 degrees.
- `stretch`: `zscale`, `linear`, or `log`, with one shared scale for both images.

Choose different exposures from the same detector. Reprocessed versions of one
exposure are rejected. Identity, detector, and observation time are read from the
actual FITS headers; client-provided dates or wavelengths are not accepted.
Image B uses a larger angular footprint to accommodate rotation. Downloaded data
reuse the complete-FITS cache. Reference A is limited to 256 pixels per axis;
input B is limited to 512.

The API registers B to A with `reproject.reproject_interp`, bilinear interpolation,
round-trip coordinate checks, and the complete celestial WCS including SIP.
It applies the shared pixel-quality policy before interpolation and retains only
output locations with a complete quality-screened four-pixel B neighbourhood.
This deliberately also excludes unused zero-weight neighbours and edge pixels.
Registration is based on WCS, not independently verified image-source alignment.

The wavelength screen uses the approximate WCS-WAVE visualization lookup.
For the target and every retained A pixel, all four B neighbours must satisfy
`abs(wave_A-wave_B) + 0.002 um <= min(band_A, band_B)`. The 0.002 um pair margin
is conservative visualization screening, not a formal uncertainty guarantee.
IRSA describes approximately 1 nm lookup accuracy and requires dedicated CWAVE
and CBAND calibration for science analysis; see
[IRSA's wavelength guidance](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products/).
The wavelength positions in the initial spectrum endpoint use this same
approximate lookup and are not precision CWAVE/CBAND calibration.

`blink_ready` is true only when observation times differ, the target passes,
and at least 16 common quality-screened wavelength-matched pixels remain.
Only ready responses contain `pixels_a` and `pixels_b`, with nulls outside
`valid_mask`. `coverage_mask` separately shows common quality coverage before
the wavelength screen. Both masks use A's row-major grid and full WCS header.
The pixel-count threshold is an operational minimum, not a detection statistic.
Joint display limits preserve relative brightness; numerical-flat fields display
at 0.5 without magnifying interpolation round-off.

Blocked preparations report `incompatible_wavelength`, `no_time_baseline`,
`no_usable_overlap`, or `insufficient_coverage`, with no blink arrays. Invalid
requests return HTTP 400/422; unusable data return 502 and retrieval failures 503.

This is **visual comparison only**. No PSF matching, background subtraction,
difference image, propagated reprojection uncertainty, motion measurement,
proper-motion estimate, or discovery claim is produced. Compatible-date discovery and multi-date preparation are described below.

## Prepare a multi-date sequence

Use `POST /api/compare/sequence` in <http://127.0.0.1:8000/docs>.
Supply `access_urls` containing **two to four distinct real product URLs**,
`ra`, `dec`, optional `size_deg` (default 0.03, maximum 0.25), and `stretch`
(`zscale`, `linear`, or `log`). Every selected product must use the same detector.
Reprocessed versions of one exposure and duplicate actual observation times are
rejected. Different timestamps on the same calendar day are allowed.

The first selected observation defines the reference grid. Frames retain request
order, even when that order is not chronological. Each later observation is
reprojected directly to the first grid using the full celestial SIP WCS, bilinear
interpolation, and round-trip coordinate checks. They are not successively
reprojected through intermediate frames. The same angular padding and image-axis
bounds as the two-observation API apply. There are at most four explicit FITS
retrievals, each using the existing complete-file cache and transfer limits.

All frames share one quality/coverage mask. Every epoch pair must pass the
wavelength rule at the target. At each retained reference pixel, every
cross-combination of the two frames' interpolation contributors must pass too.
Two frames that independently match the reference are not assumed to match each
other. `pair_checks` reports all 1, 3, or 6 epoch pairs for 2, 3, or 4 inputs.
Per-pair pixel counts use common quality coverage before intersection with
other-pair masks, so the final matched count can be lower. These checks still
use the approximate WCS-WAVE visualization lookup and the
same 0.002 um pair margin; they are not precision science calibration.

Ready responses contain exactly the requested number of frames. Each frame has
an `epoch_index` into the returned `epochs` list. Pixel arrays use the first
image's row-major grid, zero-based coordinates, full WCS header, and one common
`valid_mask`, with nulls for excluded pixels in every frame. One contrast range
is computed from all retained pixels across all selected images, preserving
relative brightness. No missing dates or pixels are synthesized.

The target and at least 16 common pixels must pass all pair checks before frames
are emitted. Blocked responses include epoch metadata and diagnostics but an
empty `frames` list. Their status identifies duplicate times, incompatible
wavelengths, missing common quality coverage, or insufficient matched coverage.
Invalid input is HTTP 400/422; unusable identity/calibration is 502 and retrieval
failure is 503. A failed image is not silently dropped to make a shorter sequence.

This endpoint prepares a **visual sequence**. It does not play an animation,
match PSFs, subtract backgrounds, generate difference images, propagate
reprojection uncertainties, measure motion, or claim a discovery.

## Find compatible dates

Use `POST /api/compare/matches` in <http://127.0.0.1:8000/docs>:

```json
{
  "ra": 269.4520769586187,
  "dec": 4.693364966576667,
  "detector": "D3",
  "from_date": "2025-08-15",
  "to_date": "2025-08-15",
  "candidate_limit": 4,
  "advance": false
}
```

RA and Dec are required. Optional `detector` accepts D1–D6; `from_date` and
`to_date` accept UTC calendar dates, with the end date inclusive.
`candidate_limit` defaults to 24 and accepts 2–64 metadata rows. The archive
query selects a bounded subset in that scope, with one extra row used to detect
truncation. Results are sorted by time locally; they are not guaranteed to be the
globally earliest products. This avoids expensive archive-wide sorting. Metadata
requests use a 5-second connect timeout and 45-second read-inactivity timeout.
IRSA can exceed this window even for small filtered queries; a timeout returns
HTTP 503 without caching an absence of matches. Reprocessed versions sharing
exposure ID and detector are counted once, using the first product returned by
the archive; this is not a claim that it is the latest processing version.

A passive request (`advance: false`, the default) may query archive metadata and
inspect already cached complete FITS files. It **does not download new images**.
Set `advance: true` to allow at most two new FITS retrieval attempts per request.
Each pass inspects at most 16 candidates, counting cache misses too, and checks
a 45-second work budget between items. Passive scans rotate through pending
candidates so later cached files are not starved by earlier cache misses.
Existing connection/read/transfer limits still apply; the batch budget is not a
hard total request deadline. Files use 0.03-degree cutouts at the target.

Progress is stored in the runtime SQLite cache for one hour from metadata
retrieval, keyed by exact coordinates, detector, date filters, and candidate
limit. Polling does not extend metadata freshness. Repeated passive requests and
application restarts reuse previous checks. Failed products are not retried
unless both `advance: true` and `retry_failed: true` are supplied. One matching
pass runs per backend process; overlapping matching requests return HTTP 409.
Use a single backend worker for this initial progress implementation.

The response separately counts verified, quality-excluded, failed, and pending
candidates. `can_continue` means unchecked candidates remain in this bounded set;
`can_retry_failed` signals explicitly retryable checks. Truncated metadata,
rejected rows, pending candidates, and failures keep `search_complete` false.
When the candidate cap is reached, narrow detector/date filters or increase the
cap; this version does not automatically page through the rest of the archive.
Empty results and archive failures are never reported as verified no-match
findings. A complete empty metadata query is `no_coverage` for that scope.

Each candidate uses actual FITS identity, UTC time, target quality, and approximate
WCS-WAVE wavelength/bandwidth. Pair checks reuse the comparison wavelength rule,
require the same detector and different exposure times, and are independent:
A matching B and B matching C does not certify A matching C. Results rank longer
time baselines first. At most 24 pairs are listed; `pairs_count` and
`pairs_truncated` describe that separate response limit.

Each pair includes a `comparison_request` body for `POST /api/compare`.
**These are target-position candidates, not prepared blink frames.**
`full_frame_verified` and `blink_ready` remain false until the full preparation
endpoint checks registration and every relevant image-pixel neighbourhood.
No difference image, motion estimate, or scientific discovery is produced.

## Background date-search jobs

`POST /api/compare/matches/jobs` accepts the same body as `/api/compare/matches`
and returns **202** with a job ID immediately. For example:

```json
{
  "ra": 269.4520769586187,
  "dec": 4.693364966576667,
  "detector": "D3",
  "from_date": "2025-08-15",
  "to_date": "2025-08-15",
  "candidate_limit": 2,
  "advance": false
}
```

Poll `GET /api/compare/matches/jobs/{job_id}` for status, stage, candidate count,
processed checks, download attempts, and the eventual `result`. Cancel remaining
work with `POST /api/compare/matches/jobs/{job_id}/cancel`. Polling never starts
queries or downloads. `candidate_count` remains null until actual metadata is
available; failures never produce fabricated or empty success results.

Each job runs **one bounded matching pass**, using the existing metadata, quality,
wavelength, and cache rules. `completed` means that pass finished: inspect
`result.status`, `result.pending_count`, `result.search_complete`, and truncation
before interpreting it as a complete search. Default `advance: false` permits
cached-file inspection only. Explicit `advance: true` permits at most two new
FITS retrieval attempts; it does not automatically repeat passes. Submit another
job to continue saved progress. Failed items are retried only with the existing
explicit `advance: true, retry_failed: true` controls.

One date-search worker admits at most **four queued/running jobs**, deduplicates
identical active requests, and retains at most **16 terminal records**. A full
queue returns **429** with `Retry-After`; unavailable or pre-restart IDs return
**404**. Job records live in memory, while bounded matching progress uses the
existing one-hour SQLite state expiry, fixed from metadata retrieval time.
Use a single backend process as required by the cache and search locks.

Stages are `queued`, `waiting_for_search`, `metadata`, `checking_files`,
`waiting_for_download`, `saving`, and `finished`. Job status is `queued`,
`running`, `completed`, `failed`, `cancelled`, or `expired`. Error codes distinguish
`archive_unavailable`, `invalid_metadata`, and `internal_error`; details and local
paths are not exposed. The result is null for failed, cancelled, or expired jobs.

Cancellation is cooperative. Queued work stops immediately; an in-flight metadata
request, download, or file check must finish or reach its existing timeout first.
While that happens, the job remains `running` with `cancellation_requested: true`.
No further operation starts after the worker observes cancellation. Verified
metadata and completed checks are saved when a checkpoint observes cancellation
or expiry, without renewing metadata age. Saving can fail; a later request may
repeat work. Cancelling during a failed metadata request creates no empty cache.

A **120-second soft budget** includes waiting for the shared search lock and
FITS download admission. Checkpoints enforce it between blocking operations; it
does not interrupt an operation already running. Existing per-pass checks and
transfer budgets still apply. The original synchronous endpoint keeps its
existing behavior and returns **409** if the shared search lock is occupied.
Cached image requests, health checks, and job polling can proceed during a slow
archive request. Shutdown cancels queued work in both background workers and
waits for their current operations to stop.

This is a local background wrapper around the existing synchronous IRSA TAP
query, not IRSA's remote asynchronous TAP/UWS interface. It prevents callers
from holding a long HTTP request open; it does **not** fix upstream availability,
raise the metadata timeout, or establish reliable live archive discovery.

A live local check on 2026-11-14 returned HTTP 202 in 0.04 seconds, kept health
and polling responsive during metadata retrieval, and finished cooperative
cancellation after 28.92 seconds. A subsequent cache-only job reused that real
metadata, verified one cached observation among two candidates, and made zero
new downloads. Its result remained partial and truncated, with no matched pair;
this validates job handling and recovery, not a complete live matching workflow.

## FITS retrieval and parsing

The internal `FitsStore` service downloads target-centred cutouts from direct
IRSA Level 2 product URLs returned by observation search. The public image endpoint uses this service.

```python
from app.services.fits_download import FitsStore
from app.services.fits_parser import open_observation

# access_url comes from an actual /api/observations response.
store = FitsStore("cache/fits")
with store.lease(access_url, ra_deg, dec_deg, 0.03):
    result = store.fetch(access_url, ra=ra_deg, dec=dec_deg, size_deg=0.03)
    with open_observation(result.path) as observation:
        x, y = observation.target_pixel(ra_deg, dec_deg)
        wavelength_um, channel_width_um = observation.wavelength_at(x, y)
```

The parser retains the science image, integer quality flags, variance, zodiacal
model, PSF/ePSF, full celestial SIP solution, and tabulated wavelength WCS.
It preserves native array values, NaNs, headers, processing version, and units;
it does not subtract backgrounds, mask flags, integrate flux, or replace pixels.
Arrays and WCS objects should be used inside the open-file context.

Science planes must have matching two-dimensional shapes, with a maximum of
2048 pixels per axis. Surface-brightness and variance units must be compatible
with MJy/sr and its square, respectively. Missing calibration, invalid dimensions,
incomplete files, and present-but-invalid checksums are rejected. Missing checksum
keywords are permitted and do not imply checksum verification. The requested
target must fall within the celestial image and have usable wavelength calibration.

Downloads allow HTTPS IRSA products only and reject redirects, partial HTTP
responses, HTML/DataLink responses, and files over 128 MiB. Cutout widths must be
greater than zero and at most 1.5 degrees. Connections have a 5-second connect and
30-second read-inactivity timeout. A 90-second transfer budget is checked between
chunks; an in-progress read can still run until its read timeout.
Validated files are published atomically to the runtime cache; failed temporary
downloads are removed. Cache identity includes the exact URL, target, and width.
There is no sample fallback or automatic retry. Background retrieval requires an
explicit cache job as described below.
The API uses `backend/cache/fits` by default (alongside the metadata database),
or `FITS_CACHE_DIR` when supplied. Source data stays out of Git.

## Local cache

The backend creates an empty SQLite database at `backend/cache/aurax.db` during
startup. Set `CACHE_DB_PATH` to use another writable filesystem path.
Importing the application does not create a database or make archive requests.

The internal cache stores JSON metadata with separate namespaces and optional
expiry. Expired entries are never returned; startup removes expired rows, and
internal callers can use `purge_expired()`. Runtime cache failures return a miss or failed write.
Invalid storage configuration fails visibly at startup.

FITS payloads have a default **512 MiB** budget, separate from the SQLite database.
Configuration values are integer bytes or seconds:

| Variable | Default | Meaning |
| --- | --- | --- |
| `FITS_CACHE_MAX_BYTES` | `536870912` | Total managed FITS and temporary payload budget |
| `FITS_CACHE_MAX_FILE_BYTES` | `134217728` | Per-download limit; must fit inside the total budget and cannot exceed 128 MiB |
| `FITS_CACHE_MAX_IDLE_SECONDS` | `604800` | Remove unused FITS payloads after seven days; `0` disables idle expiry |

Cleanup runs at startup and before admitting a new download. Unused files expire
by filesystem last-use time, not their astronomical observation date. Remaining
files are evicted oldest-use first when space is needed. Orphan temporary files
expire after one hour; fresh partial files and active requests are protected.
The image, spectrum, comparison, sequence, and date-search services hold leases
through file processing. Internal callers must likewise keep `store.lease(...)`
open until they finish using the returned path.

New downloads are serialized per cache directory. Each reserves space for its
full per-file limit before contacting the archive, so admission may fail even
when the eventual file would have been smaller. If active files or fresh partials
prevent enough space from being freed, the request fails without downloading.
Existing cached reads can continue while another file downloads. Storage failures
are reported as unavailable responses; data is never fabricated to fill a miss.

Use **one backend worker**, with no other process sharing the FITS directory.
Leases and admission locks are process-local; this is not a multi-process quota.
Cleanup is triggered by startup or new download admission, not a scheduled job.

Cleanup only handles regular, single-link files with the application's exact
hash-based FITS or temporary names, in a dedicated directory marked
`.aurax-fits-cache`. An existing directory can be adopted only if all entries
match those managed names. Symlink roots are rejected. Unrelated files,
subdirectories, symlinks, and hard links are preserved and excluded from the
payload quota; do not put source data in this runtime directory.

`GET /api/cache/status` reports configured limits, managed byte/file counts,
active downloads, protected files, and whether the directory is over quota.
It is read-only, exposes no local paths, and does not trigger cleanup or downloads.
There is no public cleanup endpoint. Explicit background cache jobs use the same
storage policy and do not bypass the quota.
Cache files are ignored by Git; no observation data or seed database is included.

## Background cache jobs

`POST /api/cache/jobs` returns **202** with a job ID and progress snapshot. Supply
one to four distinct direct IRSA product URLs from an observation search, a fixed
ICRS target, and an optional cutout width (default `0.03`, maximum `0.5` degrees):

```json
{
  "access_urls": ["<direct access_url from /api/observations>"],
  "ra": 269.4520769586187,
  "dec": 4.693364966576667,
  "size_deg": 0.03
}
```

Replace the placeholder with an actual product URL; it is not a downloadable
example. The complete request is validated before anything is queued.
No archive discovery, recursive fetching, startup downloads, retries, or automatic
resumption occur. Only the submitted products can be retrieved.

Use `GET /api/cache/jobs/{job_id}` to poll progress and
`POST /api/cache/jobs/{job_id}/cancel` to cancel remaining work. Cancellation of a
queued job is immediate. A running transfer finishes or reaches the existing
transfer timeout before cancellation stops the next product. A running job remains
`running` with `cancellation_requested: true` until it actually stops.

One worker handles jobs in submission order. At most **four jobs** may be queued
or running; a full queue returns **429** with `Retry-After`. An identical active
request reuses its existing job ID. Cached validated files are reused; missing
files are fetched serially through `FitsStore`, respecting its leases, quota,
per-file limit, full-file validation, and transfer budgets. Waiting for the shared
foreground download lock also counts toward the job's **120-second soft budget**.
The budget is checked between products and while waiting for download admission;
it does not interrupt a transfer or parser already in progress.

Job states are `queued`, `running`, `completed`, `partial`, `failed`, `cancelled`,
or `expired`. Per-product states and the `cached` and `size_bytes` fields show
actual results; failures leave those fields null and report a short error code.
`partial` means some products succeeded and others failed. An `expired` or
`cancelled` job can retain completed items; skipped or cancelled items were not
successfully processed. No response contains local filesystem paths.

A completed job records retrieval success at processing time. Its files can later
be evicted by normal cache policy; completion does not promise continued residency
or verify compatibility for a comparison. Continue using the normal image or
comparison endpoints for scientific preparation.

Jobs and the latest **16 terminal job records** live only in memory in the single
backend process. Unknown, pruned, or pre-restart IDs return **404**. This is not a
durable task queue or a public multi-user scheduling service. On application
shutdown, queued work is cancelled and the worker waits for its current bounded
transfer to finish without beginning another product. Normal cached reads and
health requests remain available while background downloads run; foreground
cache misses share download admission and can wait for the current transfer.

## Verify

From `backend/`:

```sh
uv run --locked pytest
uv run --locked ruff check .
uv run --locked ruff format --check .
```

Tests run without astronomy archive access or downloaded observation data.


The [Backend checks workflow](https://github.com/Thawshi-Srikanth/01-AuraX-2026/actions/workflows/backend.yml)
runs locked dependency installation, code checks, formatting checks, and the test
suite on Python 3.11 and 3.12 for backend pushes and pull requests. It can also be
started manually. These checks do not establish live archive availability.

The 2026-11-14 release check passed locked installation and 341 backend tests
locally on Python 3.12 and in GitHub checks on Python 3.11 and 3.12. The existing real cached-file image/sequence/job checks
also pass. A live one-day D3 date-search query still timed out after the configured
45-second metadata read timeout and returned HTTP 503. The full live date-search
workflow remains unverified; a timeout is not evidence of missing sky coverage.
The frontend has not yet been migrated, and scientific subtraction and motion
measurement are not provided by this backend.


The 2026-11-14 timeout investigation traced the delay to the archive's
`POST /TAP/sync` request. One two-candidate, one-day D3 query succeeded in
34.49 seconds, returning two usable metadata products with truncation correctly
reported. Later direct record and plane-only probes timed out, as did the actual
date-search endpoint (HTTP 503 after 45.64 seconds). A minimal GET probe also
reached its 15-second diagnostic timeout. These probes do not establish an
archive outage or a query-planner defect, and they do not demonstrate a faster
transport or query rewrite. No production query or timeout was changed.

Transport-failure regression tests exercise real PyVO exception wrapping, ensure
failures do not create cached empty results or trigger FITS downloads, and verify
that a later successful metadata response can make progress. A complete live
metadata-to-matched-images workflow is still unverified. The existing successful
cached-image checks do not remove that limitation.

The spatial predicate and plane/artifact join follow the
[official IRSA SPHEREx cutout tutorial](https://github.com/Caltech-IPAC/irsa-tutorials/blob/main/tutorials/spherex/spherex_cutouts.md).
[IRSA's TAP documentation](https://irsa.ipac.caltech.edu/docs/program_interface/TAP.html)
describes both synchronous and asynchronous query modes. Slow metadata discovery
now has the local background/resumable workflow described above. Increasing the
synchronous timeout alone would not establish reliable live availability.
