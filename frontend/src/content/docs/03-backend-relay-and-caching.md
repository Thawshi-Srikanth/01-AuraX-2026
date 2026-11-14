AURAx connects your selection to archived measurements. Understanding this route helps distinguish a slow download, an empty archive query, and a problem reading an image.

## Follow an archive request

![A target selection flows through AURAx to the IRSA archive, with a local cache branch and a return path for FITS data.](/assets/docs/archive-flow-v2.png)

*Schematic of the request and return path. AURAx requests archive records and files; the cache stores reusable results. The archive remains the source of the observations.*

1. **Choose a position.** A target name is resolved to coordinates, or you supply coordinates directly.
2. **Find coverage.** The backend queries IRSA for observation footprints containing that position.
3. **Select a file.** The chosen record identifies an exposure and its access information.
4. **Read the data.** The backend retrieves the FITS product, extracts the requested region, and prepares information for the viewer.

Finding an archive record does not mean the full image has already downloaded. These are separate stages and can fail independently.

## What the cache changes

The application uses persistent SQLite storage for reusable query results, local storage for FITS files, and memory caches for selected processed results. The viewer can also reuse previously loaded cutouts and prefetch nearby frames.

A cache hit avoids repeating some work. It does not improve the scientific precision of an image or guarantee a fixed response time. A cached archive query may reflect an earlier query rather than the newest available archive contents.

## Read failures correctly

- **No coverage:** the query returned no matching observations under its constraints.
- **Archive unavailable:** a remote service or network request failed.
- **Image unavailable:** metadata was found, but the file could not be downloaded or read.
- **Cached result:** an earlier stored response or file was reused.

The observation-query service does not manufacture replacement exposures when IRSA is unavailable. A bundled sample or preset, where offered, must be distinguished from a fresh archive query.

## Where this happens in the application

For readers inspecting the implementation:

- The SIMBAD service handles target resolution and known benchmark targets.
- The TAP service searches observation footprints.
- The FITS service handles file retrieval and image processing.
- The comparison service prepares pairs of images.
- The cache manager stores reusable query responses.

The current service files are named simbad_service.py, tap_service.py, fits_service.py, and compare_service.py. Cache handling lives in app/db/cache.py. These names describe implementation locations, not additional steps a reader needs to perform.

## Further reading

The [official SPHEREx data-access guide](https://github.com/Caltech-IPAC/spherex-archive-documentation/blob/main/documentation/spherex_data_access.md) explains archive access independently of AURAx.
