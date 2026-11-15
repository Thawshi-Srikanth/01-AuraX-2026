"""Bounded, atomic retrieval of complete IRSA cutouts; no synthetic fallback."""

import hashlib
import math
import os
import tempfile
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlencode, urlsplit

import requests

from app.services.cache_policy import (
    DEFAULT_IDLE_SECONDS,
    DEFAULT_QUOTA_BYTES,
    FitsCachePolicy,
)
from app.services.fits_parser import MAX_FILE_BYTES, InvalidFitsError, open_observation
from app.services.observations import PRODUCT_NAME


class FitsDownloadError(RuntimeError):
    """The archive did not deliver a complete validated file."""


class FitsContentError(FitsDownloadError):
    """Archive bytes failed scientific file/target validation."""


@contextmanager
def cutout_response(request_url):
    """Retry one transient proxy response, never a partial image stream."""
    for attempt in range(2):
        with requests.get(
            request_url, stream=True, timeout=(5, 30), allow_redirects=False
        ) as response:
            if attempt == 0 and response.status_code in (502, 503, 504):
                try:
                    delay = float(response.headers.get("Retry-After", "1"))
                    delay = min(5.0, max(0.0, delay)) if math.isfinite(delay) else 1.0
                except (TypeError, ValueError):
                    delay = 1.0
            else:
                yield response
                return
        # Close the unsuccessful response before waiting or opening another.
        time.sleep(delay)


@dataclass(frozen=True)
class RetrievedFits:
    path: Path
    request_url: str
    cached: bool
    size_bytes: int


def cutout_url(access_url: str, ra: float, dec: float, size_deg: float) -> str:
    """Accept only direct IRSA Level 2 product URLs and explicit sky positions."""
    parsed = urlsplit(access_url)
    if (
        parsed.scheme != "https"
        or parsed.netloc != "irsa.ipac.caltech.edu"
        or not parsed.path.startswith("/ibe/data/spherex/")
        or "/level2/" not in parsed.path
        or not PRODUCT_NAME.fullmatch(parsed.path.rsplit("/", 1)[-1])
        or parsed.query
        or parsed.fragment
        or "%" in parsed.path
        or "\\" in parsed.path
        or ".." in parsed.path.split("/")
    ):
        raise ValueError("Use a direct IRSA SPHEREx Level 2 product URL")
    if not (math.isfinite(ra) and 0 <= ra < 360):
        raise ValueError("Invalid right ascension")
    if not (math.isfinite(dec) and -90 <= dec <= 90):
        raise ValueError("Invalid declination")
    if not (math.isfinite(size_deg) and 0 < size_deg <= 1.5):
        raise ValueError(
            "Cutout width must be greater than zero and at most 1.5 degrees"
        )
    return (
        access_url
        + "?"
        + urlencode({"center": f"{ra!r},{dec!r}d", "size": repr(size_deg)})
    )


