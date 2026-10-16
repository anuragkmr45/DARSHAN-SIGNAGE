# CMS Production Authentication Fix — 2026-10-16

The CMS frontend fix is implemented and the production build is verified locally.
No production VM was contacted, no production service was restarted, and no
database, commit, push, or deployment operation was performed.

The existing release context is `2026-10-15-r1`, compatibility generation `1`.
The source baseline is `8e0bb6f5b93b230c2f08fe377cb52f8eccf729e2` on `release-01`.
The corrected source is currently uncommitted. The static build is a review
artifact; it is not a signed production role archive.

## 1. Inspection Findings And Root Cause

The package workflow deliberately sets `VITE_API_BASE_URL`, `VITE_WS_BASE_URL`,
and `VITE_WS_URL` to empty strings (`scripts/export/package-cms.sh:77`). That is
appropriate for a reusable artifact whose site settings arrive at runtime.

The original resolver used nullish fallback (`??`) in
`darshan-cms/src/config/runtimeConfig.ts:209`. Empty strings therefore reached
`validatePublicBaseUrl`, which rejects blank values. `resolveCmsRuntimeConfig`
constructs the build fallback before applying runtime overrides, so a valid
production JSON file could not rescue the blank build defaults.

The execution path was:

1. `main.tsx:51` calls `loadCmsRuntimeConfig`.
2. The fetched JSON reaches `resolveCmsRuntimeConfig`, which first constructs
   the build fallback and throws `Runtime CMS config api.baseUrl cannot be blank`.
3. The original startup handler logged the error and rendered the application.
4. `pages/Auth.tsx:56` calls `authApi.login`.
5. `api/apiClient.ts:106` calls `getCmsApiBaseUrl` before entering the request
   execution block. With no cached runtime configuration, the same validation
   error occurs before `fetch`.
6. The login page receives an ordinary `Error`, rather than `ApiError`, and shows
   its generic `Unable to login right now.` message. No login POST is dispatched.

This was reproduced directly using the original Git source and the supplied
production JSON: the original resolver throws the blank-URL error; the changed
resolver returns the runtime configuration and CMS-origin endpoints. The
before/after output is in the build's `evidence/root-cause.json`.

### Existing behavior and additional proven mismatches

- `api/types.ts:40` already declares `token` and `csrf_token` optional.
  `pages/Auth.tsx:58` already falls back to the readable CSRF cookie, stores the
  returned user, and navigates to a sanitized return path or `/dashboard`.
- `api/apiClient.ts:141` includes cookies with `credentials: "include"`.
  `components/auth/ProtectedRoute.tsx:26`, dashboard, API-key pages, settings,
  and authorization queries already accept user state without a bearer token.
- There was no call to `authApi.me` to restore a cookie session independently of
  persisted frontend state. A new browser session could have a valid HttpOnly
  cookie but no user in Redux.
- Notification, screen, and chat realtime hooks, plus chat directory/typing/read
  behavior, required a JavaScript token. Those gates disabled functionality after
  a valid production user-only login.
- The API client consumed `x-access-token` refresh headers even for cookie
  sessions, which could copy a refreshed JWT into Redux and session storage.
- Logout cleared client credentials before dispatching the server request and
  navigated before cookie expiration completed. The request now finishes before
  local cleanup and navigation, with local cleanup retained on request failure.

The backend contract was inspected without running backend services:
`darshan-server/src/routes/auth.ts:125` sets HttpOnly access and readable CSRF
cookies; `:149` includes JSON tokens only in development. The server hydrates
authorization from cookies (`src/server/index.ts:83`, `:367`), so `/auth/me` and
logout support cookies. The screen, chat, and notification namespaces accept
cookie authentication with an allowlisted Origin. No backend source was changed.

### Configuration identity and release contract

`VITE_CMS_ENVIRONMENT_NAME=artifact` and `VITE_CMS_ID=cms` are legitimate generic
defaults from the package script. The production assembler generates
`production`, `site-a`, and `cms-site-a` in runtime JSON
(`scripts/bundle/assemble-runtime-bundle.sh:4560`). They should not be hardcoded
into reusable frontend source.

