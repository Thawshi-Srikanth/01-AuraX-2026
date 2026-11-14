In a conventional image, a filter often applies the same passband across the detector. SPHEREx uses linear variable filters: the transmitted wavelength changes along the detector.

## Follow light through the filter

![Incoming light passes through different positions of a linear variable filter onto a detector, from shorter to longer wavelength.](/assets/docs/lvf-wavelengths-v2.png)

*Schematic. Different positions select different passbands. Any colored strip is a wavelength key, not a visible rainbow, a measured spectrum, or light dispersed by a prism.*

The filter does not bend incoming light into a rainbow. Each position transmits a narrow range. Repeated sky coverage places a target at different detector positions, building measurements at different wavelengths.

## Read wavelength at the target

Select a target or click a position in an image to open the Wavelengths sheet on
the right. The Images toolbar can reopen it. The sheet lists measured wavelengths,
brightness and uncertainties; it does not fill missing wavelengths.

An exposure contains both spatial and spectral information. Each useful sample has a sky position and a wavelength response. A detector label or an exposure-wide wavelength midpoint is not a substitute for the calibrated wavelength at the target pixel.

Before comparing measurements, check the target position, wavelength calibration, quality flags, and passband width. Missing coverage should remain missing; drawing a continuous line does not create measurements between samples.

## Understand spectral resolution

Resolving power relates wavelength to the width of a spectral resolution element:

$$
R=\frac{\lambda}{\Delta\lambda}
$$

At fixed R, a larger wavelength corresponds to a wider resolution element.

**Worked example, not an instrument calibration:** if R = 100 at 4 micrometres, the corresponding width is approximately 0.04 micrometres. Real analysis must use the appropriate calibrated instrumental response.

A densely sampled curve does not necessarily resolve equally narrow physical features. Sampling and spectral resolution describe different properties.

## Match wavelengths before comparing dates

Two images can differ because they measure different parts of a source's spectrum. That difference must not be mistaken for variability.

For blinking or subtraction, require central wavelengths to agree within the applicable channel resolution. The same detector alone is insufficient. Check the local passbands and their calibration before interpreting residuals.

For visual blinking, AURAx reads the local wavelength and bandwidth from each observation's `WCS-WAVE` lookup using Astropy's alternative spectral WCS. The target must match, and each blink pixel must satisfy a wavelength check within the narrower local bandwidth, with a 0.002 µm safety margin for the pair. A detector-wide midpoint is not used for this decision.

**Precision limit:** IRSA describes `WCS-WAVE` as a visualization approximation, accurate to about 1 nm. It is not a precision photometric calibration. Quantitative science should use the `CWAVE` and `CBAND` calibration products and appropriate uncertainties, as explained in the [IRSA data-product guide](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products/). AURAx's blink view is for visual candidate inspection; it does not provide spectral or difference-flux measurements.

## Interpret spectral features carefully

A peak or dip may reflect real emission or absorption, background subtraction, calibration, or a flagged pixel. Identify a molecule only after assessing signal-to-noise, wavelength accuracy, the expected feature shape, and independent evidence.

## Further reading

The [SPHEREx spectral-response paper](https://arxiv.org/abs/2602.09139) discusses position-dependent passbands. The [IRSA data-product guide](https://github.com/Caltech-IPAC/spherex-archive-documentation/blob/main/documentation/spherex_data_products.md) describes wavelength information in the archived products.
