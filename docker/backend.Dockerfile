# syntax=docker/dockerfile:1
FROM ghcr.io/astral-sh/uv:0.11.17 AS uv
FROM python:3.12-slim AS base
COPY --from=uv /uv /uvx /usr/local/bin/
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv PATH="/opt/venv/bin:$PATH" \
    UV_CACHE_DIR=/tmp/uv-cache \
    CACHE_DB_PATH=/data/aurax.db FITS_CACHE_DIR=/data/fits \
    OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1
WORKDIR /app
RUN groupadd --gid 10001 aurax && useradd --uid 10001 --gid aurax --no-create-home aurax \
    && mkdir -p /data/fits /opt/venv && chown -R aurax:aurax /data /opt/venv /app
COPY --chown=aurax:aurax backend/pyproject.toml backend/uv.lock ./
USER aurax
RUN --mount=type=cache,target=/tmp/uv-cache,uid=10001,gid=10001 uv sync --locked --no-dev --no-install-project
COPY --chown=aurax:aurax backend/app ./app
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"]

FROM base AS development
RUN --mount=type=cache,target=/tmp/uv-cache,uid=10001,gid=10001 uv sync --locked --group dev --no-install-project
ENV UV_CACHE_DIR=/tmp/uv-cache
USER aurax
CMD ["sh", "-c", "uv sync --locked --group dev --no-install-project && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir /app/app"]

FROM base AS production
USER aurax
# Locks, leases and job histories are process-local. Keep exactly one worker.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