The supplied production JSON loads successfully with blank artifact defaults.
It resolves API requests to `https://192.168.9.221/api/v1` and sockets to
`https://192.168.9.221`, using WebSocket transport.

The browser resolver consumes endpoint and identity-label fields. It currently
accepts but does not enforce or retain `releaseId`, `sourceCommit`, or
`compatibilityGeneration` in its normalized configuration. Those values belong
to signed bundle/role metadata and compatibility checks. The source-controlled
production generation remains `1`
(`scripts/bundle/production-bundle-config.mjs:8`). This fix does not change it or
rewrite the deployed release ID.

The authoritative production composition uses stock Nginx and a directory bind
mount: `./www:/usr/share/nginx/html:ro`
(`scripts/bundle/assemble-runtime-bundle.sh:4476`). The checkout-based custom
Nginx Dockerfile is a compatibility/lab path, not the source-free production
authority (`docs/contracts/deployment-config-contracts.md:30`).

## 2. Files Modified And Implementation

| File under `darshan-cms/` | Change |
|---|---|
| `src/config/runtimeConfig.ts` | Trim optional build URLs; blank values use API/socket fallback order. |
| `src/main.tsx` | Invalid runtime configuration shows an alert and blocks app startup. Existing supported missing-file/timeout fallbacks remain in the loader. |
| `src/components/auth/AuthSessionBootstrap.tsx` | Restore cookie user/CSRF state with `/auth/me` before routes render; clear invalid sessions. Existing development bearer sessions retain their initialization path. |
| `src/App.tsx` | Mount the session bootstrap inside the existing security boundary. |
| `src/api/apiClient.ts` | Read refresh JWT headers only for existing bearer sessions; let bootstrap handle `/auth/me` failures while preserving protected-request 401 cleanup/redirect. |
| `src/components/layout/AppHeader.tsx` | Await logout before clearing credentials/cache and navigating. |
| `src/hooks/notifications/useNotificationUnreadCount.ts` | Enable queries and cookie-capable sockets using token or user state. |
| `src/hooks/screens/useScreensRealtime.ts` | Permit authenticated cookie sessions to connect. |
| `src/hooks/chat/useChatRealtime.ts` | Permit authenticated cookie sessions to connect. |
| `src/pages/Conversations.tsx` | Permit cookie-session directory, typing, and read behavior. |
| `src/config/runtimeConfig.test.ts` | Configuration fallback/security regression cases. |
| `src/api/apiClient.test.ts` | User-only response, endpoint, CSRF, cookie JWT isolation, bearer refresh, and 401 regression cases. |
| `src/lib/realtimeSockets.test.ts` | Cookie-capable namespace connections without a JavaScript token. |
| `tests/auth-cookie.e2e.spec.ts` | Cookie login, redirect, reload restoration, logout, unauthenticated redirect, and invalid-config startup tests. |
| `playwright.config.ts` | Optional installed-Chrome test channel; disable its optional video helper dependency. |
| `README.md` | Document runtime/auth behavior and test commands. |

This runbook is the additional platform documentation file.

Nonempty malformed URLs still fail validation. Production/HTTPS transport
restrictions and production lockdown remain enabled. No route authorization,
backend/database schema, migration, or infrastructure configuration was changed.

## 3. Regression Coverage And Actual Results

Run commands from `darshan-cms` unless another directory is shown.

