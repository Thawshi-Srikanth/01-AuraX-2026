"""Validate complete Level 2 MEFs while retaining every calibration extension."""

import math
import re
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass
from pathlib import Path

import astropy.units as u
import numpy as np
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.wcs import WCS, NoConvergence

MAX_FILE_BYTES = 128 * 1024 * 1024
MAX_IMAGE_AXIS = 2048
REQUIRED_EXTENSIONS = ("IMAGE", "FLAGS", "VARIANCE", "ZODI", "WCS-WAVE")
SIP_KEY = re.compile(r"^(A|B|AP|BP)_(ORDER|DMAX|[0-9]+_[0-9]+)$")


class InvalidFitsError(ValueError):
    """A file lacks a complete, usable set of Level 2 data and calibration."""


@dataclass
class ParsedFits:
    """Arrays and WCS objects are valid inside the open_observation context."""

    hdus: fits.HDUList
    image: np.ndarray
    flags: np.ndarray
    variance: np.ndarray
    zodi: np.ndarray
    image_unit: u.UnitBase
    variance_unit: u.UnitBase
    zodi_unit: u.UnitBase
    spatial_wcs: WCS
    wavelength_wcs: WCS
    psf_extension: str

    def target_pixel(self, ra: float, dec: float) -> tuple[float, float]:
        """Locate an ICRS target using the complete celestial distortion solution."""
        if not (math.isfinite(ra) and 0 <= ra < 360):
            raise InvalidFitsError("Invalid right ascension")
        if not (math.isfinite(dec) and -90 <= dec <= 90):
            raise InvalidFitsError("Invalid declination")
        try:
            x, y = self.spatial_wcs.world_to_pixel(
                SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame="icrs")
            )
            x, y = float(x), float(y)
            self.wavelength_at(x, y)
            return x, y
        except NoConvergence as error:
            raise InvalidFitsError("Target position did not converge") from error

    def wavelength_at(self, x: float, y: float) -> tuple[float, float]:
        """Return central wavelength and channel width in um at a detector pixel."""
        height, width = self.image.shape
        if not (math.isfinite(x) and math.isfinite(y)):
            raise InvalidFitsError("Nonfinite target pixel")
        if not (-0.5 <= x < width - 0.5 and -0.5 <= y < height - 0.5):
            raise InvalidFitsError("Target is outside the image")
        wave, band = self.wavelength_wcs.pixel_to_world(x, y)
        wave, band = float(wave.to_value(u.um)), float(band.to_value(u.um))
        if not (math.isfinite(wave) and math.isfinite(band) and wave > 0 and band > 0):
            raise InvalidFitsError("No valid wavelength calibration at the target")
        return wave, band


