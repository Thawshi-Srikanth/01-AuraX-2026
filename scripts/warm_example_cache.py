#!/usr/bin/env python3
"""Warm the server's persistent SQLite DB and FITS cache for example targets."""

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.example_cache import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())

