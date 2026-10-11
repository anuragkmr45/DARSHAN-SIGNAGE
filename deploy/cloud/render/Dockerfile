FROM node:20-bookworm AS cms-build

WORKDIR /build/darshan-cms
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY darshan-cms/package.json darshan-cms/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY darshan-cms/ ./
RUN npm run build
COPY deploy/cloud/render/cms-app-config.json ./dist/config/app-config.json

FROM node:20-bookworm AS server-build

WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY darshan-server/package.json darshan-server/package-lock.json ./
RUN npm ci --no-audit --no-fund \
      --fetch-retries=5 \
      --fetch-retry-mintimeout=20000 \
      --fetch-retry-maxtimeout=120000 \
      --fetch-timeout=120000 \
      --maxsockets=4
COPY darshan-server/tsconfig.json darshan-server/tsconfig.scripts.json darshan-server/drizzle.config.ts ./
COPY darshan-server/src ./src
COPY darshan-server/scripts ./scripts
COPY darshan-server/drizzle ./drizzle
RUN npm run build && npm run typecheck:scripts

FROM node:20-bookworm AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    HOST=0.0.0.0 \
    DARSHAN_PROCESS_ROLE=all \
    DARSHAN_RUNTIME_CONTAINER=true \
    DARSHAN_CONFIG_FILE=/app/config/backend.cloud.json \
    CMS_STATIC_DIR=/app/cms \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      ffmpeg \
      libreoffice \
      poppler-utils \
      postgresql-client \
      tar \
    && rm -rf /var/lib/apt/lists/* \
    && usermod -a -G 1000 node

WORKDIR /app
COPY --from=server-build --chown=node:node /app/package.json ./
COPY --from=server-build --chown=node:node /app/node_modules ./node_modules
COPY --from=server-build --chown=node:node /app/dist ./dist
COPY --from=server-build --chown=node:node /app/src ./src
COPY --from=server-build --chown=node:node /app/scripts ./scripts
COPY --from=server-build --chown=node:node /app/drizzle ./drizzle
COPY --from=server-build --chown=node:node /app/tsconfig.json /app/tsconfig.scripts.json ./
COPY --from=cms-build --chown=node:node /build/darshan-cms/dist ./cms
COPY --chown=node:node deploy/cloud/render/backend.cloud.json ./config/backend.cloud.json
RUN mkdir -p /app/logs /app/tmp && chown node:node /app/logs /app/tmp

USER node
EXPOSE 10000
CMD ["node", "scripts/cloud-entrypoint.mjs"]
