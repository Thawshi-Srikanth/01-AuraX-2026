# SPHEREx challenge audit — 15 November 2026

## Decision

Deployment is working according to the user; deployment work is closed for this
pass. The remaining core software gaps have been addressed, and all five named
target fields have now returned four real, registered SPHEREx images. This is
software and data-pipeline validation. A subsequent Epsilon Indi B example now
passes matched blink and a six-reference exploratory displacement check consistent
with catalog motion. Precision astrometry and convincing source demonstrations for
all five targets remain incomplete, especially where the stellar cores are masked.

Keep existing saved spectral samples. ePSF and HiPS-cube additions are explicitly
out of scope by user decision. Focus current work on the challenge's coordinate
entry, real images, usable time sequences and five-target validation.

## Current objective assessment

| Objective | Assessment | Evidence / remaining limit |
| --- | --- | --- |
| Public-facing tool | Deployment confirmed by user | No new deployment work or independent public-URL check in this pass. |
| Enter RA and declination | Implemented | Decimal-degree ICRS input, coordinate URLs, preserved manual/saved positions. |
| Display real SPHEREx images | All five benchmark fields validated | Four calibrated cutouts per field; original FITS URLs and timestamps retained in the live report. |
| Display a sequence like a video | Implemented and browser checked | General registered playback accepts mixed passbands with warnings; matched blink retains stricter checks. |
| Help identify moving objects | One catalog-consistent time example checked | Epsilon Indi B: 508.6 days, closely matching passbands, six field-reference peaks and an apparent shift consistent with catalog motion. No precision astrometry or discovery is certified. |
| Test the five required targets | Image/registration and cached position-quality checks completed | Does not establish source identities or motion. R Draconis coverage improved to 77.8%, but its predicted core remains masked. |

## Real-data validation

The [checked Epsilon Indi B example](epsilon-indi-example-validation-2026-11-15.md)
adds a useful known-motion illustration: full matched blink passes on 93.76% of
the 50-pixel field. Its exploratory relative shift is about 6.7″, versus a 6.5″
catalog expectation and 0.6″ reference RMS. These diagnostics do not constitute
formal significance or a precision motion measurement. Home now links directly
to the two real observations; Analyse still retrieves FITS and reruns all checks.
No pixels are bundled or fabricated, and the search does not claim completeness.

The [machine-readable report](challenge-validation-2026-11-15.json) records bounded
metadata searches and sequential requests to the local comparison API. Each field
uses a nominal 50-pixel (about 5.2-arcminute) target-centred cutout. Metadata comes
from two date windows, with at most 12 retained candidates; only four selected
images are prepared. Results are truncated archive subsets, not complete histories.

Initial selections, before the R Draconis replacement described below:

| Target field | API preparation | Frames | Actual baseline (days) | Common quality-screened pixels |
| --- | --- | --- | --- | --- |
| Barnard's Star | ready | 4 | 402.76 | 1826 / 2500 (73.0%) |
| Epsilon Indi B | ready | 4 | 508.65 | 2039 / 2500 (81.6%) |
| RW Aurigae | ready | 4 | 172.30 | 2004 / 2500 (80.2%) |
| R Draconis | ready | 4 | 445.48 | 35 / 2500 (1.4%) |
| WISE 0855 | ready | 4 | 350.50 | 1873 / 2500 (74.9%) |

All five final preparations returned HTTP 200 and `visual_playback_ready=true`.
These general sequences are not wavelength-matched blink certificates. A successful
HTTP response does not establish that the intended source is visible in the mask.

### R Draconis selection improvement

The [replacement report](r-draconis-selection-validation-2026-11-15.json) records
the original four-image selection and a selection replacing only its D4 frame.
That frame had just 37 usable pixels on the 2,500-pixel reference field and carried
the DICHROIC flag at the requested position. The replacement raises shared usable
coverage from 35 to 1,945 pixels: **1.4% to 77.8%**, over **459.94 days**. All four
real images are retained; no flags, masks or interpolation rules are relaxed.

