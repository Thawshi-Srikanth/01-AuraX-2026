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
- Explicit configuration of allowed browser origins.
- Persistent SQLite metadata cache with namespaces and optional expiry.
- Automated backend tests.

The image viewer, comparisons, and the frontend have not been migrated yet.

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

## FITS retrieval and parsing

The internal `FitsStore` service downloads target-centred cutouts from direct
IRSA Level 2 product URLs returned by observation search. The public image endpoint uses this service.

```python
from app.services.fits_download import FitsStore
from app.services.fits_parser import open_observation

# access_url comes from an actual /api/observations response.
store = FitsStore("cache/fits")
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
There is no sample fallback, automatic retry, background download, or total disk
quota yet. The API uses `backend/cache/fits` by default (alongside the metadata database),
or `FITS_CACHE_DIR` when supplied. Source data stays out of Git.

## Local cache

The backend creates an empty SQLite database at `backend/cache/aurax.db` during
startup. Set `CACHE_DB_PATH` to use another writable filesystem path.
Importing the application does not create a database or make archive requests.

The internal cache stores JSON metadata with separate namespaces and optional
expiry. Expired entries are never returned; internal callers can remove them
with `purge_expired()`. Runtime cache failures return a miss or failed write.
Invalid storage configuration fails visibly at startup.

There are no public cache-management endpoints or background downloads.
Cache files are ignored by Git; no observation data or seed database is included.
The cache does not yet impose a disk quota; bounded background caching comes later.

## Verify

From `backend/`:

```sh
uv run --locked pytest
uv run --locked ruff check .
uv run --locked ruff format --check .
```

Tests run without astronomy archive access or downloaded observation data.
