AURAx helps you inspect SPHEREx observations of a chosen sky position. Start with one target and one image. Learn what that image contains before moving on to spectra or comparisons.

## What you are looking at

![Earth provides orbital context; arrows trace incoming sky light through a simplified telescope to a filter and detector.](/assets/docs/mission-capture-v2.png)

*Schematic, not an observation or an engineering drawing. Earth shows where the spacecraft operates. Light comes from the sky, enters the telescope, and reaches the detector through a filter.*

SPHEREx surveys the sky in near-infrared light. AURAx retrieves available archive images and helps you explore them. The spacecraft collects light; the archive distributes calibrated files; AURAx displays and processes those files.

A sky-map background helps you navigate. It is not the selected SPHEREx exposure. To inspect SPHEREx measurements, open an observation and check its detector, date, wavelength information, and units.

## Open your first image

1. **Choose a target.** Use a named target on Home, or enter right ascension and declination in degrees. Check the resolved position.
2. **Open Images.** Look for archive records covering that position. A known object can still have no returned coverage.
3. **Choose an exposure.** Read the date and detector. Adjust the date or wavelength filters if needed.
4. **Inspect the image.** Use Fit to see its full extent, then zoom and pan. Try another display stretch to reveal faint structure.
5. **Read a pixel.** The brightness readout describes the calibrated measurement, while the display stretch controls its appearance.

If an archive request fails, retry when the service is available. An empty coverage result and a connection failure mean different things; neither establishes that the object emits no light.

## Know what each view does

- **Sky map:** find a region and orient yourself on the sky.
- **Images:** inspect individual calibrated images and their metadata.
- **Wavelengths:** explore how measurements vary with wavelength. Check coverage and uncertainties before interpreting a feature.
- **Compare dates:** automatically find wavelength-compatible dates, then blink through two to four observations or inspect them in a linked grid.
- **Saved targets:** return to saved selections through the navigation menu.

A detector name is not a complete wavelength description. SPHEREx uses filters whose passbands vary across each detector. The wavelength at the target position matters.

## Before drawing a conclusion

A brighter display does not necessarily mean a brighter astronomical source. Contrast settings, background emission, flags, and wavelength differences can all affect what you see.

Use the following guides to understand the light path, sky coordinates, brightness units, and comparison requirements. Illustrations throughout this manual are conceptual; they do not contain measured results.

## Further reading

The [SPHEREx mission overview at IPAC](https://www.ipac.caltech.edu/project/spherex) describes the scientific goals. The [IRSA archive overview](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/overview.html) explains the available archive interface and its terminology.