| Command/check | Actual result |
|---|---|
| `npm run test:unit` | 22 files, 113 tests passed. |
| `npm run lint` | Passed with 0 errors and 4 existing fast-refresh warnings in MediaPreview, EmergencyTakeoverModal, and StepScreenSelect. |
| `npx tsc --noEmit -p tsconfig.app.json` | Failed: existing `ignoreDeprecations: "6.0"` is invalid for installed TypeScript 5.9.3. |
| `npx tsc --noEmit -p tsconfig.app.json --ignoreDeprecations 5.0` | Failed on existing repository type errors. A TypeScript compiler-API comparison against original Git source found 126 diagnostics in both versions, with no added diagnostic signatures. Logs are included in evidence. |
| Browser command A below | 6 passed. |
| Browser command B below | 8 passed. |
| Browser command C against the final production build | 2 passed. |
| Production `npm run build` with artifact variables below | Passed, including bundle-budget check. Entry JS 221.8 KiB, 70.1 KiB gzip. |
| Generated manifest and HTML reference inspection | 90 manifest entries and 92 asset references resolved to existing files; entry HTML references exist. |
| `git diff --check` | Passed. |

```bash
# A: existing screen, dashboard, and media flows
E2E_BROWSER_CHANNEL=chrome npx playwright test \
  tests/screens.e2e.spec.ts \
  tests/dashboard-online-screens.e2e.spec.ts \
  tests/settings-default-media.e2e.spec.ts

# B: auth/config integration plus existing dashboard, scheduling, and admin flows
E2E_BROWSER_CHANNEL=chrome npx playwright test \
  tests/auth-cookie.e2e.spec.ts \
  tests/dashboard-active-scheduled.e2e.spec.ts \
  tests/scheduling-emergency.e2e.spec.ts \
  tests/admin-stabilization.e2e.spec.ts

# C: final compiled bundle on a temporary HTTPS server bound to 127.0.0.1:4173
E2E_BROWSER_CHANNEL=chrome \
E2E_BASE_URL=https://127.0.0.1:4173 E2E_LOCAL_HTTPS=true \
  npx playwright test tests/auth-cookie.e2e.spec.ts
```

The initial sandbox browser invocation could not start its local server. The
default Playwright browser executable and optional ffmpeg helper were also
absent. Tests were then run outside that sandbox with installed Google Chrome
and video disabled. The final local HTTPS server was stopped after verification.

Required coverage includes empty/whitespace/missing build API values; empty
socket values falling through to legacy socket/API/origin values; valid explicit
URLs; the supplied production runtime override; malformed and explicitly blank
runtime URLs; HTTPS enforcement; correct login endpoint; user-only cookie login;
CSRF logout; session restoration and return navigation; missing/invalid runtime
configuration; protected-request unauthorized handling; legacy bearer refresh;
and existing operator flows.

The frontend integration tests use mocked API responses and cookies, and socket
unit tests use a mocked Socket.IO client. They do not claim live backend, real
namespace authentication, physical player, or production acceptance results.
The credential-dependent live chat suite was not run. No failing suite was
silently skipped.

## 4. Production Build And Artifacts

Exact build command used:

```bash
cd /home/hexmon/DARSHAN-SIGNAGE/darshan-cms
VITE_API_BASE_URL= \
VITE_DEVICE_API_BASE_URL= \
VITE_WS_BASE_URL= \
VITE_WS_URL= \
VITE_CMS_RUNTIME_CONFIG_PATH=/config/app-config.json \
VITE_CMS_ENVIRONMENT_NAME=artifact \
VITE_CMS_DEPLOYMENT_ID=2026-10-15-r1 \
VITE_CMS_ID=cms \
VITE_ENABLE_PRODUCTION_LOCKDOWN=true \
VITE_REALTIME_DELIVERY_STATUS_UI=true \
VITE_MEDIA_CACHE_STATUS_UI=true \
  npm run build
```

Raw Vite output: `/home/hexmon/DARSHAN-SIGNAGE/darshan-cms/dist`.

Review artifact:
`/home/hexmon/DARSHAN-SIGNAGE/out/2026-10-15-r1/cms-auth-fix-build`.
It contains `www/`, `BUILD_EVIDENCE.json`, checksums, and test/build/typecheck
evidence. Its `www/` deliberately excludes `config/app-config.json`; the raw Vite
output otherwise includes the repository's development runtime file. Production
site configuration must come from the signed assembler.

