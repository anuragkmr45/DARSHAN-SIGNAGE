FROM node:20-bookworm AS build

WORKDIR /app

COPY package*.json ./
COPY tsconfig*.json ./
RUN npm ci

COPY src ./src
COPY scripts ./scripts
COPY drizzle ./drizzle
RUN npm run build:production \
  && node scripts/build-production-package.mjs > runtime-package.json

FROM node:20-bookworm AS production-dependencies

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20-bookworm

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ENV DARSHAN_RUNTIME_CONTAINER=true

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  ffmpeg \
  libreoffice \
  postgresql-client \
  tar \
  util-linux \
  && rm -rf /var/lib/apt/lists/*

COPY --from=production-dependencies /app/node_modules ./node_modules

RUN find /app/node_modules -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.map' \) -delete

COPY --from=build /app/runtime-package.json ./package.json
COPY --from=build /app/dist-production ./dist
COPY --from=build /app/dist-cli ./dist-cli
COPY --from=build /app/drizzle ./drizzle
COPY docker/runtime-entrypoint.sh /usr/local/bin/darshan-runtime-entrypoint

RUN chmod 0755 /usr/local/bin/darshan-runtime-entrypoint \
  && mkdir -p /app/logs /app/tmp \
  && chown -R node:node /app

# API and worker processes run as the unprivileged account supplied by Node.
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/darshan-runtime-entrypoint"]
CMD ["npm", "start"]