def _parse(hdus, file_size):
    hdus.verify("exception")
    names = [hdu.name for hdu in hdus]
    for name in REQUIRED_EXTENSIONS:
        if names.count(name) != 1:
            raise InvalidFitsError(f"Expected exactly one {name} extension")
    psf_names = [name for name in ("EPSF", "PSF") if name in names]
    if len(psf_names) != 1 or names.count(psf_names[0]) != 1:
        raise InvalidFitsError("Expected one EPSF or PSF calibration extension")
    for hdu in hdus:
        info = hdu.fileinfo()
        if info and info["datLoc"] + info["datSpan"] > file_size:
            raise InvalidFitsError("Truncated extension data")
        if "CHECKSUM" in hdu.header and hdu.verify_checksum() != 1:
            raise InvalidFitsError("FITS checksum mismatch")
        if "DATASUM" in hdu.header and hdu.verify_datasum() != 1:
            raise InvalidFitsError("FITS data checksum mismatch")
    header = hdus["IMAGE"].header
    width, height = header.get("NAXIS1", 0), header.get("NAXIS2", 0)
    if header.get("NAXIS") != 2 or not (
        0 < width <= MAX_IMAGE_AXIS and 0 < height <= MAX_IMAGE_AXIS
    ):
        raise InvalidFitsError("Unsupported science image dimensions")
    arrays = {}
    for name in ("IMAGE", "FLAGS", "VARIANCE", "ZODI"):
        plane = hdus[name]
        if (plane.header.get("NAXIS1"), plane.header.get("NAXIS2")) != (width, height):
            raise InvalidFitsError("Science plane shapes disagree")
        data = plane.data
        if (
            data is None
            or data.shape != (height, width)
            or data.dtype.kind not in "fiu"
        ):
            raise InvalidFitsError("Invalid science array")
        arrays[name] = data
    if arrays["FLAGS"].dtype.kind not in "iu":
        raise InvalidFitsError("Quality flags must retain an integer bitmask")
    units = {}
    for name, expected in (
        ("IMAGE", u.MJy / u.sr),
        ("VARIANCE", (u.MJy / u.sr) ** 2),
        ("ZODI", u.MJy / u.sr),
    ):
        unit = u.Unit(hdus[name].header.get("BUNIT", ""))
        if not unit.is_equivalent(expected):
            raise InvalidFitsError(f"Missing or incompatible {name} unit")
        units[name] = unit
    for name in (psf_names[0], "WCS-WAVE"):
        if hdus[name].data is None or hdus[name].data.size == 0:
            raise InvalidFitsError(f"Empty {name} calibration")
    spatial = WCS(header, fobj=hdus)
    if not spatial.has_celestial or spatial.pixel_n_dim != 2:
        raise InvalidFitsError("Missing celestial WCS")
    if "-SIP" in str(header.get("CTYPE1", "")) and spatial.sip is None:
        raise InvalidFitsError("Missing SIP distortion calibration")
    if (header.get("CTYPE1W"), header.get("CTYPE2W")) != ("WAVE-TAB", "WAVE-TAB"):
        raise InvalidFitsError("Missing tabulated wavelength WCS")
    # SIP belongs to the celestial solution, not the alternate spectral solution.
    spectral_header = header.copy()
    for key in list(spectral_header):
        if SIP_KEY.fullmatch(key):
            del spectral_header[key]
    spectral = WCS(spectral_header, fobj=hdus, key="W")
    if spectral.pixel_n_dim != 2 or not spectral.wcs.tab:
        raise InvalidFitsError("Unusable wavelength lookup table")
    return ParsedFits(
        hdus=hdus,
        image=arrays["IMAGE"],
        flags=arrays["FLAGS"],
        variance=arrays["VARIANCE"],
        zodi=arrays["ZODI"],
        image_unit=units["IMAGE"],
        variance_unit=units["VARIANCE"],
        zodi_unit=units["ZODI"],
        spatial_wcs=spatial,
        wavelength_wcs=spectral,
        psf_extension=psf_names[0],
    )


@contextmanager
def open_observation(path: str | Path):
    """Open a bounded complete MEF, closing the file even when consumers fail."""
    path = Path(path)
    size = path.stat().st_size
    if not 0 < size <= MAX_FILE_BYTES or size % 2880:
        raise InvalidFitsError("Invalid FITS file size or incomplete block")
    with path.open("rb") as stream:
        if not stream.read(80).startswith(b"SIMPLE  ="):
            raise InvalidFitsError("Response is not a FITS primary HDU")
    with ExitStack() as stack:
        try:
            hdus = stack.enter_context(
                fits.open(path, memmap=False, lazy_load_hdus=False)
            )
            observation = _parse(hdus, size)
            # Validate the lookup solution before admitting this file to cache.
            height, width = observation.image.shape
            observation.wavelength_at((width - 1) / 2, (height - 1) / 2)
        except (
            OSError,
            ValueError,
            TypeError,
            KeyError,
            IndexError,
            fits.VerifyError,
        ) as error:
            if isinstance(error, InvalidFitsError):
                raise
            raise InvalidFitsError("Unusable Level 2 data or calibration") from error
        yield observation
