# macOS Host-Run Setup

This guide covers the supported macOS host-run backend path.

## 1. Install Node 20 LTS

Use `nvm`, `fnm`, or another version manager, then confirm:

```bash
node -v
npm -v
```

Expected result:

- Node 20.x
- npm available

## 2. Install Required Host Tools

Install the runtime dependencies with Homebrew:

```bash
brew install ffmpeg postgresql@16
brew install --cask libreoffice
```

Make sure `pg_dump` is on `PATH`. If Homebrew does not link it automatically, add the Homebrew PostgreSQL bin directory to your shell profile or set `PG_DUMP_PATH` explicitly.

`tar` is already available on macOS by default.

## 3. Configure The Project

```bash
cp .env.example .env
npm install
```

The default runtime tool settings already match a normal macOS host:

- `FFMPEG_PATH=ffmpeg`
- `LIBREOFFICE_PATH=soffice`
- `PG_DUMP_PATH=pg_dump`
- `TAR_PATH=tar`

Webpage capture is retired; no browser runtime is required on the backend.

## 4. Start PostgreSQL And MinIO

For local verification, Docker is still convenient for data services:

```bash
docker compose up -d postgres minio
```

Then initialize the database:

```bash
npm run db:push
npm run seed
```

## 5. Verify The Host Toolchain

```bash
npm run doctor:runtime
```

Expected result:

- ffmpeg, LibreOffice, pg_dump and tar are reported as `available`
- the command exits with code `0`

## 6. Run The Server Directly On macOS

```bash
npm run dev:watch
```

Or for a production-style local run:

```bash
npm run build
npm start
```

Then verify:

```bash
curl -sS http://localhost:3000/health
```

## 7. Functional Checks

Verify these existing features against the host-run server:

- video transcode job completes through FFmpeg
- `csv/xls/xlsx/doc/docx/ppt/pptx` conversion completes through LibreOffice
- Reports and Audit Logs PDF exports complete through LibreOffice
- manual backup completes with PostgreSQL and object-storage archives
- existing API responses remain unchanged

## 8. Notes

- macOS QuickLook is not used for document conversion. LibreOffice is the only supported conversion backend.
- Docker remains available, but it is optional and not required for feature-complete host-run support.
- `docker-compose.yml` is production-safe and runs the built server with `npm start`.
- `docker-compose.dev.yml` is the opt-in development override for bind mounts and `npm run dev`.
