# Behind AURAx

[Documentation](README.md) · [Live application](https://aurax.thawshi.com)

## The question

The NASA Space Apps challenge asks for a public web tool that turns coordinates into a sequence of SPHEREx sky images so people can inspect change over time. AURAx focuses on that path: choose a field, find observations, compare them, and understand what the comparison can support.

## What shaped the implementation

### Real data even when services fail

IRSA TAP proxy failures interrupted testing. The response was an official SIA metadata fallback, bounded retries, reusable caches, and clearer errors. Both routes still depend on IRSA. We did not create substitute observations to hide service failures.

### Start small

Downloading all products is expensive and can overwhelm a session. The app separates metadata browsing from selected image preparation, defaults to nominal 50-pixel cutouts, and retrieves selected cutouts sequentially. Larger fields remain available for context.

### A comparison is not always a time comparison

Users also need to compare wavelengths and detectors. We separated general two-to-four-image comparisons from stricter wavelength-matched time blink, preserving warnings instead of presenting every difference as motion.

### Put the controls next to the work

Tabbed sidebars organize selection, filters, playback, quality, and provenance. The analysis action stays accessible near the selection. The comparison workspace fits the available height, with independently scrolling side panels.

### Validate a useful example and state its limits

The five challenge fields were checked with real observations. The Epsilon Indi B example provides a known-motion illustration with closely matching local passbands and an exploratory reference check. Masked cores and other target limitations remain documented rather than being called successful detections.

## Decisions about scope

ePSF and HiPS-cube additions were deliberately left out to focus on the challenge's core image-and-time workflow. Existing saved spectral samples were retained with their limitations. Precision astrometry, certified discoveries, and complete source spectra are not claimed.

## Assistance and evidence

OpenAI Codex and Google Gemini assisted with coding. See [AI disclosure](ai-disclosure.md). The [challenge audit](challenge-audit-2026-11-15.md) and [checked example](epsilon-indi-example-validation-2026-11-15.md) preserve evidence beyond this narrative.

This account describes documented product decisions; it does not invent team biographies, user studies, or discovery claims.
