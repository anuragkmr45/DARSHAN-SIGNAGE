# DARSHAN Nexus Core

`darshan-cms` is the CMS frontend for the DARSHAN platform.

## Scope

This repo owns CMS product code only:

- React/Vite application source
- UI components and pages
- frontend build/test config
- CMS-only developer docs

Deployment, support, QA, production, and multi-service runbooks are owned by the `DARSHAN monorepo root` repo.

Canonical platform docs:

- product export packaging: `docs/runbooks/product-export-packaging.md`
- QA: `docs/runbooks/onprem-qa-setup.md`
- production: `docs/runbooks/onprem-production-setup.md`
- bundle workflow: `docs/runbooks/onprem-bundle-builder.md`

## Local Development

```bash
npm install
npm run dev
```

Phase 4 observability notes:

- the CMS uses backend summary APIs under `/api/v1/observability/*`
- the browser does not call Prometheus directly
- Grafana is expected behind the same-origin `/grafana/` path in QA and production
- the CMS shows alert summary posture only; detailed alert silences and acknowledgement remain in Alertmanager and Grafana
- local development still works without Grafana or Prometheus; observability cards degrade to unavailable states instead of breaking the UI

## Build

```bash
npm run build
npm run preview
```

## Stack

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## Deployment Note

Do not deploy this repo checkout directly to QA or production targets. The supported deployment path is:

1. generate the CMS deploy package from `scripts/export/package-cms.sh`
2. assemble QA or production runtime bundles from the `DARSHAN monorepo root` repo

## Runtime Configuration And Authentication

The artifact build intentionally leaves `VITE_API_BASE_URL`, `VITE_WS_BASE_URL`,
and `VITE_WS_URL` blank. Missing, empty, and whitespace-only build URLs fall back
to the CMS origin. Runtime `/config/app-config.json` overrides these defaults;
nonempty malformed URLs and insecure production endpoints remain errors. Missing
runtime files (404), the default path returning development-server HTML, and
request timeouts retain the existing build fallback behavior. Invalid runtime
configuration blocks application startup with a visible configuration error.

The `artifact` environment label and `cms` identity are generic package defaults.
The production bundle assembler generates site identity and release metadata in
runtime JSON. Do not copy the development `public/config/app-config.json` into a
production installation or edit generated production identity by hand.

Production authentication uses HttpOnly cookies with `credentials: "include"`.
A login response only needs `user`; JWT and CSRF response fields remain optional
for development compatibility. Cookie sessions restore user state through
`/api/v1/auth/me` before protected routes render. The readable CSRF cookie is used
for writes and logout. Realtime connections accept cookie sessions without a
JavaScript token, and cookie sessions do not consume JWT refresh headers.

Authentication regression coverage:

```bash
npm run test:unit
npx playwright test tests/auth-cookie.e2e.spec.ts
# Use an already installed Google Chrome when Playwright Chromium is unavailable:
E2E_BROWSER_CHANNEL=chrome npx playwright test tests/auth-cookie.e2e.spec.ts
```

`E2E_LOCAL_HTTPS=true` allows a self-signed certificate only in the authentication
browser test when testing a local HTTPS build server. It does not change product
TLS validation. System Chrome test runs disable video capture because the
Playwright-managed ffmpeg helper may not be installed.
