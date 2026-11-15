"""Quota and cleanup for a dedicated, nonrecursive, owned FITS runtime directory."""

import os
import re
import stat
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

DATA_NAME = re.compile(r"[0-9a-f]{64}\.fits")
PART_NAME = re.compile(r"\.[0-9a-f]{64}\.[A-Za-z0-9_-]+\.part")
OWNER_NAME = ".aurax-fits-cache"
OWNER_CONTENT = "AURAx FITS cache v1\n"
PINNED_NAME = ".aurax-fits-pinned"
DEFAULT_QUOTA_BYTES = 512 * 1024 * 1024
DEFAULT_IDLE_SECONDS = 7 * 86400
STALE_PART_SECONDS = 3600


class CachePolicyError(OSError):
    """Unsafe cache configuration or insufficient unprotected payload capacity."""


@dataclass
class CacheState:
    lock: object = field(default_factory=threading.RLock)
    writer: object = field(default_factory=threading.RLock)
    pins: dict = field(default_factory=dict)
    active_parts: set = field(default_factory=set)
    limits: tuple | None = None


_REGISTRY = {}
_REGISTRY_LOCK = threading.Lock()


class FitsCachePolicy:
    def __init__(
        self,
        directory,
        quota_bytes=DEFAULT_QUOTA_BYTES,
        idle_seconds=DEFAULT_IDLE_SECONDS,
    ):
        if (
            isinstance(quota_bytes, bool)
            or not isinstance(quota_bytes, int)
            or quota_bytes <= 0
        ):
            raise ValueError("FITS cache quota must be a positive integer")
        if (
            isinstance(idle_seconds, bool)
            or not isinstance(idle_seconds, int)
            or idle_seconds < 0
        ):
            raise ValueError("FITS cache idle expiry must be a nonnegative integer")
        self.directory = Path(os.path.abspath(Path(directory).expanduser()))
        if self.directory.resolve() != self.directory:
            raise ValueError("FITS cache directory must not traverse symlinks")
        if self.directory.exists() and not self.directory.is_dir():
            raise ValueError("FITS cache path must be a directory")
        self.quota_bytes, self.idle_seconds = quota_bytes, idle_seconds
        with _REGISTRY_LOCK:
            self.state = _REGISTRY.setdefault(str(self.directory), CacheState())
            limits = (quota_bytes, idle_seconds)
            if self.state.limits is not None and self.state.limits != limits:
                raise ValueError("Shared FITS cache instances must use the same limits")
            self.state.limits = limits

    def _root_safe(self):
        if self.directory.resolve() != self.directory:
            raise CachePolicyError("FITS cache path changed or traverses a symlink")
        if self.directory.exists() and not self.directory.is_dir():
            raise CachePolicyError("FITS cache root is no longer a directory")

    @staticmethod
    def _regular(path):
        try:
            info = path.lstat()
            return info if stat.S_ISREG(info.st_mode) and info.st_nlink == 1 else None
        except FileNotFoundError:
            return None

    def _entries(self):
        self._root_safe()
        result, foreign = [], 0
        if not self.directory.exists():
            return result, foreign
        for path in self.directory.iterdir():
            if path.name == OWNER_NAME or (
                path.name == PINNED_NAME and self._regular(path) is not None
            ):
                continue
            kind = (
                "fits"
                if DATA_NAME.fullmatch(path.name)
                else "part"
                if PART_NAME.fullmatch(path.name)
                else None
            )
            info = self._regular(path) if kind else None
            if info is None:
                foreign += 1
            else:
                result.append((path, kind, info))
        return result, foreign

    def _ensure_owned(self, create=False):
        self._root_safe()
        if not self.directory.exists():
            if not create:
                return False
            self.directory.mkdir(parents=True, exist_ok=True)
            self._root_safe()
        marker = self.directory / OWNER_NAME
        if marker.exists() or marker.is_symlink():
            if self._regular(marker) is None or marker.read_text() != OWNER_CONTENT:
                raise CachePolicyError("FITS cache ownership marker is invalid")
            return True
        entries, foreign = self._entries()
        if foreign:
            raise CachePolicyError(
                "Refusing to adopt a cache directory with unrelated entries"
            )
        # Adopt only this application's exact hash/temp naming convention.
        try:
            with marker.open("x") as stream:
                stream.write(OWNER_CONTENT)
        except FileExistsError:
            if self._regular(marker) is None or marker.read_text() != OWNER_CONTENT:
                raise CachePolicyError("FITS cache ownership marker changed") from None
        return True

    def validate_path(self, path):
        self._root_safe()
        if self.directory.exists():
            marker = self.directory / OWNER_NAME
            if marker.exists() or marker.is_symlink():
                if self._regular(marker) is None or marker.read_text() != OWNER_CONTENT:
                    raise CachePolicyError("FITS cache ownership marker is invalid")
            else:
                _, foreign = self._entries()
                if foreign:
                    raise CachePolicyError(
                        "Cache reads cannot use a mixed source directory"
                    )
        path = Path(path)
        if path.parent != self.directory or not (
            DATA_NAME.fullmatch(path.name) or PART_NAME.fullmatch(path.name)
        ):
            raise CachePolicyError(
                "Cache payload path is outside its managed directory"
            )
        if path.exists() or path.is_symlink():
            if self._regular(path) is None:
                raise CachePolicyError("Cache payload is linked or not a regular file")

    @contextmanager
    def lease(self, path):
        self.validate_path(path)
        with self.state.lock:
            self.state.pins[path] = self.state.pins.get(path, 0) + 1
        try:
            yield
        finally:
            with self.state.lock:
                count = self.state.pins[path] - 1
                if count:
                    self.state.pins[path] = count
                else:
                    self.state.pins.pop(path, None)

    def touch(self, path):
        with self.state.lock:
            self.validate_path(path)
            info = self._regular(path)
            if info is not None:
                os.utime(
                    path, ns=(info.st_atime_ns, time.time_ns()), follow_symlinks=False
                )

    def _unlink(self, path, previous):
        self.validate_path(path)
        current = self._regular(path)
        if current is None or (
            current.st_dev,
            current.st_ino,
            current.st_size,
            current.st_mtime_ns,
        ) != (previous.st_dev, previous.st_ino, previous.st_size, previous.st_mtime_ns):
            return False
        path.unlink()
        return True

    def _pinned_names(self):
        marker = self.directory / PINNED_NAME
        if self._regular(marker) is None:
            return set()
        try:
            return {
                line.strip()
                for line in marker.read_text(encoding="utf-8").splitlines()
                if DATA_NAME.fullmatch(line.strip())
            }
        except OSError:
            return set()

    def pin_persistent(self, path):
        path = Path(path)
        with self.state.writer, self.state.lock:
            self._ensure_owned(create=True)
            self.validate_path(path)
            if not DATA_NAME.fullmatch(path.name):
                raise CachePolicyError("Only validated FITS files can be pinned")
            pinned = self._pinned_names()
            if path.name in pinned:
                return
            pinned.add(path.name)
            marker = self.directory / PINNED_NAME
            marker.write_text("\n".join(sorted(pinned)) + "\n", encoding="utf-8")

    def cleanup(self, required_bytes=0):
        if required_bytes < 0 or required_bytes > self.quota_bytes:
            raise CachePolicyError("Requested cache reservation exceeds its quota")
        # Serialize mutation/downloads; cached readers use only the short state lock.
        with self.state.writer, self.state.lock:
            if not self._ensure_owned():
                return {
                    "removed_files": 0,
                    "removed_bytes": 0,
                    "managed_bytes": 0,
                    "capacity_available": True,
                }
            entries, _ = self._entries()
            pinned = self._pinned_names()
            total = sum(info.st_size for _, _, info in entries)
            removed_files = removed_bytes = 0
            now = time.time()
            remaining = []
            for path, kind, info in entries:
                protected = (
                    self.state.pins.get(path)
                    or path in self.state.active_parts
                    or (kind == "fits" and path.name in pinned)
                )
                age = max(0, now - info.st_mtime)
                expired = (kind == "part" and age >= STALE_PART_SECONDS) or (
                    kind == "fits"
                    and self.idle_seconds > 0
                    and age >= self.idle_seconds
                )
                if not protected and expired and self._unlink(path, info):
                    removed_files += 1
                    removed_bytes += info.st_size
                    total -= info.st_size
                else:
                    remaining.append((path, kind, info))
            evictable = [
                (path, info)
                for path, kind, info in remaining
                if kind == "fits"
                and not self.state.pins.get(path)
                and path not in self.state.active_parts
                and path.name not in pinned
            ]
            # Keep useful entries when protected bytes prevent admission.
            can_recover = (
                total + required_bytes - sum(info.st_size for _, info in evictable)
                <= self.quota_bytes
            )
            if can_recover:
                for path, info in sorted(
                    evictable, key=lambda entry: (entry[1].st_mtime, entry[0].name)
                ):
                    if total + required_bytes <= self.quota_bytes:
                        break
                    if self._unlink(path, info):
                        removed_files += 1
                        removed_bytes += info.st_size
                        total -= info.st_size
            return {
                "removed_files": removed_files,
                "removed_bytes": removed_bytes,
                "managed_bytes": total,
                "capacity_available": total + required_bytes <= self.quota_bytes,
            }

    def make_room(self, required_bytes):
        with self.state.writer:
            with self.state.lock:
                self._ensure_owned(create=True)
            result = self.cleanup(required_bytes)
            if not result["capacity_available"]:
                raise CachePolicyError(
                    "Cache is full; active files or fresh partials prevent eviction"
                )
            return result

    def status(self):
        with self.state.lock:
            entries, foreign = self._entries()
            marker = self.directory / OWNER_NAME
            owned = (
                self._regular(marker) is not None
                and marker.read_text() == OWNER_CONTENT
            )
            total = sum(info.st_size for _, _, info in entries)
            return {
                "quota_bytes": self.quota_bytes,
                "max_idle_seconds": self.idle_seconds,
                "managed_bytes": total,
                "fits_files": sum(kind == "fits" for _, kind, _ in entries),
                "partial_files": sum(kind == "part" for _, kind, _ in entries),
                "protected_files": sum(
                    self.state.pins.get(path, 0) > 0 for path, _, _ in entries
                ),
                "active_downloads": len(self.state.active_parts),
                "unmanaged_entries": foreign,
                "over_quota": total > self.quota_bytes,
                "owned_directory": owned,
            }
