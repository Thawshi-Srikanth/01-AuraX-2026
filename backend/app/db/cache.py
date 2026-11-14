"""Small SQLite JSON cache; database contents are never bundled with the app."""

import json
import logging
import math
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class CacheManager:
    """Store metadata by namespace and key, with optional expiry in seconds.

    Each operation owns its connection, so instances can be used across threads.
    Runtime database failures behave as cache misses or unsuccessful writes.
    Initialization failures propagate so misconfigured storage is visible.
    """

    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute(
                """CREATE TABLE IF NOT EXISTS cache_store (
                    namespace TEXT NOT NULL,
                    key TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    expires_at REAL,
                    PRIMARY KEY (namespace, key)
                )"""
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS cache_expiry ON cache_store(expires_at)"
            )

    @contextmanager
    def _connection(self):
        connection = sqlite3.connect(self.db_path, timeout=5.0)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def get(self, key: str, namespace: str = "default") -> Any | None:
        """Return valid JSON data, or None for a missing/unusable entry."""
        try:
            with self._connection() as connection:
                row = connection.execute(
                    """SELECT payload FROM cache_store
                       WHERE namespace = ? AND key = ?
                       AND (expires_at IS NULL OR expires_at > ?)""",
                    (namespace, key, time.time()),
                ).fetchone()
            return json.loads(row[0]) if row else None
        except (sqlite3.Error, ValueError):
            logger.warning("Cache read unavailable")
            return None

    def set(
        self,
        key: str,
        value: Any,
        namespace: str = "default",
        ttl_seconds: float | None = None,
    ) -> bool:
        """Store JSON data; invalid payloads/TTLs leave the previous entry intact."""
        try:
            if ttl_seconds is not None and (
                not math.isfinite(ttl_seconds) or ttl_seconds <= 0
            ):
                return False
            payload = json.dumps(value, allow_nan=False)
            expires_at = None if ttl_seconds is None else time.time() + ttl_seconds
            with self._connection() as connection:
                connection.execute(
                    """INSERT INTO cache_store (namespace, key, payload, expires_at)
                       VALUES (?, ?, ?, ?)
                       ON CONFLICT(namespace, key) DO UPDATE SET
                           payload = excluded.payload,
                           expires_at = excluded.expires_at""",
                    (namespace, key, payload, expires_at),
                )
            return True
        except (sqlite3.Error, TypeError, ValueError, OverflowError):
            logger.warning("Cache write unavailable or value invalid")
            return False

    def delete(self, key: str, namespace: str = "default") -> bool:
        """Remove a key in one namespace; deleting a missing key succeeds."""
        try:
            with self._connection() as connection:
                connection.execute(
                    "DELETE FROM cache_store WHERE namespace = ? AND key = ?",
                    (namespace, key),
                )
            return True
        except sqlite3.Error:
            logger.warning("Cache deletion unavailable")
            return False

    def purge_expired(self) -> int:
        """Remove expired entries, returning the count (zero if unavailable)."""
        try:
            with self._connection() as connection:
                cursor = connection.execute(
                    "DELETE FROM cache_store WHERE expires_at <= ?", (time.time(),)
                )
                return cursor.rowcount
        except sqlite3.Error:
            logger.warning("Cache expiry cleanup unavailable")
            return 0
