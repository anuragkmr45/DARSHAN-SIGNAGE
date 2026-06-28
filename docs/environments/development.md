# DARSHAN Development Environment

Last code-truth refresh: 2026-06-28.

Development is for local iteration. It is not production evidence.

## Code Sources

| Area | Source |
|---|---|
| Backend scripts | `darshan-server/package.json` |
| Backend local compose | `darshan-server/docker-compose.yml`, `darshan-server/docker-compose.dev.yml` |
| Backend config | `darshan-server/.env.example`, `darshan-server/src/config/index.ts`, `src/config/file-config.ts` |
| CMS scripts/config | `darshan-cms/package.json`, `darshan-cms/.env.example`, `darshan-cms/src/config/runtimeConfig.ts` |
| Player scripts/config | `darshan-player/package.json`, `darshan-player/src/common/config.ts`, `src/common/file-config.ts`, `src/common/platform-paths.ts` |

## Local Backend

The backend package exposes:

| Script | Behavior |
|---|---|
| `npm run dev` | `nodemon` local development path. |
| `npm run dev:watch` | `DARSHAN_PROCESS_ROLE=api tsx watch src/index.ts`; API-only role. |
| `npm run build` | TypeScript compile plus path alias rewrite. |
| `npm run start` | Runs built `dist/index.js` with default role resolution. |
| `npm run start:api` | Runs built runtime with `--role=api`. |
| `npm run start:worker` | Runs built runtime with `--role=worker`. |

Runtime role resolution comes from `darshan-server/src/runtime/process-role.ts`:

1. CLI `--role=api|worker|all`.
2. `DARSHAN_PROCESS_ROLE`.
3. legacy `HEXMON_PROCESS_ROLE`.
4. default `all`.

Local backend support compose in `darshan-server/docker-compose.yml` can run Postgres, MinIO, Valkey, API, and worker. This local compose is not the production Docker-on-VM role split.

## Local Backend Config

Development can start from:

```bash
cp darshan-server/.env.example darshan-server/.env
```

Use env for:

- `DATABASE_URL`
- `JWT_SECRET`
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`
- `CA_CERT_PATH` / `CA_KEY_PATH`
- `VALKEY_URL` if realtime bus is enabled
- tool overrides such as `FFMPEG_PATH`, `LIBREOFFICE_PATH`, `PG_DUMP_PATH`, `TAR_PATH`, `PLAYWRIGHT_BROWSERS_PATH`

Optional backend JSON config can be selected by `DARSHAN_CONFIG_FILE` or `SIGNHEX_CONFIG_FILE`. Env values override config file values. If both selectors are set to different resolved paths, startup fails fast.

## Local CMS

The CMS package exposes:

| Script | Behavior |
|---|---|
| `npm run dev` | Vite dev server. |
| `npm run build` | Vite production build. |
| `npm run lint` | ESLint. |
| `npm run test:unit` | Vitest unit tests. |
| `npm run preview` | Vite preview. |

CMS runtime config loads from `/config/app-config.json` by default through `darshan-cms/src/config/runtimeConfig.ts`. If absent, the CMS falls back to build-time `VITE_*` values and same-origin defaults. Runtime config rejects secret-looking keys, URL credentials, query strings, and fragments.

Development may use `darshan-cms/.env` for build-time fallbacks:

```env
VITE_CMS_RUNTIME_CONFIG_PATH=/config/app-config.json
VITE_API_BASE_URL=http://localhost:8080
VITE_WS_BASE_URL=http://localhost:8080
```

Do not place secrets in CMS env or runtime config.

## Local Player

The player package exposes:

| Script | Behavior |
|---|---|
| `npm run start:dev` | Builds main/renderer output and starts Electron with `NODE_ENV=development`. |
| `npm run build` | Builds main/renderer, bundles renderer assets, removes source maps. |
| `npm run doctor` | CLI diagnostics through `player:cli`. |
| `npm run pairing-status` | CLI pairing status. |
| `npm run reset-pairing` | Clears identity-bound pairing state; do not use casually on production devices. |
| `npm run package:linux:x64` / `package:linux:arm64` | Linux player package builds. |

Player site config is selected by `DARSHAN_PLAYER_CONFIG_FILE` or `SIGNHEX_PLAYER_CONFIG_FILE`. It is separate from runtime state paths such as `DARSHAN_CONFIG_PATH`, `DARSHAN_RUNTIME_ROOT`, `DARSHAN_CACHE_PATH`, and mTLS cert overrides.

Development can use a temp runtime root for isolated testing:

```bash
DARSHAN_RUNTIME_ROOT=/tmp/darshan-player-dev \
DARSHAN_PLAYER_CONFIG_FILE=/path/to/player-config.json \
npm run start:dev
```

Do not use dev-mode Electron as packaged-player production evidence.

## Development Evidence Boundary

Development checks can prove code compiles and flows are locally reachable. They do not prove:

- Docker-on-VM production deployment health,
- packaged player behavior,
- target hardware media rendering,
- real network/realtime latency,
- screenshot capture on target devices,
- production observability scrapes.

