# AURAx

AURAx is an astronomical exploration application for SPHEREx infrared observations.
This repository is being built progressively, starting with the backend.

## Available now

- A minimal FastAPI backend with a health endpoint.
- Explicit configuration of allowed browser origins.
- Automated backend tests.

Astronomy endpoints and the frontend have not been migrated yet.

## Run the backend

Requires Python 3.11 or newer and [uv](https://docs.astral.sh/uv/).

```sh
cd backend
uv sync --locked
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000/health> for the health response and
<http://127.0.0.1:8000/docs> for the API documentation.
The health response confirms that the API is running; it does not check external archives.

## Configuration

`CORS_ORIGINS` accepts a comma-separated list of browser origins.
By default, it allows `http://localhost:5173` and `http://127.0.0.1:5173`.
Set it explicitly for a deployed frontend. Wildcard origins are rejected.

```sh
CORS_ORIGINS=https://your-frontend.example uv run uvicorn app.main:app
```

## Verify

From `backend/`:

```sh
uv run --locked pytest
uv run --locked ruff check .
uv run --locked ruff format --check .
```

Tests run without astronomy archive access or downloaded observation data.
