"""Explicitly synthetic science/calibration fixtures; never application fallbacks."""

from unittest.mock import MagicMock, Mock
from urllib.parse import parse_qs, urlsplit

import astropy.units as u
import numpy as np
import pytest
import requests
from astropy.io import fits
from astropy.wcs import WCS, Sip

from app.services import fits_download as download
from app.services.fits_parser import InvalidFitsError, open_observation

URL = (
    "https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/"
    "synthetic/v1/1/level2_syntheticD1_spx_v1.fits"
)


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


def rewrite(path, mutate):
    with fits.open(path, memmap=False) as source:
        hdus = fits.HDUList([hdu.copy() for hdu in source])
    mutate(hdus)
    hdus.writeto(path, overwrite=True)
    hdus.close()


def mock_response(monkeypatch, payload, status=200, headers=None):
    response = MagicMock()
    response.__enter__.return_value = response
    response.status_code = status
    response.headers = headers or {}
    response.iter_content.return_value = [payload]
    get = Mock(return_value=response)
    monkeypatch.setattr(download.requests, "get", get)
    return get, response


def test_preserves_science_flags_units_and_full_sip(mef):
    with open_observation(mef) as parsed:
        assert parsed.image.shape == (16, 16)
        assert np.isnan(parsed.image[0, 0])
        assert parsed.image[1, 1] == 17
        assert parsed.flags.dtype.kind == "u"
        assert parsed.flags[1, 1] == 1 << 21
        assert parsed.variance[1, 1] == 0.25
        assert parsed.zodi[1, 1] == 2
        assert parsed.image_unit == u.MJy / u.sr
        assert parsed.variance_unit == (u.MJy / u.sr) ** 2
        assert parsed.spatial_wcs.sip.a[2, 0] == 0.00005
        assert parsed.spatial_wcs.sip.b[0, 2] == -0.00004
        assert parsed.wavelength_wcs.sip is None
        assert parsed.wavelength_at(7.5, 7.5) == pytest.approx((1.234567, 0.04))
        assert parsed.hdus["IMAGE"].header["A_ORDER"] == 2
        assert parsed.hdus[0].header["VERSION"] == "synthetic-only"
        assert parsed.hdus[parsed.psf_extension].data.shape == (3, 3)
        x, y = parsed.spatial_wcs.world_to_pixel_values(100.0, 20.0)
        assert (x, y) == pytest.approx((7.5, 7.5), abs=1e-6)


@pytest.mark.parametrize(
    "extension", ["IMAGE", "FLAGS", "VARIANCE", "ZODI", "EPSF", "WCS-WAVE"]
)
def test_missing_extensions_are_not_silently_filled(mef, extension):
    rewrite(mef, lambda hdus: hdus.pop(hdus.index_of(extension)))
    with pytest.raises(InvalidFitsError):
        with open_observation(mef):
            pass


@pytest.mark.parametrize(
    "extension,unit", [("IMAGE", "count"), ("VARIANCE", "MJy/sr"), ("ZODI", "")]
)
def test_incompatible_or_missing_units_are_rejected(mef, extension, unit):
    rewrite(mef, lambda hdus: hdus[extension].header.update(BUNIT=unit))
    with pytest.raises(InvalidFitsError):
        with open_observation(mef):
            pass


def test_plane_shape_mismatch_is_rejected(mef):
    rewrite(mef, lambda hdus: setattr(hdus["VARIANCE"], "data", np.ones((8, 8))))
    with pytest.raises(InvalidFitsError):
        with open_observation(mef):
            pass


def test_float_flags_are_rejected(mef):
    rewrite(
        mef,
        lambda hdus: setattr(hdus["FLAGS"], "data", np.zeros((16, 16), dtype=float)),
    )
    with pytest.raises(InvalidFitsError):
        with open_observation(mef):
            pass


def test_nonfinite_wavelength_calibration_is_rejected(mef):
    def mutate(hdus):
        hdus["WCS-WAVE"].data["VALUES"][..., 0] = np.nan

    rewrite(mef, mutate)
    with pytest.raises(InvalidFitsError):
        with open_observation(mef):
            pass


def test_truncated_file_is_rejected(mef):
    mef.write_bytes(mef.read_bytes()[:-2880])
    with pytest.raises(InvalidFitsError):
        with open_observation(mef):
            pass


def test_present_checksums_are_verified(mef):
    with fits.open(mef, mode="update", memmap=False) as hdus:
        for hdu in hdus:
            hdu.add_checksum()
    with open_observation(mef):
        pass
    with fits.open(mef) as hdus:
        offset = hdus["IMAGE"].fileinfo()["datLoc"]
    with mef.open("r+b") as file:
        file.seek(offset + 4)
        file.write(b"bad!")
    with pytest.raises(InvalidFitsError, match="checksum"):
        with open_observation(mef):
            pass


def test_consumer_errors_propagate_and_file_closes(mef):
    with pytest.raises(RuntimeError, match="consumer"):
        with open_observation(mef) as parsed:
            raise RuntimeError("consumer")
    assert parsed.hdus._file.closed