The generated entry is `assets/index-o1BpxJzL.js`, SHA-256
`95bc2e3b1954c029b40033900be7931e2d0d456d82ad2d0e267b59636d3848be`.
The compiled code contains blank Vite URLs and the corrected `.trim() ||`
fallbacks. The production browser test verifies that the actual compiled bundle
initializes and logs in successfully with runtime overrides.

The canonical CMS package command, after approved source promotion to a clean
checkout, is:

```bash
cd /home/hexmon/DARSHAN-SIGNAGE
bash scripts/export/package-cms.sh --release "$CMS_FIX_RELEASE"
```

It creates `out/$CMS_FIX_RELEASE/cms` with `www/`, a stock Nginx image archive,
Compose/template files, checksums, and `ARTIFACT_MANIFEST.json`. It refuses dirty
source and removes the development runtime JSON. The full production builder
then generates the site JSON and signed role/transfer archives. This canonical
packaging was not run against uncommitted source, and the old
`out/2026-10-15-r1/cms` package was not overwritten or relabeled.

## 5. Release Readiness

- [x] Root cause reproduced against original source and fixed source.
- [x] Original TypeScript changed; generated JavaScript was not hand edited.
- [x] Supplied production runtime JSON loads with blank artifact defaults.
- [x] Cookie-only frontend login, restoration, CSRF/logout, and navigation pass.
- [x] Unit, lint, selected operator browser, and production HTTPS browser checks pass.
- [x] Production build and asset references verified.
- [x] Compatibility generation remains `1`; deployed release metadata was not edited.
- [ ] Resolve or explicitly accept the pre-existing TypeScript validation gate.
- [ ] Approve source promotion, choose an unused release ID, and create the signed bundle on the release authority machine.
- [ ] Verify actual CMS bind mounts, back up the active role, and perform production browser/realtime acceptance during the approved deployment.

The supported production contract requires a new signed release directory;
the builder and installer refuse to overwrite existing releases. Do not copy
these uncommitted static files into `/opt/darshan/2026-10-15-r1/cms/www` and leave
the old signed manifest in place. Such a copy would invalidate role verification
and falsely preserve old provenance. The instructions below use a new approved
release ID, while preserving the existing deployed release for rollback.

## 6. Deployment Procedure — For A Later Authorized Change

These commands are preparation instructions only. They were not run on any VM.
`CMS_FIX_RELEASE` must be the release authority's approved, unused ID; no new ID
is assigned by this task. Use the existing approved site configuration and PKI.

### Build and sign on the release authority machine

After the user authorizes committing/promoting the reviewed source:

```bash
cd /home/hexmon/DARSHAN-SIGNAGE
export CMS_FIX_RELEASE='<approved-unused-release-id>'
export CMS_FIX_CONFIG="deploy/production/bundles/site-a-${CMS_FIX_RELEASE}.env"
test "$CMS_FIX_RELEASE" != '2026-10-15-r1'
test -z "$(git status --porcelain)"

bash scripts/bundle/build-production-bundle.sh --validate-only "$CMS_FIX_CONFIG"
bash scripts/bundle/build-production-bundle.sh "$CMS_FIX_CONFIG"

cd "dist/onprem/site-a/${CMS_FIX_RELEASE}"
DARSHAN_RELEASE_TRUST_KEY=/secure/darshan-signing/release-signing.pem \
  ./verify-bundle.sh
```

Prepare the private `$CMS_FIX_CONFIG` before these commands. Required values
include the approved new `RELEASE_ID`, `SITE_NAME=site-a`, the existing service
hosts/bind addresses and ports, existing TLS names/CA/credentials, signing key
path, capacity evidence for the release, and `VOLUME_PROVISIONING_MODE=require-existing`
with the actual existing volume names. Keep all three frontend policy flags true.
The CMS production origin must remain `https://192.168.9.221`; backend proxy
upstream remains the approved TLS backend on port `3000`.