class FitsStore:
    """Use a dedicated runtime directory, never a source-controlled data bundle."""

    def __init__(
        self,
        directory: str | Path,
        max_bytes: int = MAX_FILE_BYTES,
        quota_bytes: int = DEFAULT_QUOTA_BYTES,
        idle_seconds: int = DEFAULT_IDLE_SECONDS,
    ):
        if (
            isinstance(max_bytes, bool)
            or not isinstance(max_bytes, int)
            or not 0 < max_bytes <= MAX_FILE_BYTES
        ):
            raise ValueError("Invalid per-file byte limit")
        if quota_bytes < max_bytes:
            raise ValueError(
                "FITS cache quota must accommodate the per-file byte limit"
            )
        self.policy = FitsCachePolicy(directory, quota_bytes, idle_seconds)
        self.directory = self.policy.directory
        self.max_bytes = max_bytes

    @contextmanager
    def lease(self, access_url: str, ra: float, dec: float, size_deg: float = 0.03):
        request_url = cutout_url(access_url, ra, dec, size_deg)
        key = hashlib.sha256(request_url.encode()).hexdigest()
        with self.policy.lease(self.directory / f"{key}.fits"):
            yield

    def cleanup(self):
        return self.policy.cleanup()

    def status(self):
        return {**self.policy.status(), "max_file_bytes": self.max_bytes}

    def pin(self, access_url: str, ra: float, dec: float, size_deg: float = 0.03):
        """Protect a validated cached cutout from idle expiry and LRU eviction."""
        request_url = cutout_url(access_url, ra, dec, size_deg)
        key = hashlib.sha256(request_url.encode()).hexdigest()
        path = self.directory / f"{key}.fits"
        if not path.is_file():
            raise FileNotFoundError("Cutout must be cached before pinning")
        self.policy.pin_persistent(path)

    def get_cached(
        self, access_url: str, ra: float, dec: float, size_deg: float = 0.03
    ):
        """Inspect validated cached data without network or directory creation."""
        request_url = cutout_url(access_url, ra, dec, size_deg)
        key = hashlib.sha256(request_url.encode()).hexdigest()
        path = self.directory / f"{key}.fits"
        try:
            with self.policy.state.lock:
                self.policy.validate_path(path)
                if path.is_file() and path.stat().st_size <= self.max_bytes:
                    with open_observation(path) as observation:
                        observation.target_pixel(ra, dec)
                        self.policy.touch(path)
                        return RetrievedFits(
                            path, request_url, True, path.stat().st_size
                        )
        except (InvalidFitsError, OSError):
            pass
        return None

    def fetch(self, access_url: str, ra: float, dec: float, size_deg: float = 0.03):
        with self.lease(access_url, ra, dec, size_deg):
            cached = self.get_cached(access_url, ra, dec, size_deg)
            if cached is not None:
                return cached
            with self.policy.state.writer:
                cached = self.get_cached(access_url, ra, dec, size_deg)
                if cached is not None:
                    return cached
                self.policy.make_room(self.max_bytes)
                return self._download(access_url, ra, dec, size_deg)

    def _download(self, access_url, ra, dec, size_deg):
        request_url = cutout_url(access_url, ra, dec, size_deg)
        key = hashlib.sha256(request_url.encode()).hexdigest()
        path = self.directory / f"{key}.fits"
        temporary = None
        try:
            with cutout_response(request_url) as response:
                if response.status_code != 200:
                    raise FitsDownloadError(
                        "IRSA did not return a complete FITS response"
                    )
                declared = response.headers.get("Content-Length")
                if declared is not None and not 0 < int(declared) <= self.max_bytes:
                    raise FitsDownloadError("Archive response exceeds the file limit")
                descriptor, name = tempfile.mkstemp(
                    prefix=f".{key}.", suffix=".part", dir=self.directory
                )
                temporary = Path(name)
                with self.policy.state.lock:
                    self.policy.state.active_parts.add(temporary)
                count = 0
                start = time.monotonic()
                with os.fdopen(descriptor, "wb") as output:
                    for chunk in response.iter_content(chunk_size=65536):
                        count += len(chunk)
                        if count > self.max_bytes:
                            raise FitsDownloadError(
                                "Archive response exceeds the file limit"
                            )
                        if time.monotonic() - start > 90:
                            raise FitsDownloadError(
                                "Archive stream exceeded the transfer budget"
                            )
                        output.write(chunk)
                if declared is not None and not response.headers.get(
                    "Content-Encoding"
                ):
                    if count != int(declared):
                        raise FitsDownloadError(
                            "Archive response ended before its declared size"
                        )
            with open_observation(temporary) as observation:
                observation.target_pixel(ra, dec)
            with self.policy.state.lock:
                self.policy.validate_path(temporary)
                self.policy.validate_path(path)
                os.replace(temporary, path)
            return RetrievedFits(path, request_url, False, count)
        except InvalidFitsError as error:
            raise FitsContentError("Archive calibration is unusable") from error
        except (requests.RequestException, OSError, ValueError) as error:
            raise FitsDownloadError(
                "Could not retrieve a complete calibrated cutout"
            ) from error
        finally:
            if temporary is not None:
                with self.policy.state.lock:
                    self.policy.state.active_parts.discard(temporary)
                    self.policy.validate_path(temporary)
                    temporary.unlink(missing_ok=True)
