# Containers and deployment
[Documentation](README.md) · [Development setup](development.md)

Development uses Bun/Vite and Uvicorn reload with mounted source. Production pulls
prebuilt images and serves the built UI through Nginx. Both use Docker Engine and
the Compose plugin; Python and Bun are not needed on the deployment host.

## Local development

For native development, double-click `dev.cmd` or run `./dev` from the repository
root. Docker is optional. All container configuration lives in `docker/`.

For container development, start from the repository root:

```sh
cd docker
cp .env.example .env
docker compose -f compose.dev.yml up --build --wait
```

Open http://localhost:5173; the API is also at http://localhost:8000. Browser requests
use `/backend`; Vite forwards them to `backend:8000` inside the Compose network.
Source changes reload without rebuilding. Restart the relevant service after
changing its lockfile; locked dependencies are synchronized at startup. Rebuild
after changing a Dockerfile.

`DEV_FRONTEND_PORT` and `DEV_BACKEND_PORT` change the host ports if local servers
already occupy them. Development ports bind to localhost. Host `node_modules` and
`.venv` directories are not used inside containers. The default project is
`aurax-dev`, with separate dependency/cache volumes.
`docker compose -f compose.dev.yml down` stops it and retains those volumes.

## Published images

The Container checks and images workflow exercises production, TLS, and development
stacks before publishing production images for `linux/amd64` and `linux/arm64`:

- `ghcr.io/thawshi-srikanth/01-aurax-2026-backend:sha-COMMIT`
- `ghcr.io/thawshi-srikanth/01-aurax-2026-frontend:sha-COMMIT`

`COMMIT` is the full 40-character Git commit SHA from a successful workflow. Both
publish jobs and the final pull-only deployment check must finish before
deploying that tag. There is no mutable `latest` tag. Main builds publish releases.
Pull requests check containers without publishing. A manual workflow run on main
can republish a commit.

Package visibility is separate from repository visibility. For anonymous pulls,
set both GHCR packages to Public in GitHub package settings. For private packages,
log the deployment host into `ghcr.io` using a token with `read:packages`, supplied
through `docker login --password-stdin`. Keep the token outside this repository.
The publishing workflow uses its built-in GitHub token.

## Production: pull and run

Run these commands from `docker/`, or a deployment directory containing the copied
configuration files. Only `compose.prod.yml` and a configured `.env` are required
on the host.
Application source and server-side builds are unnecessary. Copy `.env.example` to
`.env` and set `IMAGE_TAG=sha-COMMIT` to a successful workflow tag. The default
image prefix points to this repository.

```sh
docker compose -f compose.prod.yml pull
docker compose -f compose.prod.yml up -d --no-build --wait --wait-timeout 150
docker compose -f compose.prod.yml ps
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

## Update an existing deployment

First identify the project name and configuration files used by the running frontend. Do not assume the default project name when updating a previous deployment:

```sh
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
docker inspect EXISTING_FRONTEND_CONTAINER --format '{{ index .Config.Labels "com.docker.compose.project" }}'
docker inspect EXISTING_FRONTEND_CONTAINER --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}'
```

Replace `EXISTING_FRONTEND_CONTAINER` with the name printed by the first command. Keep the same deployment directory, environment settings, project name, and all configuration overlays. Change only `IMAGE_TAG` to the full `sha-COMMIT` of a successfully published and pull-tested image pair.

For the existing **aurax-public** deployment using the production and TLS files, run from its deployment directory:

```sh
docker compose -p aurax-public -f compose.prod.yml -f compose.tls.yml pull
docker compose -p aurax-public -f compose.prod.yml -f compose.tls.yml up -d --no-build --wait --wait-timeout 150
docker compose -p aurax-public -f compose.prod.yml -f compose.tls.yml ps
docker compose -p aurax-public -f compose.prod.yml -f compose.tls.yml images
```

Use your actual project name for other installations. HTTP-only installations omit the TLS overlay. A routine update does not require `down`; preserving the project name reuses its cache volume and replaces its services. Do not use `down -v` or delete volumes to refresh an image. A newly created default project does not share the existing project's volume.

### Port 80 already allocated

A common cause is starting a second project named `aurax` while `aurax-public` still owns ports 80 and 443. Inspect the running containers and labels above. Update the original project; do not stop an unidentified proxy or change TLS just to free the port. If you have confirmed an accidental duplicate project, remove only that duplicate without volume deletion.

### Old page or video placeholder

Compare the running frontend tag with the selected release. A successful `pull` alone does not replace a running container, and a frontend that failed to start cannot serve the new UI. Complete `up`, check health and ports, then hard-refresh or use a private browser window. If a reverse proxy/CDN is involved, inspect its cache after verifying the origin container. Keep the previous successful tag for rollback.

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
docker compose -f compose.prod.yml -f compose.tls.yml pull
docker compose -f compose.prod.yml -f compose.tls.yml up -d --no-build --wait --wait-timeout 150
```

HTTP redirects to HTTPS except for the internal health endpoint. Port 443 is
published (`PROD_HTTPS_PORT` overrides it). DNS, certificate issuance and renewal
stay with the host certificate manager. Recreate the frontend after renewal.
Use the same two `-f` arguments for later TLS updates and shutdowns.

## Verify containers

Starting in `docker/`:

```sh
docker compose -f compose.dev.yml config --quiet
IMAGE_TAG=sha-COMMIT docker compose -f compose.prod.yml config --quiet
cd ..
python3 scripts/check_containers.py
```

The check also requires Python 3 and OpenSSL on the host. It builds images, starts
uniquely named localhost-only projects, and verifies SPA routes, API prefixes,
JSON errors, cache ownership/persistence, backend replacement, trusted-certificate
HTTPS, source mounts and Uvicorn reload. It uses coordinate-only calls; no astronomy
archive queries are made. Cleanup touches only its own containers, volumes and
probe files. Docker image/build caches remain available.

From the repository root, verify an already-pulled production pair (including optional TLS):

```sh
python3 scripts/check_containers.py --production-only --skip-build \
  --image-prefix ghcr.io/thawshi-srikanth/01-aurax-2026 --tag sha-COMMIT
```

References: [Compose startup](https://docs.docker.com/compose/how-tos/startup-order/),
[uv containers](https://docs.astral.sh/uv/guides/integration/docker/),
[GHCR publishing](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images).
