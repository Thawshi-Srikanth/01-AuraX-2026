"""Keep every API test isolated from the developer's runtime cache."""

import numpy as np
import pytest
from astropy.io import fits
from astropy.wcs import WCS, Sip


@pytest.fixture(autouse=True)
def isolated_cache(monkeypatch, tmp_path):
    monkeypatch.setenv("CACHE_DB_PATH", str(tmp_path / "cache" / "test.db"))
    monkeypatch.setenv("FITS_CACHE_DIR", str(tmp_path / "cache" / "fits"))


@pytest.fixture
def mef(tmp_path):
    path = tmp_path / "synthetic.fits"
    wcs = WCS(naxis=2)
    wcs.wcs.crpix = [8.5, 8.5]
    wcs.wcs.crval = [100, 20]
    wcs.wcs.cdelt = [-0.001, 0.001]
    wcs.wcs.ctype = ["RA---TAN-SIP", "DEC--TAN-SIP"]
    a, b = np.zeros((3, 3)), np.zeros((3, 3))
    a[2, 0], b[0, 2] = 0.00005, -0.00004
    wcs.sip = Sip(a, b, None, None, wcs.wcs.crpix)
    header = wcs.to_header(relax=True)
    header["BUNIT"] = "MJy / sr"
    header["HISTORY"] = "Explicitly synthetic test fixture, not a mission observation"
    for key, value in {
        "WCSAXESW": 2,
        "CRPIX1W": 1,
        "CRPIX2W": 1,
        "CDELT1W": 1,
        "CDELT2W": 1,
        "CRVAL1W": 1,
        "CRVAL2W": 1,
        "CTYPE1W": "WAVE-TAB",
        "CTYPE2W": "WAVE-TAB",
        "CUNIT1W": "um",
        "CUNIT2W": "um",
        "PS1_0W": "WCS-WAVE",
        "PS2_0W": "WCS-WAVE",
        "PS1_1W": "VALUES",
        "PS2_1W": "VALUES",
        "PS1_2W": "X",
        "PS2_2W": "Y",
        "PV1_3W": 1,
        "PV2_3W": 2,
    }.items():
        header[key] = value
    values = np.empty((2, 2, 2), dtype=np.float64)
    values[..., 0], values[..., 1] = 1.234567, 0.04
    calibration = fits.BinTableHDU.from_columns(
        [
            fits.Column(name="X", format="2D", array=[[1.0, 16.0]]),
            fits.Column(name="Y", format="2D", array=[[1.0, 16.0]]),
            fits.Column(name="VALUES", format="8D", dim="(2,2,2)", array=[values]),
        ],
        name="WCS-WAVE",
    )
    image = np.arange(256, dtype=np.float32).reshape(16, 16)
    image[0, 0] = np.nan
    flags = np.zeros((16, 16), dtype=np.uint32)
    flags[0, 0], flags[1, 1] = 1, 1 << 21
    variance_header = fits.Header({"BUNIT": "MJy2 / sr2"})
    zodi_header = fits.Header({"BUNIT": "MJy / sr"})
    primary = fits.PrimaryHDU()
    primary.header["VERSION"] = "synthetic-only"
    fits.HDUList(
        [
            primary,
            fits.ImageHDU(image, header=header, name="IMAGE"),
            fits.ImageHDU(flags, name="FLAGS"),
            fits.ImageHDU(
                np.full((16, 16), 0.25), header=variance_header, name="VARIANCE"
            ),
            fits.ImageHDU(np.full((16, 16), 2.0), header=zodi_header, name="ZODI"),
            fits.ImageHDU(np.ones((3, 3)), name="EPSF"),
            calibration,
        ]
    ).writeto(path)
    return path