The requested position still carries OVERFLOW, SUR_ERROR and BLOOM flags, and
its science image value is nonfinite. The SOURCE flag is informational. These
names come directly from the original FLAGS header, whose definitions are described
in the [official image tutorial](https://caltech-ipac.github.io/irsa-tutorials/spherex-intro/).
Better surrounding coverage does not restore a usable stellar core measurement.

### Position-quality checks for all five fields

The [cached position-quality report](challenge-position-quality-2026-11-15.json)
uses the original four selected observations per target. Catalog proper motions
are propagated to each actual observation epoch with Astropy; no new downloads
are made. Distance, radial velocity, parallax and perspective corrections are
omitted. These are approximate predicted positions, not image associations.

| Target | Usable predicted centre pixels | Interpretation |
| --- | --- | --- |
| Barnard's Star | 0 of 4 | These selected core pixels are masked; inspect other observations and source wings before claiming visible motion. |
| Epsilon Indi B | 4 of 4 | Usable measurements exist at predicted positions; identity and resolving the binary remain unverified. |
| WISE 0855 | 4 of 4 | Usable measurements do not establish detection of a faint source. |
| RW Aurigae | 1 of 4 | The selected D1 centre is usable; the other three centres fail quality checks. |
| R Draconis | 0 of 4 | The core is masked even though a replacement improves the surrounding field. |

Two additional [Barnard D6 checks](barnard-alternative-band-2026-11-15.json),
selected from the ends of the 17 D6 observations in a bounded 100-product list,
also have masked predicted centre pixels carrying OVERFLOW and BLOOM flags.
These two small cutouts were fetched sequentially. This is evidence about those
two exposures, not proof that every observation or every band is unusable.

The app now discloses shared coverage, per-image coverage, requested-position
quality and native flag names. A labelled cyan cross marks requested coordinates;
it never represents a confirmed detected source. Replacement controls preserve
the other selections and require an explicit Analyse action for new downloads.

A separate browser check used four D1 R Draconis observations between 21 July and
4 August 2026. It showed 79.8% shared coverage. Choosing replacement for image 3
preserved the other three selections and opened the observation list without
preparing new images. Selecting the 25 July D1 image and pressing Analyse returned
four real frames and **80.8% shared coverage**. This shorter sequence demonstrates
the replacement workflow, not a measured variable-star light curve. The grid's
minimum height was also corrected so its rows do not overlap the quality warning.

Initial image requests intermittently failed with 503. A direct IRSA cutout
response reported “Server busy, retry later.” Downloads now retry one 502/503/504
response, with a wait capped at five seconds. Failed checks were repeated in bounded
passes using recorded metadata; final successes do not erase recorded failed
attempts. Persistent errors are reported, never replaced with invented images.
Partial streams are not retried as if complete files.

Browser checks verified the corrected Epsilon Indi B preset and the exact original
supplied WISE coordinates. A four-frame general sequence using previously cached
real cutouts displayed in Grid; Play switched to Sequence, advanced from frame 1
to frame 2, and Pause stopped it. That UI check used the existing fixed field at
RA 269.45208, Dec 4.69339, not a new identification of Barnard's Star.

## Positions and epoch handling

The old Epsilon Indi B and R Draconis examples were offset by about 6.7 and 14.9
arcminutes respectively. Those errors exceeded the default field half-width.
Barnard's high proper motion also made an unlabelled J2000 centre inappropriate
for a small mission-era field.

The five examples now share one [catalog-backed definition](../frontend/src/data/challengeTargets.ts)
in Home, search, and the default target. SIMBAD ICRS J2000 reference positions and
proper motions set an approximate fixed J2025.5 field centre. The computation was
checked against independent Astropy space-motion calculations. Parallax and
perspective corrections are omitted and disclosed. All frames keep this one
field; independently tracking and recentering the star would hide its motion.

Manual inputs and saved targets are unchanged. Only obsolete app-generated sample
sessions migrate. Home separately preserves the exact supplied WISE 0855 position
without assigning an unsupported epoch.

Primary coordinate references:

- [Barnard's Star](https://simbad.u-strasbg.fr/simbad/sim-basic?Ident=Barnard%27s+Star)
- [Epsilon Indi B](https://simbad.u-strasbg.fr/simbad/sim-id?Ident=%2A+eps+Ind+B)
- [WISE 0855](https://simbad.harvard.edu/simbad/sim-id?Ident=WISE+J085510.83-071442.5)
- [RW Aurigae](https://simbad.cds.unistra.fr/simbad/sim-id?Ident=RW+Aur)
- [R Draconis](https://simbad.u-strasbg.fr/simbad/sim-id?Ident=R+Dra)

## Temporal comparison and loading

General comparison suggests up to four distinct images spaced across the retrieved
list. Date, detector, release, text and sort filters preserve selected images in
a visible tray. Analyse images stays at the top. Selection changes do not trigger
new image downloads. Both views retain the nominal 50-pixel default and selectable
larger fields; cutouts are retrieved sequentially.

Matching-wavelength mode defaults to a 30-day minimum gap, adjustable to any
distinct time, 1, 30, 90 or 180 days. Discovery interleaves candidates by detector
from two bounded date windows. It does not guarantee the oldest/latest observations
or a compatible pair. Every candidate still needs real calibration. The SIA
fallback's date-interval serialization was fixed and tested through the actual
PyVO query constructor.

General Sequence uses common quality coverage, even with different passbands.
Strict matched Blink separately checks detector, times, target and every pair's
local wavelengths. Wavelength changes, PSF differences and artifacts can imitate
motion or variability. Neither mode measures motion or claims a discovery.

## Optional additions

| Feature | Decision |
| --- | --- |
| Saved-target spectral samples | Keep: real nearest-pixel surface brightness, formal errors, dates and FITS links; 2–6 bounded observations. Includes background and may mix dates; not a complete source spectrum. |
| ePSF inspector | Out of scope by user decision; do not add. |
| HiPS cube explorer | Out of scope by user decision; do not add. |
| Coadds, difference images and measured motion | Outside the current work; prioritize the required image sequence and target validation. |
| Gaia/WISE overlays | Outside the current work; no dedicated integration planned in this scope. |

Official background: [ePSF tutorial](https://caltech-ipac.github.io/irsa-tutorials/spherex-psf/)
and [HiPS-cube tutorial](https://caltech-ipac.github.io/irsa-tutorials/spherex-hipscube/).
The latter limits cube-extracted spectra to visualization.

## Verification and remaining work

418 backend tests and 145 frontend tests pass after the final merge review,
including a regression check for signed FITS flag words. Backend lint, frontend lint,
TypeScript production build and whitespace checks pass. The frontend build still
reports its existing large-bundle warning.

The Home FAQ and comparison guide now describe real saved spectral samples,
general playback and strict matched blink accurately. Public availability is
accepted from the user's deployment confirmation, not independently certified here.

Before claiming the challenge is scientifically demonstrated, identify the intended
sources in the images, inspect stable reference stars and quality masks, find
usable core measurements where available, and assess whether apparent changes exceed image,
passband and astrometric limitations. These observation-validation requirements
are the remaining priorities within the agreed scope.
