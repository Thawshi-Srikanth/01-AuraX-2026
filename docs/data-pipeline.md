# FITS and cache data pipeline

[Documentation](README.md) · [Architecture](architecture.md)

- [FITS retrieval and parsing](#fits-retrieval-and-parsing)
- [Local cache](#local-cache)
- [Background cache jobs](#background-cache-jobs)

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
