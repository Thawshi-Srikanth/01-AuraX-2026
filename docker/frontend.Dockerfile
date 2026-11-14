# syntax=docker/dockerfile:1
FROM oven/bun:1.3.5-slim AS dependencies
WORKDIR /app
RUN chown bun:bun /app
USER bun
COPY --chown=bun:bun frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile
COPY --chown=bun:bun frontend/ ./

FROM dependencies AS development
USER bun
EXPOSE 5173
HEALTHCHECK --interval=5s --timeout=5s --start-period=30s --retries=12 \
    CMD bun -e "fetch('http://127.0.0.1:5173/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "bun install --frozen-lockfile && exec bun run dev --host 0.0.0.0 --port 5173"]

FROM dependencies AS build
# Browser requests stay same-origin in every environment.
ENV VITE_API_BASE_URL=/backend
RUN bun run build

FROM nginx:1.28-alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx/upstream.conf /etc/nginx/conf.d/00-upstream.conf
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY docker/nginx/includes/ /etc/nginx/aurax/
COPY docker/nginx/default.ssl.conf /etc/nginx/https/default.conf.template
EXPOSE 80 443
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
    CMD wget -q -O /dev/null http://127.0.0.1/nginx-health || exit 1
