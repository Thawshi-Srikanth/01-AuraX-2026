A difference between two images is a starting point for investigation. Before interpreting it as motion or variability, establish that both images measure comparable light on the same sky grid.

## Follow the comparison order

![Two rotated grids are aligned using the same reference stars before an illustrative target-position offset is inspected.](/assets/docs/epoch-comparison-v2.png)

*Schematic, not measured motion. Orange and cyan distinguish the two dates. Stationary reference stars should align before you assess a target's apparent displacement.*

1. **Match wavelengths.** Use the passband at the target position and its channel resolution.
2. **Match sky coordinates.** Register both images onto one astrometric reference grid.
3. **Check quality.** Inspect flags, background, usable overlap, PSF differences, and uncertainty.
4. **Inspect the residual.** Compare the target and nearby reference stars.

Blinking emphasizes changes; it does not establish their cause.

## Try the checked Epsilon Indi B example

Home includes **Try a checked Epsilon Indi B time comparison**. It selects two
real D3 observations from 1 May 2025 and 22 September 2026, about 509 days apart,
with closely matching target wavelengths near 1.72 microns. Press **Analyse images**,
then **Play**. Look for a small shift near the fixed cyan coordinate cross while
the surrounding field stays aligned. Zoom or mark the area to inspect it.

This is an illustration consistent with catalog motion. A separate exploratory
check compared the target with six nearby field peaks; it does not provide
precision astrometry, confirm a new object or resolve the binary components.
The example uses exactly two real observations and runs the same live FITS,
wavelength and quality checks as other selections. **Browse archive images** returns
to general comparison, where you can select up to four images yourself.

## Browse observations in Images

Play in Images steps through the filtered observation list, even when wavelengths
or alignment differ. Each loaded image remains visible for one second; playback
waits for downloads, pauses on a failed image, and stops on manual selection or
filter changes. Pause is available while buffering. Each image shows its actual
UTC date and local target wavelength when available.

This is an observation browser. A visible change may come from a different
passband, registration, background or image quality; it does not establish motion
or variability. Use the registered sequence in Compare images for visual comparisons.

## Use Compare images

**General images** is the default. Select two to four real observations from the
retrieved archive list, including different detectors, wavelengths, or simultaneous
exposures. The linked grid registers them to the same sky coordinates and uses a
shared display scale over their common usable area. Each frame shows its actual
UTC time and wavelength at the target. The date and detector filters apply to the
retrieved list; a limited list does not establish complete archive coverage.

Four distinct images are suggested when available. Use the visible detector,
release, date, search, and sort controls to find images. Selected images stay in
the tray at the top even when filters hide them. **Select four** replaces the
selection with up to four distinct images from the filtered list. **Load more
images** expands the retrieved metadata list within the displayed limit.
Press **Analyse images** at the top to prepare your selection. Changing a filter
or checkbox does not automatically start another image-preparation request.

Compare stays within the screen height. The image grid and timeline remain in
place while the observation list and right-hand panel scroll independently.
The left sidebar has **Images** for selecting observations and **Filters** for
comparison mode, detector, release, dates, search and sorting. Switching tabs
preserves filters and selected images. Image replacement opens the Images tab.
Use the **Controls** tab for Play/Pause, frame stepping, frame interval, Fit images
and Mark area. Use **Quality** for shared coverage, masks and image replacement;
**Details** contains alignment checks, timestamps, provenance and marked areas.
On narrow screens, the tabbed panel sits below the image area within the same screen.

Read **shared usable sky** before interpreting a mostly dark field. Open the
**Quality** tab to see how much of the reference field each image covers.
Choose **Choose replacement for image…** to free that slot and open observations,
then select another image and press **Analyse images**. This preserves your other
selections and starts no download until you press Analyse.

The cyan cross marks your requested RA/Dec. It is not a source identification or
a prediction of where a moving object lies in every observation. A masked position
has no usable displayed measurement; it is not a zero flux measurement. Native
flag names come from each original FITS header. SOURCE and FULLSAMPLE are
informational; overflow, processing errors and other excluded pixels remain masked.

Both Images and Compare default to a target-centred field about 5.2
arcminutes wide. Larger field options remain available in the display controls.
This changes the angular cutout area while preserving calibrated native pixels.
The actual FITS dimensions can differ from the nominal control size. Comparison
cutouts are retrieved one at a time; detectors can be included or excluded
individually using the checkbox dropdown.

Different passbands can reveal different structures and brightnesses. Those
differences alone do not establish variability or motion. The grid does not
require a wavelength match, but it still requires valid calibrated images and
at least 16 common quality-screened pixels. **Sequence** and **Play** step through
these registered frames, with an explicit warning about different passbands.
This exploratory playback does not certify comparable wavelengths.

Choose **Matching wavelengths over time** for the more restrictive search below.

This mode defaults to a **30-day minimum time gap**. Choose any distinct time,
1, 30, 90 or 180 days to change it. The search interleaves products from two
bounded date windows before downloading calibration cutouts. It does not guarantee
the archive's earliest or latest observation or a detectable change in a source.

