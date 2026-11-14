# Containers and deployment

Development uses Bun/Vite and Uvicorn reload with mounted source. Production pulls
prebuilt images and serves the built UI through Nginx. Both use Docker Engine and
the Compose plugin; Python and Bun are not needed on the deployment host.

## Local development

From the repository root:

```sh
cp .env.example .env
docker compose up --build --wait
```

Open http://localhost:5173; the API is also at http://localhost:8000. Browser requests
use `/backend`; Vite forwards them to `backend:8000` inside the Compose network.
Source changes reload without rebuilding. Restart the relevant service after
changing its lockfile; locked dependencies are synchronized at startup. Rebuild
after changing a Dockerfile.

`DEV_FRONTEND_PORT` and `DEV_BACKEND_PORT` change the host ports if local servers
already occupy them. Development ports bind to localhost. Host `node_modules` and
`.venv` directories are not used inside containers. The default project is
`aurax-dev`, with separate dependency/cache volumes. `docker compose down` stops
it and retains those volumes.

## Published images

The Container checks and images workflow exercises production, TLS, and development
stacks before publishing production images for `linux/amd64` and `linux/arm64`:

- `ghcr.io/thawshi-srikanth/01-aurax-2026-backend:sha-COMMIT`
- `ghcr.io/thawshi-srikanth/01-aurax-2026-frontend:sha-COMMIT`

`COMMIT` is the full 40-character Git commit SHA from a successful workflow. Both
publish jobs must finish before deploying that tag. There is no mutable `latest`
tag. Main builds are releases; `codex/deployment-setup` builds provide the same
commit-tagged images for pre-merge verification. Pull requests check containers
without publishing. A manual workflow run on main can republish a commit.

Package visibility is separate from repository visibility. For anonymous pulls,
set both GHCR packages to Public in GitHub package settings. For private packages,
log the deployment host into `ghcr.io` using a token with `read:packages`, supplied
through `docker login --password-stdin`. Keep the token outside this repository.
The publishing workflow uses its built-in GitHub token.

## Production: pull and run

Only `docker-compose.prod.yml` and a configured `.env` are required on the host.
Application source and server-side builds are unnecessary. Copy `.env.example` to
`.env` and set `IMAGE_TAG=sha-COMMIT` to a successful workflow tag. The default
image prefix points to this repository.

```sh
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --no-build --wait --wait-timeout 150
docker compose -f docker-compose.prod.yml ps
curl --fail http://localhost/backend/health
```

HTTP binds to port 80. `PROD_HTTP_PORT` or `PROD_BIND_ADDRESS` changes the listener,
for example `127.0.0.1` behind an existing host reverse proxy. Nginx serves SPA
routes, static assets, `/backend/*`, direct `/api/*`, and `/health`.
`/nginx-health` checks Nginx itself. Docker DNS re-resolution handles backend
container replacement.

The production project is `aurax`; its named `backend-cache` volume retains SQLite
metadata and FITS files across updates. Keep this project name consistent when
moving deployment files. The backend runs as an unprivileged user; only Nginx
publishes a host port. Forwarded headers are trusted on the internal Compose
network. Keep one backend process and container per cache volume: file leases,
admission locks and job histories are process-local. Sharing a cache across
replicas or multiple workers is not supported.

FITS quotas use `FITS_CACHE_MAX_BYTES`, `FITS_CACHE_MAX_FILE_BYTES`, and
`FITS_CACHE_MAX_IDLE_SECONDS` from `.env`. The per-file limit cannot exceed 128 MiB
or the total budget. Nginx allows bounded archive requests up to 150 seconds;
longer comparison searches use the existing polling API. Runtime job histories
reset on restart; cached payloads remain on the volume.

Same-origin requests need no CORS setting. Set `CORS_ORIGINS` only when an
additional browser origin must access the backend directly. Backend health does
not imply that SIMBAD/IRSA is available or a target has coverage.

To update, change `IMAGE_TAG` to another successful commit, then repeat `pull` and
`up`. To roll back, use the previous successful tag and repeat those commands.
Cache formats must remain compatible when rolling back. Logs rotate at 10 MiB
with two retained files per service.

## Optional Nginx HTTPS

The HTTP stack works behind an existing HTTPS proxy. To terminate HTTPS inside
Nginx, supply existing host certificates and configure `.env`:

```dotenv
SERVER_NAME=aurax.example.com
TLS_CERTS_DIR=/etc/letsencrypt
TLS_CERTIFICATE_FILE=/etc/letsencrypt/live/aurax.example.com/fullchain.pem
TLS_CERTIFICATE_KEY=/etc/letsencrypt/live/aurax.example.com/privkey.pem
```

Replace the hostname and paths with your certificate setup. The whole directory
is mounted read-only so Let's Encrypt symlinks resolve. Keys/certificates are
supplied at runtime, not built into images. The baked-in template is enabled by
the TLS overlay:

```sh
docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml pull
docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml up -d --no-build --wait --wait-timeout 150
```

HTTP redirects to HTTPS except for the internal health endpoint. Port 443 is
published (`PROD_HTTPS_PORT` overrides it). DNS, certificate issuance and renewal
stay with the host certificate manager. Recreate the frontend after renewal.
Use the same two `-f` arguments for later TLS updates and shutdowns.

## Verify containers

```sh
docker compose config --quiet
IMAGE_TAG=sha-COMMIT docker compose -f docker-compose.prod.yml config --quiet
python3 scripts/check_containers.py
```

The check also requires Python 3 and OpenSSL on the host. It builds images, starts
uniquely named localhost-only projects, and verifies SPA routes, API prefixes,
JSON errors, cache ownership/persistence, backend replacement, trusted-certificate
HTTPS, source mounts and Uvicorn reload. It uses coordinate-only calls; no astronomy
archive queries are made. Cleanup touches only its own containers, volumes and
probe files. Docker image/build caches remain available.

To verify an already-pulled production pair (including optional TLS):

```sh
python3 scripts/check_containers.py --production-only --skip-build \
  --image-prefix ghcr.io/thawshi-srikanth/01-aurax-2026 --tag sha-COMMIT
```

References: [Compose startup](https://docs.docker.com/compose/how-tos/startup-order/),
[uv containers](https://docs.astral.sh/uv/guides/integration/docker/),
[GHCR publishing](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images).
