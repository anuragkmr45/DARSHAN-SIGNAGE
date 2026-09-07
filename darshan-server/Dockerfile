FROM node:20-bookworm

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV DARSHAN_RUNTIME_CONTAINER=true
ARG INSTALL_PLAYWRIGHT_CHROMIUM=false

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  ffmpeg \
  libreoffice \
  postgresql-client \
  tar \
  && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY drizzle.config.ts ./

# Install dependencies
RUN npm install
RUN if [ "$INSTALL_PLAYWRIGHT_CHROMIUM" = "true" ]; then \
    npx playwright install --with-deps chromium; \
  else \
    echo "Skipping Playwright Chromium install. Set INSTALL_PLAYWRIGHT_CHROMIUM=true when webpage/PDF rendering is required."; \
  fi

# Copy source code
COPY src ./src
COPY drizzle ./drizzle
COPY scripts ./scripts

# Build TypeScript
RUN npm run build

# Remote webpage capture must never require Chromium's --no-sandbox escape.
# The official Node image already provides this unprivileged runtime account.
RUN mkdir -p /app/logs /app/tmp /ms-playwright && chown -R node:node /app /ms-playwright
USER node

# Expose ports
EXPOSE 3000

# Start application
CMD ["npm", "start"]