def test_download_cache_reuse_and_precise_request_keys(mef, tmp_path, monkeypatch):
    get, _ = mock_response(monkeypatch, mef.read_bytes())
    store = download.FitsStore(tmp_path / "cache")
    first = store.fetch(URL, 100.000001, 20.0)
    assert first.cached is False
    assert first.path.read_bytes() == mef.read_bytes()
    assert first.size_bytes == mef.stat().st_size
    assert store.fetch(URL, 100.000001, 20.0).cached is True
    assert get.call_count == 1
    second = store.fetch(URL, 100.000002, 20.0)
    third = store.fetch(URL, 100.000001, 20.0, 0.04)
    assert len({first.path, second.path, third.path}) == 3
    assert get.call_args.kwargs == {
        "stream": True,
        "timeout": (5, 30),
        "allow_redirects": False,
    }
    query = parse_qs(urlsplit(first.request_url).query)
    assert query["center"] == ["100.000001,20.0d"]
    assert query["size"] == ["0.03"]
    assert not list(store.directory.glob("*.part"))


@pytest.mark.parametrize("status", [206, 302, 404, 503])
def test_partial_redirect_and_error_responses_are_not_cached(
    mef, tmp_path, monkeypatch, status
):
    mock_response(monkeypatch, mef.read_bytes(), status=status)
    store = download.FitsStore(tmp_path / "cache")
    with pytest.raises(download.FitsDownloadError):
        store.fetch(URL, 100.0, 20.0)
    assert not list(store.directory.glob("*.fits"))
    assert not list(store.directory.glob("*.part"))


@pytest.mark.parametrize(
    "headers,payload",
    [
        ({"Content-Length": "999999999"}, b""),
        ({"Content-Length": "100"}, b"short"),
        ({}, b"<html>Archive error</html>"),
        ({}, b"x" * 60000),
    ],
)
def test_invalid_or_oversized_downloads_are_not_cached(
    tmp_path, monkeypatch, headers, payload
):
    mock_response(monkeypatch, payload, headers=headers)
    store = download.FitsStore(tmp_path / "cache", max_bytes=50000)
    with pytest.raises(download.FitsDownloadError):
        store.fetch(URL, 100.0, 20.0)
    assert not list(store.directory.glob("*.fits"))
    assert not list(store.directory.glob("*.part"))


def test_interrupted_download_is_cleaned_up(mef, tmp_path, monkeypatch):
    _, response = mock_response(monkeypatch, mef.read_bytes())

    def chunks(**kwargs):
        yield b"SIMPLE  ="
        raise requests.ConnectionError("interrupted fixture stream")

    response.iter_content.side_effect = chunks
    store = download.FitsStore(tmp_path / "cache")
    with pytest.raises(download.FitsDownloadError):
        store.fetch(URL, 100.0, 20.0)
    assert not list(store.directory.iterdir())


def test_invalid_cache_is_rebuilt_atomically(mef, tmp_path, monkeypatch):
    get, _ = mock_response(monkeypatch, mef.read_bytes())
    store = download.FitsStore(tmp_path / "cache")
    first = store.fetch(URL, 100.0, 20.0)
    first.path.write_bytes(b"corrupt runtime cache")
    repaired = store.fetch(URL, 100.0, 20.0)
    assert repaired.cached is False
    assert repaired.path.read_bytes() == mef.read_bytes()
    assert get.call_count == 2


@pytest.mark.parametrize(
    "url",
    [
        "https://untrusted.example/file.fits",
        URL.replace("https:", "http:"),
        URL + "?other=1",
        URL.replace("irsa.ipac.caltech.edu", "irsa.ipac.caltech.edu.evil.example"),
        URL.replace("/synthetic/", "/%2e%2e/"),
    ],
)
def test_untrusted_locations_are_rejected_before_io(tmp_path, monkeypatch, url):
    get = Mock()
    monkeypatch.setattr(download.requests, "get", get)
    store = download.FitsStore(tmp_path / "cache")
    with pytest.raises(ValueError):
        store.fetch(url, 100.0, 20.0)
    get.assert_not_called()
    assert not store.directory.exists()


@pytest.mark.parametrize(
    "ra,dec,size",
    [
        (-1, 0, 0.03),
        (360, 0, 0.03),
        (1, 91, 0.03),
        (float("nan"), 0, 0.03),
        (1, 0, 0),
        (1, 0, 2),
    ],
)
def test_invalid_cutout_requests_are_rejected(ra, dec, size):
    with pytest.raises(ValueError):
        download.cutout_url(URL, ra, dec, size)


def test_returned_image_must_cover_requested_target(mef, tmp_path, monkeypatch):
    mock_response(monkeypatch, mef.read_bytes())
    store = download.FitsStore(tmp_path / "cache")
    with pytest.raises(download.FitsDownloadError):
        store.fetch(URL, 200.0, -20.0)
    assert not list(store.directory.iterdir())


def test_target_location_uses_spatial_sip_then_spectral_lookup(mef):
    with open_observation(mef) as parsed:
        x, y = parsed.target_pixel(100.0, 20.0)
        assert (x, y) == pytest.approx((7.5, 7.5), abs=1e-6)
        assert parsed.wavelength_at(x, y) == pytest.approx((1.234567, 0.04))
        with pytest.raises(InvalidFitsError):
            parsed.target_pixel(200.0, -20.0)
