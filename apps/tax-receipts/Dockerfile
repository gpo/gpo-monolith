# syntax=docker/dockerfile:1
#
# Images for the Tax Receipts & Contributions tool. Build from the REPO ROOT
# (the pnpm workspace spans apps/tax-receipts/* and packages/*):
#
#   docker build -f apps/tax-receipts/Dockerfile --target api       -t tax-receipts-api .
#   docker build -f apps/tax-receipts/Dockerfile --target api-tools -t tax-receipts-api-tools .
#   docker build -f apps/tax-receipts/Dockerfile --target web       -t tax-receipts-web .
#
# Targets:
#   api        Fastify API (node dist/server.js) on :3000. Production deps only.
#   api-tools  Full workspace with dev deps: runs `prisma migrate deploy`
#              (the default command) and, optionally, the evaluation seed.
#              Run it as a one-off job before each api rollout.
#   web        nginx serving the built SPA on :8080 and proxying /api/* to the
#              api (API_UPSTREAM, default http://api:3000).
#
# See apps/tax-receipts/DEPLOY.md for env vars and the staging topology.

ARG NODE_VERSION=22.13.1

# ---------------------------------------------------------------------------
# base: Node + pnpm + OpenSSL (Prisma's query engine links against it)
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# pinned to package.json "packageManager"; installed with npm rather than
# corepack to avoid corepack's signing-key checks on older Node images
RUN npm install -g pnpm@9.15.9
ENV PNPM_HOME=/pnpm \
  TURBO_TELEMETRY_DISABLED=1
WORKDIR /repo

# Workspace manifests only, so the dependency install layer is cached until
# a manifest or the lockfile changes.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.base.json ./
COPY apps/tax-receipts/api/package.json apps/tax-receipts/api/
COPY apps/tax-receipts/web/package.json apps/tax-receipts/web/
COPY packages/tax-receipts-core/package.json packages/tax-receipts-core/
COPY packages/qomon-client/package.json packages/qomon-client/
COPY packages/warehouse-client/package.json packages/warehouse-client/

# ---------------------------------------------------------------------------
# build: full install, then build the api, web, and the packages they use
# ---------------------------------------------------------------------------
FROM manifests AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY packages packages
COPY apps/tax-receipts/api apps/tax-receipts/api
COPY apps/tax-receipts/web apps/tax-receipts/web
RUN pnpm turbo run build --filter=@gpo/tax-receipts-api --filter=@gpo/tax-receipts-web

# ---------------------------------------------------------------------------
# api-tools: migrations and seeding (one-off jobs, not a server)
# ---------------------------------------------------------------------------
FROM build AS api-tools
WORKDIR /repo/apps/tax-receipts/api
ENV NODE_ENV=production
# DATABASE_URL must be set at run time. Seed (evaluation data, NOT for
# production): docker run ... tax-receipts-api-tools pnpm exec tsx prisma/seed.ts
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ---------------------------------------------------------------------------
# api: production runtime
# ---------------------------------------------------------------------------
FROM manifests AS api
ENV NODE_ENV=production
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --prod --store-dir /pnpm/store \
    --filter @gpo/tax-receipts-api...
COPY --from=build /repo/packages/tax-receipts-core/dist packages/tax-receipts-core/dist
COPY --from=build /repo/packages/qomon-client/dist packages/qomon-client/dist
COPY --from=build /repo/packages/warehouse-client/dist packages/warehouse-client/dist
# dist/ includes the generated Prisma client and its linux query engine
COPY --from=build /repo/apps/tax-receipts/api/dist apps/tax-receipts/api/dist
# the receipt PDF template (src/receipts/pdf.ts resolves ../../assets)
COPY apps/tax-receipts/api/assets apps/tax-receipts/api/assets

# Receipt PDFs and print batches are written here (local-disk artifact store,
# ticket 3.1). Mount a persistent volume: losing it loses issued receipt PDFs.
ENV ARTIFACT_STORAGE_DIR=/data/artifacts \
  HOST=0.0.0.0 \
  PORT=3000
RUN mkdir -p /data/artifacts && chown -R node:node /data
VOLUME ["/data"]

USER node
WORKDIR /repo/apps/tax-receipts/api
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]

# ---------------------------------------------------------------------------
# web: static SPA + /api reverse proxy
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS web
# the nginx image runs envsubst over /etc/nginx/templates/*.template at
# start, writing the result into /etc/nginx/conf.d/
ENV API_UPSTREAM=http://api:3000
RUN rm /etc/nginx/conf.d/default.conf
COPY apps/tax-receipts/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/tax-receipts/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
