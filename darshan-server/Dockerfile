FROM node:20-bookworm AS build

WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package*.json ./
COPY tsconfig*.json ./
RUN npm ci

COPY src ./src
COPY scripts ./scripts
COPY drizzle ./drizzle
RUN npm run build:production \
  && node scripts/build-production-package.mjs > runtime-package.json \
  && cc -std=c11 -O2 -Wall -Wextra -Werror -o backup-broker-listener src/native/backup-broker-listener.c

FROM node:20-bookworm AS production-dependencies

WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20-bookworm

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV DARSHAN_RUNTIME_CONTAINER=true
ARG INSTALL_PLAYWRIGHT_CHROMIUM=false
ARG TARGETARCH
ARG AGE_VERSION=1.3.2
ARG AGE_LINUX_AMD64_ARCHIVE_SHA256=cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10
ARG AGE_LINUX_AMD64_BINARY_SHA256=eb7dd1b518f0a307c99cd97782623c5321da049154b04acd2d98d21aa7bc9b2c

ENV AGE_PATH=/usr/local/bin/age
ENV AGE_VERSION=${AGE_VERSION}
ENV AGE_SHA256=${AGE_LINUX_AMD64_BINARY_SHA256}

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  ffmpeg \
  libreoffice \
  postgresql-client \
  tar \
  util-linux \
  && rm -rf /var/lib/apt/lists/*

# age is shipped inside the released backend image so source-free target VMs
# never fetch a package. The upstream archive and installed binary are both
# pinned. Unsupported architectures fail closed until their upstream archive
# and digest are reviewed and added explicitly.
RUN set -eu; \
  [ "$TARGETARCH" = "amd64" ] || { echo "No reviewed age ${AGE_VERSION} binary pin for TARGETARCH=$TARGETARCH" >&2; exit 1; }; \
  age_archive="$(mktemp)"; \
  curl -fsSL --retry 3 \
    "https://github.com/FiloSottile/age/releases/download/v${AGE_VERSION}/age-v${AGE_VERSION}-linux-amd64.tar.gz" \
    -o "$age_archive"; \
  echo "${AGE_LINUX_AMD64_ARCHIVE_SHA256}  $age_archive" | sha256sum -c -; \
  tar -xzf "$age_archive" -C /tmp; \
  install -m 0755 /tmp/age/age /usr/local/bin/age; \
  echo "${AGE_LINUX_AMD64_BINARY_SHA256}  /usr/local/bin/age" | sha256sum -c -; \
  [ "$(age --version | sed 's/^v//')" = "$AGE_VERSION" ]; \
  rm -rf "$age_archive" /tmp/age

COPY --from=production-dependencies /app/node_modules ./node_modules

RUN if [ "$INSTALL_PLAYWRIGHT_CHROMIUM" = "true" ]; then \
    npx playwright install --with-deps chromium; \
  else \
    echo "Skipping Playwright Chromium install. Production bundle validation rejects this setting."; \
  fi \
  && find /app/node_modules -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.map' \) -delete \
  && mkdir -p /ms-playwright \
  && chown -R node:node /ms-playwright

COPY --from=build /app/runtime-package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/dist-production ./dist
COPY --from=build /app/dist-cli ./dist-cli
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/backup-broker-listener /usr/local/bin/backup-broker-listener
COPY docker/runtime-entrypoint.sh /usr/local/bin/darshan-runtime-entrypoint
COPY docker/darshan-backup-bridge.mjs /usr/local/libexec/darshan-backup-bridge

RUN chmod 0755 /usr/local/bin/darshan-runtime-entrypoint /usr/local/bin/backup-broker-listener /usr/local/libexec/darshan-backup-bridge \
  && sha256sum /usr/local/libexec/darshan-backup-bridge > /usr/local/libexec/darshan-backup-bridge.sha256 \
  && mkdir -p /app/logs /app/tmp /var/tmp/darshan-recovery-runtime/home /var/tmp/darshan-recovery-runtime/tmp \
  && chmod 0700 /var/tmp/darshan-recovery-runtime /var/tmp/darshan-recovery-runtime/home /var/tmp/darshan-recovery-runtime/tmp \
  && chown -R node:node /app /var/tmp/darshan-recovery-runtime

# Chromium must retain its sandbox. API and worker processes therefore run as
# the unprivileged account supplied by the official Node image.
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/darshan-runtime-entrypoint"]
CMD ["npm", "start"]
