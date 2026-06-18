# CONFIG-3 Handoff: CMS Runtime Config Alignment

## Summary

CONFIG-3 adds optional browser runtime config for the CMS while preserving existing Vite build-time behavior when no runtime config file is deployed.

The CMS now attempts to load `/config/app-config.json` before mounting React. A missing file falls back to existing `VITE_*` values and same-origin defaults. Runtime config is browser-visible and only accepts non-secret endpoint, environment, realtime transport, and diagnostics labels.

## Scope Implemented

- Added CMS runtime config resolver and loader in `darshan-cms/src/config/runtimeConfig.ts`.
- Added runtime API base URL resolution in `darshan-cms/src/api/apiClient.ts`.
- Added runtime socket base URL/transport resolution for chat, screens, and notifications sockets.
- Added startup loading before React mount in `darshan-cms/src/main.tsx`.
- Added examples:
  - `docs/examples/cms-runtime-config.onprem-local-192.168.0.5.example.json`
  - `docs/examples/cms-runtime-config.qa.example.json`
  - `docs/examples/cms-runtime-config.production.example.json`
- Added tests for runtime config parsing, API base URL resolution, and socket runtime config use.

## Out of Scope

- No backend config changes.
- No player config changes.
- No CMS secret loading from runtime config.
- No browser QA or packaged runtime evidence.
- No production readiness approval.

## Files Changed

- `darshan-cms/src/config/runtimeConfig.ts`
- `darshan-cms/src/config/runtimeConfig.test.ts`
- `darshan-cms/src/api/apiClient.ts`
- `darshan-cms/src/api/apiClient.test.ts`
- `darshan-cms/src/lib/chatSocket.ts`
- `darshan-cms/src/lib/screensSocket.ts`
- `darshan-cms/src/lib/notificationsSocket.ts`
- `darshan-cms/src/lib/realtimeSockets.test.ts`
- `darshan-cms/src/main.tsx`
- `docs/examples/cms-runtime-config.onprem-local-192.168.0.5.example.json`
- `docs/examples/cms-runtime-config.qa.example.json`
- `docs/examples/cms-runtime-config.production.example.json`
- `docs/architecture/onprem-config-architecture.md`
- `docs/implementation/config-env-reduction-plan.md`
- `docs/runbooks/onprem-config-management.md`
- `docs/implementation/realtime-sync-open-risks.md`

## Config Selectors

CMS CONFIG-3 does not add env file selectors. It uses:

- optional browser file: `/config/app-config.json`
- existing build-time fallback: `VITE_API_BASE_URL`, `VITE_WS_BASE_URL`, `VITE_WS_URL`
- optional runtime file path override at build time: `VITE_CMS_RUNTIME_CONFIG_PATH`

## Config File Formats Supported

JSON only.

## Env Compatibility

Existing Vite build-time env behavior is preserved when `/config/app-config.json` is absent. If a runtime config file is deployed, it intentionally overrides baked `VITE_*` endpoint values because it is loaded by the browser after the static bundle is built.

## Browser Runtime State Boundary

The runtime config is browser-visible and must not contain:

- tokens
- passwords
- URL userinfo
- URL query strings
- URL fragments
- signed URLs
- private keys
- PEM material
- session or Redux state

Auth tokens, persisted state, and backend API responses remain outside config.

## Redacted Diagnostics

CONFIG-3 avoids logging runtime config values at startup. The config resolver rejects secret-looking keys and credentialed/query/fragments in URL fields instead of redacting and accepting them.

## Tests Run

- `cd darshan-cms && npx vitest run src/config/runtimeConfig.test.ts`
- `cd darshan-cms && npx vitest run src/api/apiClient.test.ts`
- `cd darshan-cms && npx vitest run src/lib/realtimeSockets.test.ts`
- `cd darshan-cms && npm run build`
- `cd darshan-cms && npm run lint`
- `cd darshan-cms && npm run test:unit`

## Test Results

All CONFIG-3 targeted checks passed locally under Node `v24.12.0`:

- `runtimeConfig.test.ts`: 6 passed
- `apiClient.test.ts`: 1 passed
- `realtimeSockets.test.ts`: 5 passed
- CMS unit suite: 17 files, 79 tests passed
- CMS production build passed
- CMS lint passed

## Failed Tests

None after the secret-key matcher fix for camelCase secret-looking keys.

## Blocked Tests

- Node 20 validation is still blocked because this workspace is using Node `v24.12.0`.
- Browser QA is not run.
- On-prem runtime evidence is not run.

## Runtime Evidence Status

BLOCKED_BY_ENV. No on-prem CMS/backend endpoints or packaged runtime target were provided in this pass.

## Risks

- Runtime config is browser-visible; operators must keep secrets in backend/player env/secrets stores, not in CMS runtime JSON.
- If `/config/app-config.json` contains invalid JSON or forbidden values, CMS startup fails fast rather than silently using unsafe config.
- Browser QA remains required to verify deployment server behavior and cache headers for `config/app-config.json`.

## Rollback Plan

Remove `/config/app-config.json` from the CMS static deployment or stop setting `VITE_CMS_RUNTIME_CONFIG_PATH`. The CMS will return to existing `VITE_*` build-time endpoint behavior. Code rollback is limited to the CONFIG-3 files listed above.

## Next Phase Readiness

CONFIG-4 can start after independent review if local CONFIG-3 evidence is accepted. CONFIG-4 should create complete on-prem profile sets and validation scripts without claiming runtime evidence.

## Recommendation

APPROVE_WITH_CONDITIONS