AURAx first checks the wavelength **at your chosen sky position**, then suggests observations within a compatible group. It favours four dates spread over the available time span; if only two or three verified dates are available, it uses those. Press **Analyse images** to prepare the selected frames; playback opens paused. Use **Play** to blink. Play also switches from Grid to Blink for you.

Use the single **Wavelength at target** control to choose another matched group. Only compatible observations appear in its date checklist. Uncheck a date to replace it, or choose **Use suggested dates** to return to the automatic selection. Detector colours remain tied to the scientific bands. The broad archive band midpoint is not used as the local wavelength calibration.

The matching search reuses cached calibration and checks up to three bounded
batches. Each batch can download at most two calibrated cutouts. Pending checks
continue even when the candidate list is truncated or the search is partial;
failures stop automatic work. **Check more observations** explicitly continues
the search. It uses a bounded archive-selected candidate set, not a complete scan
of every observation or guaranteed newest/oldest pages.

Read the search status carefully. A partial search or failed calibration is not proof that no matching dates exist. Only a fully searched, fully checked result can report that no compatible dates were found. If the candidate limit is reached, narrow the date range. Cached matches can remain usable during an archive interruption.

Open **Filters & display** for the date range, field size, stretch, shared contrast, and grayscale inversion. **Grid** shows the selected observations together with linked zoom and pan. **Mark** inspects the same small sky-grid area across every date. The marker is an inspection aid, not an object identification or motion measurement.

The timeline shows real UTC timestamps. Playback uses equal frame intervals even when the dates are unevenly spaced. Longer time gaps may reveal motion that is invisible in adjacent exposures.

In matching-wavelength mode, final preparation checks full sky alignment, quality overlap, and wavelength compatibility at every blink pixel. Target-position matching alone does not certify an entire field. Every frame must match every other frame, including the last-to-first playback transition. Failed strict checks do not enable matched blink. Missing or failed observations are never replaced with a sample.

The five challenge presets use catalog positions and proper motions to choose one
fixed approximate J2025.5 field centre. This avoids placing fast-moving stars
outside a small cutout centred on a J2000 position. It is not an image detection or
a precision position prediction: parallax and perspective effects are omitted.
All frames keep the same sky field so apparent motion remains visible. Manually
entered and saved coordinates are preserved; Home also retains the original
supplied WISE 0855 position as a separate choice.

## Align with the full WCS

A World Coordinate System maps detector pixels to sky coordinates. Rotating an image until north is up does not, by itself, correct changes in scale, projection, or distortion.

The required scientific workflow uses Astropy WCS and reproject.reproject_interp to map one image onto the other's grid, preserving the full SIP distortion description. Inspect the returned footprint and exclude regions without valid overlap.

**Current implementation:** AURAx uses `reproject.reproject_interp` with the complete celestial WCS and SIP distortion terms to map every later frame onto the first selected frame's grid. A common quality mask excludes invalid, non-overlapping, and problem-flagged pixels across the entire sequence. The source and full-sample-history flags are informational and are retained. The blink mask also checks local wavelength compatibility between every pair at every displayed pixel. There is no rotation-only or background-fill fallback. WCS reprojection is not an independent measurement of residual astrometric error; inspect reference stars before interpreting a change.

## Describe apparent displacement

For small separations away from the poles, tangent-plane components can be approximated by:

$$
\Delta\alpha_* \simeq (\alpha_B-\alpha_A)\cos\bar{\delta},
\qquad \Delta\delta = \delta_B-\delta_A
$$

RA differences must be wrapped correctly across 0° and 360°. For robust spherical calculations, use Astropy SkyCoord separation, spherical offsets, and position angle.

Position angle is conventionally measured east of north. Report the coordinate offsets, angular separation, position angle, and observation times together.

## Distinguish a rate from proper motion

For an angular separation theta in arcseconds over a positive time baseline in years, an apparent rate is:

$$
v_{\rm apparent}[{\rm mas\,yr^{-1}}]
=\frac{1000\,\theta[{\rm arcsec}]}{\Delta t[{\rm yr}]}
$$

Two positions alone cannot separate proper motion from parallax, blending, registration error, or an incorrect match. A catalog check and additional observations may be necessary.

**Current implementation limit:** AURAx does not calculate or display centroid displacement, proper motion, or difference-image photometry. Those require calibrated extraction, a formal uncertainty budget, and independent verification. Marked pixels are labelled in Image A's reference grid, not as measured sky offsets. The previous artificial sample pair and fallback motion values have been removed.

## Report a defensible result

A measurement requires formal uncertainties on both coordinate components and the derived quantities, including centroid and reference-frame errors. State the time baseline, passbands, and catalog verification.

If these checks are incomplete, describe the result as an apparent image difference requiring follow-up. Do not turn a visually persuasive blink into a discovery claim.

## Further reading

The [IRSA calibrated-cutout tutorial](https://caltech-ipac.github.io/irsa-tutorials/spherex-cutouts/) explains target-position wavelength lookup and the current plane/artifact metadata query. The [reproject interpolation reference](https://docs.astropy.org/projects/reproject/en/stable/api/reproject.reproject_interp.html) describes registration inputs and footprints. [Astropy's separation and offset guide](https://docs.astropy.org/en/stable/coordinates/matchsep.html) covers spherical coordinate measurements.