The builder requires server, CMS, and player artifact provenance to match its
release/source contract even when only the CMS role is transferred. Rebuild the
required packages from the approved source or supply correctly released
artifacts. Do not relabel old manifests to satisfy those checks. Do not use
`--skip-docker` output for deployment.

Expected deployable CMS archive:
`dist/onprem/site-a/$CMS_FIX_RELEASE/transfer/site-a-$CMS_FIX_RELEASE-cms.tgz`.
Keep the signed transfer manifest, its signature, and installer beside it.

### Back up VM 102 and verify the current layout

On the CMS VM during the later approved window:

```bash
cd /opt/darshan/2026-10-15-r1/cms
docker inspect darshan-site-a-cms-cms-1 \
  --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
docker inspect darshan-site-a-cms-cms-1 \
  --format '{{.Config.Image}} {{index .Config.Labels "com.docker.compose.project"}}'
./verify-role.sh

CMS_BACKUP_DIR="/opt/darshan/backups/cms-pre-auth-fix-$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -m 700 "$CMS_BACKUP_DIR"
sudo tar --acls --xattrs -czf "$CMS_BACKUP_DIR/cms-role.tgz" \
  -C /opt/darshan/2026-10-15-r1 cms
sudo chmod 600 "$CMS_BACKUP_DIR/cms-role.tgz"
sudo sha256sum "$CMS_BACKUP_DIR/cms-role.tgz" | \
  sudo tee "$CMS_BACKUP_DIR/SHA256SUMS.txt" >/dev/null
```

Confirm the actual mount is
`/opt/darshan/2026-10-15-r1/cms/www -> /usr/share/nginx/html` and the existing
Compose project is `darshan-site-a-cms`. If inventory differs, stop and reconcile
the deployment layout before applying these commands. The backup includes TLS
private material and generated environment files; retain it root-only and use
the established protected off-host backup destination. This CMS-only change
does not require a database migration or database restore operation.

### Transfer and install the signed CMS role

Transfer the four approved files to a private directory on VM 102 using the
existing deployment account/transport. For example, on the release machine:

```bash
cd /home/hexmon/DARSHAN-SIGNAGE
export CMS_DEPLOY_USER='<existing-deployment-user>'
scp "dist/onprem/site-a/${CMS_FIX_RELEASE}/transfer/site-a-${CMS_FIX_RELEASE}-cms.tgz" \
  "dist/onprem/site-a/${CMS_FIX_RELEASE}/transfer/TRANSFER_MANIFEST.sha256" \
  "dist/onprem/site-a/${CMS_FIX_RELEASE}/transfer/TRANSFER_MANIFEST.sig" \
  "dist/onprem/site-a/${CMS_FIX_RELEASE}/transfer/install-signed-role.sh" \
  "${CMS_DEPLOY_USER}@192.168.9.221:/tmp/darshan-cms-auth-fix/"
```

Create `/tmp/darshan-cms-auth-fix` as mode `0700` on the target before transfer.
On VM 102, with the same approved `CMS_FIX_RELEASE` value:

```bash
cd /tmp/darshan-cms-auth-fix
chmod 600 "site-a-${CMS_FIX_RELEASE}-cms.tgz" TRANSFER_MANIFEST.sha256 TRANSFER_MANIFEST.sig
chmod 700 install-signed-role.sh
openssl dgst -sha256 -verify /etc/darshan/trust/release-signing.pem \
  -signature TRANSFER_MANIFEST.sig TRANSFER_MANIFEST.sha256
awk -v archive="site-a-${CMS_FIX_RELEASE}-cms.tgz" \
  '$2 == archive || $2 == "install-signed-role.sh"' TRANSFER_MANIFEST.sha256 > selected-transfer.sha256
test "$(wc -l < selected-transfer.sha256)" -eq 2
sha256sum -c selected-transfer.sha256

sudo ./install-signed-role.sh \
  --archive "site-a-${CMS_FIX_RELEASE}-cms.tgz" \
  --role cms --release-root "/opt/darshan/${CMS_FIX_RELEASE}"

cd "/opt/darshan/${CMS_FIX_RELEASE}/cms"
sudo ./prepare-host.sh
./compatibility-check.sh
./load-images.sh
./start.sh
./health-check.sh
```

