# Runtime Config Triage

Date: 2026-06-18

## Issue

In CMS dev, `/config/app-config.json` can be served by Vite as `text/html` with the app shell. Before final QA, the CMS tried to parse that HTML as JSON and logged:

```text
CMS runtime config failed to load: Unexpected token '<'
```

The app still rendered because `main.tsx` falls back after the failed load, but the console made a normal local-dev fallback look like a broken app.

## Source Files

- `darshan-cms/src/config/runtimeConfig.ts`
- `darshan-cms/src/config/runtimeConfig.test.ts`
- `darshan-cms/src/main.tsx`

## Root Cause

The runtime config loader only treated `404` and aborts as fallback conditions. A Vite HTML fallback returns `200 text/html`, so `response.json()` threw.

## Fix

The loader now checks the response content type. If the default `/config/app-config.json` path returns `text/html`, it falls back to build-time env config. Explicit custom runtime config paths still fail clearly if they return non-JSON content.

## User Impact

- Local dev: less confusing console output.
- Production/site config: unchanged for explicit config files; invalid non-JSON config remains an error.

## Verification

- `cd darshan-cms && npm run test:unit -- --run src/config/runtimeConfig.test.ts`: passed, 8 tests.
- Clean CMS browser tab after the fix: 0 console errors, 2 React Router future warnings.

