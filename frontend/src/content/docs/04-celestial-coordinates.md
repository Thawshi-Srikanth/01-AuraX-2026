Right ascension and declination identify a direction on the sky. Together, they let you return to a target even when a displayed image is rotated or zoomed.

## Read a sky position

![Earth sits at the centre of a celestial sphere; an equatorial arc marks right ascension and an arc toward the target marks declination.](/assets/docs/sky-coordinates-v2.png)

*Conceptual celestial sphere. Right ascension runs along the celestial equator from its conventional zero direction. Declination measures the target's angle north or south of that equator.*

**Right ascension (RA)** runs around the sky. AURAx accepts it in degrees from 0 up to, but not including, 360.

**Declination (Dec)** runs from −90° at the south celestial pole to +90° at the north celestial pole. Negative values refer to the southern celestial hemisphere.

Coordinates identify a direction, not a distance from Earth.

## Convert hours to degrees

RA is often written in hours, minutes, and seconds. One full turn is 24 hours or 360 degrees, so one hour equals 15 degrees.

$$
\alpha_{\rm deg}=15\left(h+\frac{m}{60}+\frac{s}{3600}\right)
$$

**Worked example, not a measured target:** 06h 00m 00s converts to 90°. Declination −20° 30′ 00″ converts to −20.5°. The negative sign applies to the entire declination value.

To convert decimal RA degrees back to hours, divide by 15 and split the fractional hours into minutes and seconds. Use Astropy coordinate formatting for reliable carry and rounding behavior.

## Separate frame from epoch

A **coordinate frame** defines the reference axes. An **equinox**, relevant to systems such as FK5, defines the orientation associated with the reference equator and equinox. A **position epoch** states when a moving object's coordinates apply.

ICRS does not require a J2000 equinox. A catalog position described as “J2000” still needs its frame and position-epoch conventions checked. Changing a coordinate frame does not automatically advance a moving star to a new observation date.

For fast-moving targets, use catalog motion, observation times, and an appropriate Astropy coordinate transformation.

## Use this in AURAx

Enter RA and Dec in degrees on Home. Check the sign of Dec and verify the target label separately: a label does not validate a coordinate.

On an image, screen-up is not necessarily celestial north. Use the coordinate readout and orientation control rather than inferring sky direction from the screen edges.

## Further reading

The [Astropy coordinate guide](https://docs.astropy.org/en/stable/coordinates/index.html) covers frames, units, representations, and transformations.