The same per-site Compose project recreates CMS-role containers with the new
`www` bind mount. No custom CMS image build or `docker cp` is required. These
commands do restart/recreate CMS-role services and therefore belong only in the
later explicitly authorized deployment. Do not run backend deploy/finalize,
migration, seed, password-reset, or other VM-role lifecycle commands for this fix.

### Post-deployment acceptance

From the new CMS role directory:

```bash
curl --fail --silent --show-error --cacert ./tls/transport-ca.crt \
  https://192.168.9.221/config/app-config.json | \
  jq -e --arg release "$CMS_FIX_RELEASE" '
    .cms.environment.name == "production" and
    .cms.environment.deploymentId == "site-a" and
    .cms.environment.cmsId == "cms-site-a" and
    .cms.environment.releaseId == $release and
    .cms.environment.compatibilityGeneration == 1 and
    .cms.api.baseUrl == "https://192.168.9.221" and
    .cms.realtime.socketBaseUrl == "https://192.168.9.221" and
    .cms.realtime.socketTransports == ["websocket"]'
./verify-role.sh
./health-check.sh
docker logs --since 10m darshan-site-a-cms-cms-1
```

Use the trusted production CA, without TLS bypass flags. In an operator browser,
reload the login page, sign in, confirm dashboard navigation, refresh a nested
protected route, and confirm `/auth/me` restoration in Nginx access logs. Confirm
login POSTs reach `/api/v1/auth/login`, then exercise logout and another protected
navigation. Verify role restrictions, dashboard data, screen/media/scheduling
flows, and realtime updates. The role health check verifies the public Engine.IO
WebSocket upgrade; operator acceptance must also prove authenticated namespace
behavior. Keep production inspection lockdown enabled.

## 7. Rollback Procedure

The old release directory and its host-prepared marker are retained. To roll
back the CMS role after an approved deployment:

```bash
cd /opt/darshan/2026-10-15-r1/cms
./verify-role.sh
./start.sh
./health-check.sh
docker inspect darshan-site-a-cms-cms-1 \
  --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
```

The old `start.sh` recreates the stable Compose project with the old bind mounts
and records the old release active after health succeeds. Do not invoke an old
`stop.sh` against a newer active release, edit active-release markers by hand,
or use `docker compose down -v`. If deployment failed before marking the new
release active, starting the old verified role is still the recovery action.

Verify the old `www` mount and HTTPS page, then refresh browser tabs. This
rollback restores the prior release, including its known frontend login defect;
it is a service rollback, not an alternative authentication fix. If the old
directory itself is damaged, restore the protected role backup to an isolated
directory, verify it, and follow the established signed-role recovery process
before starting it.

## 8. Remaining Issues And Limits

1. The existing TypeScript configuration/version mismatch and 126 baseline
   diagnostics remain. The Vite build succeeds because it transpiles without
   performing a full TypeScript type check. No new diagnostics were identified.
2. Signed production packaging is pending clean-source promotion, an approved
   unused release ID, release signing credentials, and the complete provenance
   inputs. This task did not bypass those release gates.
3. The existing backend still emits refreshed JWTs in `x-access-token` headers
   (`darshan-server/src/server/index.ts:272`), including for cookie requests.
   The corrected frontend does not read/store those headers for cookie sessions.
   The server header remains readable to same-origin JavaScript; removing that
   existing exposure requires a related backend security change and rollout.
   End-to-end HttpOnly isolation cannot be claimed while that header exists.
4. Live production authentication, real Socket.IO namespaces, player updates,
   certificate trust, and deployment/rollback were not executed. They remain
   explicit acceptance steps for the later authorized production change.
