# Reading the science responsibly

[Documentation](README.md) · [Walkthrough](user-guide.md)

## Display versus measurement

The rendered colors and stretch help reveal structure. They do not change native calibrated values, and a brighter-looking image does not necessarily mean a source brightened. Backgrounds, passbands, flags, registration, and display choices matter.

SPHEREx detector labels D1–D6 do not uniquely identify the wavelength at a target. Passbands vary with position. Approximate WCS-WAVE visualization calibration is not a substitute for precision CWAVE/CBAND source calibration.

## General comparison and checked blink

General comparison aligns two to four observations and can mix wavelengths. It helps explore the data; its playback is not a matched-wavelength motion or variability certificate. Checked blink adds stricter time, local wavelength, quality, and registration checks. Passing those checks still does not identify an object or prove a discovery.

## Coordinates, masks, and source associations

The cyan coordinate marker indicates the requested position. SIMBAD overlays are catalog references, not verified image associations or automatically motion-corrected detections. Shared catalog coordinates do not imply independently resolved sources.

Challenge presets use a fixed approximate J2025.5 field centre from catalog proper motions, omitting parallax and perspective corrections. Individual frames are not recentered on a moving source. Manual coordinates remain user supplied.

Nonfinite or unusable pixels are disclosed, not reconstructed. Other flagged pixels may be visible for context while excluded from measurements. A masked stellar core cannot be treated as a valid source measurement just because surrounding coverage is good.

## Region analysis and spectra

Region measurements use quality-screened image data and local background checks. Formal variance errors do not include every systematic or correlated-noise effect; a signal-to-formal-error ratio is not a confirmed detection.

Saved spectral samples are bounded nearest-pixel surface-brightness measurements with variance-derived uncertainties and bandwidths. They can include background emission and different dates. They are not complete, background-subtracted, PSF-extracted source spectra.

## What has been validated

All five challenge fields returned four real registered images in the dated validation. That does not confirm each target's identity, visibility, motion, or variability.

The [Epsilon Indi B example](epsilon-indi-example-validation-2026-11-15.md) spans 508.64 days. A six-reference exploratory check yielded about 6.7 arcseconds of relative displacement versus about 6.5 arcseconds expected from catalog motion. Aperture sensitivity and unmodeled effects prevent a precision claim. The binary components are not established as resolved.

See the [five-target audit](challenge-audit-2026-11-15.md) for masked cores, partial coverage, and remaining limits. Bounded queries are not exhaustive archive searches. Successful API responses and health checks do not certify scientific conclusions.
