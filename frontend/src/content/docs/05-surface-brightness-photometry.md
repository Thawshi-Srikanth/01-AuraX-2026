A calibrated pixel value is not automatically the total flux of a star. SPHEREx spectral images describe surface brightness: flux density per unit solid angle on the sky.

## Separate brightness from total flux

![A grayscale pixel grid contains a source aperture and a separate outer background annulus.](/assets/docs/aperture-photometry-v2.png)

*Illustrative pixel grid, not measured data. Sum the source aperture and estimate the surrounding background in the separate annulus. The gap helps keep source light out of the background estimate.*

A larger aperture includes more sky as well as more source light. Without subtracting the background, simply adding more pixels can inflate the apparent source flux.

## Understand MJy per steradian

A Jansky is a unit of spectral flux density:

$$
1\ {\rm Jy}=10^{-26}\ {\rm W\,m^{-2}\,Hz^{-1}}
$$

A megajansky is one million Janskys. A steradian measures solid angle. A value in MJy/sr must be multiplied by the appropriate pixel solid angle to contribute a flux density in Jy.

For a small, approximately square pixel with angular side length p in arcseconds:

$$
\Omega_{\rm pix}\simeq\left(\frac{p}{206265}\right)^2\ {\rm sr}
$$

This approximation is useful for understanding the units. Precision work must account for the local pixel area and distortion described by the image WCS.

## Subtract the background

If the local background surface brightness is B and the image intensity in pixel i is I_i, an aperture estimate is:

$$
F_\nu[{\rm Jy}]=10^6\sum_i w_i\,(I_i-B)\,\Omega_i
$$

Here w_i is the fractional pixel coverage of the aperture. The intensities are in MJy/sr and the solid angles are in sr. Mask flagged pixels and account for the actual usable aperture area.

An annulus estimates local background; nearby sources or structured emission can bias it. Finite apertures also miss part of a point source's light, so a calibrated aperture correction or suitable PSF model may be required.

## Carry uncertainty with the result

An uncertainty estimate must include the variance image, uncertainty in the background, masked pixels, and calibration terms. Reprojection can correlate neighboring pixels, so treating every output pixel as independent can underestimate the error.

Do not report a numerical flux from this schematic or from display colors. A scientific result needs the calibrated arrays, units, passband, aperture definition, and uncertainty.

## Use this in AURAx

Read the calibrated brightness under the cursor separately from the display stretch. Switching between linear, logarithmic, and ZScale display modes changes visibility, not the physical units.

A single pixel readout is a sample of surface brightness. This guide explains photometry; it does not imply that every photometry step is available as a control in the current interface.

## Further reading

The [Photutils aperture guide](https://docs.astropy.org/projects/photutils/en/stable/user_guide/aperture.html) explains aperture weights, background subtraction, masks, and errors.
