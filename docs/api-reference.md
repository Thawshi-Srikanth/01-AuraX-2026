# API reference

[Documentation](README.md) · [Architecture](architecture.md)

- [Resolve a target](#resolve-a-target)
- [Find observations](#find-observations)
- [Retrieve an image](#retrieve-an-image)
- [Find catalog references](#find-catalog-references)
- [Extract spectral samples](#extract-spectral-samples)
- [Compare two observations](#compare-two-observations)
- [Prepare a multi-date sequence](#prepare-a-multi-date-sequence)
- [Find compatible dates](#find-compatible-dates)
- [Background date-search jobs](#background-date-search-jobs)

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

If an IRSA TAP query fails, observation and comparison-candidate searches
automatically try IRSA's official SIA2 service at
`https://irsa.ipac.caltech.edu/SIA`. TAP remains the first choice for each fresh
search. The fallback searches the DR1 and QR3 wide and deep Level 2 image
collections, using exact-position coverage and the same validated FITS download
and calibration pipeline. It never substitutes generated observations or images.
Responses identify SIA as their source and retain that provenance when cached.
SIA retries a transient HTTP 502, 503, or 504 once, with bounded network timeouts.

SIA results are a bounded archive-selected subset, sorted locally by observation
time; they are not guaranteed to be the oldest matching archive products.
Comparison date intervals are sent to SIA, with start-time and detector checks
applied locally. Limits and overflow remain visible even if those checks remove
rows. Newly ingested data can lag TAP by about a day. Failure of both services
returns 503; unusable SIA metadata returns 502, rather than claiming no coverage.

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
- `flags`: original integer bitmasks; `valid_pixels` records the strict analysis mask.
- `display_valid_pixels`: finite, displayable image data; warnings remain visible.
- `display_warning_pixel_count`: displayed pixels excluded from measurements.

Nonfinite values are null, not zero. Analysis masks exclude nonfinite image data,
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
(`zscale`, `linear`, or `log`). The default `comparison_kind="matched"` requires
one detector, unique exposure identities, distinct actual times, and the wavelength
checks below. Different timestamps on the same calendar day are allowed.
`comparison_kind="general"` permits different detectors, passbands and simultaneous
observations while retaining product-identity and calibration checks.

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
image's row-major grid, zero-based coordinates, and full WCS header. Matched mode
uses the common `valid_mask`; general mode uses `display_mask` while retaining
`valid_mask` as stricter diagnostics. Excluded display pixels are null in every
frame. One contrast range
is computed from all retained pixels across all selected images, preserving
relative brightness. No missing dates or pixels are synthesized.

In matched mode, the target and at least 16 common pixels must pass all pair checks
before frames are emitted. General mode instead requires 16 common quality-screened
pixels and uses `display_mask` for exploratory playback. `visual_playback_ready`
reports playback availability; `blink_ready` separately certifies the stricter
time, detector, target and wavelength checks. Blocked responses include epoch metadata and diagnostics but an
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
