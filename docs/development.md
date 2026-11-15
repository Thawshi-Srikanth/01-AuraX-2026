# Development setup

[Documentation](README.md) · [Contributing](../CONTRIBUTING.md)

## Requirements

- Git and Python 3.11 or newer.
- [uv](https://docs.astral.sh/uv/getting-started/installation/) for the Python environment.
- [Bun](https://bun.sh/docs/installation) for frontend dependencies, tests, and development.
- Internet access for dependency installation and live SIMBAD/IRSA requests.

Docker is optional. Locked dependency files are committed; use locked installs rather than updating packages during setup.

## Clone and launch

```sh
git clone https://github.com/Thawshi-Srikanth/01-AuraX-2026.git
cd 01-AuraX-2026
./dev
```

Windows users can double-click `dev.cmd`. For a checkout under `\\\\wsl.localhost` or `\\\\wsl$`, install uv and Bun inside the relevant WSL distribution.

The launcher synchronizes locked dependencies, starts both services, waits for the frontend API proxy, and opens the app. Its terminal shows logs and actual ports. If preferred ports are occupied, it selects free ports instead of stopping other applications. Ctrl+C stops both managed servers; launching again can reopen an existing managed session.

Run `./dev --help` for custom ports, `--no-browser`, and cache options. Native launcher caches live under `backend/cache/native-dev/` and are separate from Docker and manual-server caches. It does not require a root or Docker `.env`.

## Start services separately

Backend, from the repository root:

```sh
cd backend
uv sync --locked
uv run --locked uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In another terminal:

```sh
cd frontend
bun install --frozen-lockfile
bun run dev
```

Vite normally serves port 5173 and proxies `/backend` to port 8000. Open the URL printed in its terminal. Backend health: `http://127.0.0.1:8000/health`; API schema: `http://127.0.0.1:8000/docs`.

See [frontend environment options](../frontend/.env.example) for a different backend URL. Restart Vite after changing configuration. Health only checks the application, not archive availability.

## Checks before a pull request

From `backend/`:

```sh
uv sync --locked
uv run --locked pytest
uv run --locked ruff check .
uv run --locked ruff format --check .
```

From `frontend/`:

```sh
bun install --frozen-lockfile
bun run lint
bun test
bun run build
```

Run the checks relevant to your changes. Backend tests do not require astronomy archive access or downloaded observations. Unit tests and builds do not prove live service availability. Container and native-launcher checks are documented in [Deployment](deployment.md) and implemented in [scripts](../scripts).

## Configuration and repository hygiene

`CORS_ORIGINS` accepts comma-separated browser origins. Defaults allow localhost development origins; wildcard origins are rejected. Same-origin production requests normally need no extra CORS setting. See [backend settings](../backend/app) and [deployment environment example](../docker/.env.example) before changing runtime limits.

Do not commit credentials, `.env`, TLS keys, caches, downloaded FITS, `.venv`, `node_modules`, or generated builds. Keep dependency manifests and lockfiles consistent.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| uv or Bun not found | Install it in the same Windows/WSL/Linux environment running the launcher; reopen the terminal. |
| Frontend loads but API requests fail | Check backend logs and proxy URL; verify local `/health`. |
| IRSA returns 502/503 or a timeout | Distinguish service failure from zero coverage. Retry later; do not create fallback observations. |
| No useful images for a target | Review date/detector filters, returned coverage, field size, and target coordinates. |
| Port 80 already allocated in production | Preserve the existing Compose project and TLS overlay; see [existing-server updates](deployment.md#update-an-existing-deployment). |

Continue with [architecture](architecture.md), [API examples](api-reference.md), or [contributing](../CONTRIBUTING.md).
