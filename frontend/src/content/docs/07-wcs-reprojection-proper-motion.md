A difference between two images is a starting point for investigation. Before interpreting it as motion or variability, establish that both images measure comparable light on the same sky grid.

## Follow the comparison order

![Two rotated grids are aligned using the same reference stars before an illustrative target-position offset is inspected.](/assets/docs/epoch-comparison-v2.png)

*Schematic, not measured motion. Orange and cyan distinguish the two dates. Stationary reference stars should align before you assess a target's apparent displacement.*

1. **Match wavelengths.** Use the passband at the target position and its channel resolution.
2. **Match sky coordinates.** Register both images onto one astrometric reference grid.
3. **Check quality.** Inspect flags, background, usable overlap, PSF differences, and uncertainty.
4. **Inspect the residual.** Compare the target and nearby reference stars.

Blinking emphasizes changes; it does not establish their cause.

## Use Compare dates

AURAx first checks the wavelength **at your chosen sky position**, then suggests observations within a compatible group. It favours four dates spread over the available time span; if only two or three verified dates are available, it uses those. The images are prepared automatically and open paused. Use **Play** to blink. Play also switches from Grid to Blink for you.

Use the single **Wavelength at target** control to choose another matched group. Only compatible observations appear in its date checklist. Uncheck a date to replace it, or choose **Use suggested dates** to return to the automatic selection. Detector colours remain tied to the scientific bands. The broad archive band midpoint is not used as the local wavelength calibration.

The initial search reuses cached calibration and checks up to three bounded batches. Each batch can read one metadata page and download at most two small calibrated cutouts. Returning through Guide reuses the search state rather than restarting that download allowance. **Check more dates** explicitly continues the search. Newest and oldest archive pages are checked before filling the interior; this comparison search is not restricted to the Images page's 100 oldest results.

Read the search status carefully. A partial search or failed calibration is not proof that no matching dates exist. Only a fully searched, fully checked result can report that no compatible dates were found. If the candidate limit is reached, narrow the date range. Cached matches can remain usable during an archive interruption.

Open **Filters & display** for the date range, field size, stretch, shared contrast, and grayscale inversion. **Grid** shows the selected observations together with linked zoom and pan. **Mark** inspects the same small sky-grid area across every date. The marker is an inspection aid, not an object identification or motion measurement.

The timeline shows real UTC timestamps. Playback uses equal frame intervals even when the dates are unevenly spaced. Longer time gaps may reveal motion that is invisible in adjacent exposures.

The final preparation still checks full sky alignment, quality overlap, and wavelength compatibility at every blink pixel. Target-position matching alone does not certify an entire field. Every frame must match every other frame, including the last-to-first playback transition. An incompatible sequence remains inspectable in Grid with blink disabled. Missing or failed observations are never replaced with a sample.

## Align with the full WCS

A World Coordinate System maps detector pixels to sky coordinates. Rotating an image until north is up does not, by itself, correct changes in scale, projection, or distortion.

The required scientific workflow uses Astropy WCS and reproject.reproject_interp to map one image onto the other's grid, preserving the full SIP distortion description. Inspect the returned footprint and exclude regions without valid overlap.

**Current implementation:** AURAx uses `reproject.reproject_interp` with the complete celestial WCS and SIP distortion terms to map every later frame onto the first chronological frame's grid. A common quality mask excludes invalid, non-overlapping, and problem-flagged pixels across the entire sequence. The source and full-sample-history flags are informational and are retained. The blink mask also checks local wavelength compatibility between every pair at every displayed pixel. There is no rotation-only or background-fill fallback. WCS reprojection is not an independent measurement of residual astrometric error; inspect reference stars before interpreting a change.

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
