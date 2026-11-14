An astronomical image begins with light, not with a display color. The telescope collects incoming radiation, the filter selects a narrow wavelength range, and the detector records a signal that must be calibrated.

## Follow the light

![A conceptual reflective telescope routes incoming light between mirrors and onward through a filter to a detector.](/assets/docs/optics-path-v2.png)

*Schematic of a generic reflective light path, not the exact SPHEREx optical prescription. Follow the arrowheads from incoming light to the detector. The drawing explains the roles of the components.*

**The telescope collects light.** Mirrors redirect light toward the focal plane. The optics determine how a point source spreads across nearby pixels.

**The filter selects wavelengths.** A linear variable filter sits near the detector. Its transmitted wavelength changes with position, so separate parts of one image can measure different wavelength ranges.

**The detector records a signal.** A detector pixel responds to incoming radiation. Its raw signal is not yet a calibrated brightness measurement.

## Why cooling matters

Warm instrument components emit infrared radiation themselves. Cooling reduces this contribution, allowing faint astronomical light to be measured more effectively. Cooling does not remove all background emission, detector noise, or calibration uncertainty.

This is why an infrared image needs supporting information such as variance estimates and quality flags. A visually smooth image can still contain uncertain measurements.

## What a calibrated image contains

A FITS file can hold multiple related arrays. Read them together:

- **Science image:** the calibrated surface brightness.
- **Variance:** the estimated variance of those brightness values.
- **Flags:** indicators of known pixel-quality issues.
- **Coordinate and wavelength information:** the mapping needed to locate a sample on the sky and identify its passband.

The exact extensions and calibration details depend on the data product. Consult the file headers and release documentation rather than assuming every FITS file has an identical structure.

## Use this in AURAx

When you select a different detector or exposure, check the wavelength information again. Seeing the same target in two images does not guarantee you are measuring the same part of its spectrum.

A display colormap assigns visible colors to brightness values. Those colors are a visualization choice; they are not the infrared colors that a human eye would see.

## Further reading

The [SPHEREx instrument paper](https://arxiv.org/abs/2404.11017) describes the actual telescope and instrument. The [IRSA spectral-image tutorial](https://caltech-ipac.github.io/irsa-tutorials/spherex-intro/) shows how to inspect the science, variance, flag, and coordinate information.
