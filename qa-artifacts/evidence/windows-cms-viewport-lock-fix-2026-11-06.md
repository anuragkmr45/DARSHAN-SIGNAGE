# Windows QA CMS viewport-lock fix evidence — 2026-11-06

## Scope

- Environment: isolated Windows player QA deployment at `192.168.29.64`
- Fixture prefix: `WIN-QA-20261105-`
- Branch: `codex/windows-player-runtime-validation-20261105`
- Defect: **P1** — the production security boundary treated ordinary Microsoft Edge browser chrome/startup UI as an already-open developer-tools viewport and redirected an authenticated operator session to the security lock screen.

## Reproduction

1. Open the real QA CMS in native Microsoft Edge.
2. Sign in as the QA administrator using credentials entered directly by the operator.
3. Open Dashboard, Screens, and the Pair Device dialog.
4. Allow the CMS production-lockdown viewport check to run.
5. Observe the redirect to `/login?redirect=%2Fdashboard` with the production security lock and trigger `devtools viewport heuristic`, despite no developer tools being opened.

No credential, session cookie, token, private key, pairing code, or device certificate is included in this record.

## Root cause and fix

The previous heuristic compared the absolute `outerWidth/innerWidth` and `outerHeight/innerHeight` deltas with a fixed 160-pixel threshold. Normal Edge chrome could exceed that absolute delta. The fix records the ordinary browser-chrome delta as a baseline, lowers the baseline if chrome later shrinks, and locks only when a later viewport delta increases by more than 160 pixels. Existing F12, Ctrl/Shift shortcut, and context-menu controls are unchanged.

Changed source:

- `darshan-cms/src/components/security/ProductionSecurityBoundary.tsx`
- `darshan-cms/src/components/security/productionSecurityViewport.ts`
- `darshan-cms/src/components/security/productionSecurityViewport.test.ts`

## Verification

- Focused regression: **PASS**, 4/4 tests.
- Full CMS unit suite: **PASS**, 291/291 tests, using the documented process-scoped runtime-config path.
- CMS lint: **PASS**, zero errors; three pre-existing warnings.
- Production-lockdown CMS build: **PASS**, 2,599 modules.
- Native Edge smoke against a read-only Docker-served production build: **PASS**. The login UI remained usable with the same visible Edge startup chrome both initially and after polling.
- F12-trigger verification in the automated native smoke: **BLOCKED** because the Windows input-control helper rejected the injected key; the existing F12 handler was not modified.
- Real QA integration after fix: **BLOCKED** until the CMS-only artifact is deployed to the isolated QA host.

Production build artifact before official packaging:

- Files: 104
- Bytes: 4,026,160
- Manifest SHA-256: `8c81b4c6af2ca5a5e9f57548999c2dec9bc9a6c1cc34a2970d139a782afcd1db`

## Deployment status

The operator authorized SSH access and CMS-only deployment. A read-only preflight to `192.168.29.64:22` was actively refused during SSH key exchange, and no approved local SSH key was present. No remote command, transfer, backup, service change, or deployment occurred. Deployment and the real pairing journey remain pending a reachable SSH endpoint and approved authentication path.

## Official CMS-only deployment package

The repository's official clean-tree CMS exporter completed from fix commit `a85ffb6051a9d4018700fc0eb236ee4bfac899db` with production lockdown enabled.

- Release ID: `windows-player-qa-20261105-cms-a85ffb6`
- Source tree recorded clean: **yes**
- Build: **PASS**, 2,599 modules and bundle budget pass
- Container runtime: `nginx:1.27-alpine`
- Container image digest: `sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10`
- Package files: 135 including `SHA256SUMS.txt`
- Package bytes before archive: 26,018,416
- Generated checksum verification: **PASS** for every manifest-covered package file
- Archive read verification: **PASS**
- Archive: `out/windows-player-qa-20261105-cms-a85ffb6/windows-player-qa-20261105-cms-a85ffb6.tar.gz`
- Archive bytes: 22,247,094
- Archive SHA-256: `db48f2c85328b7ae39226ea377d2c6cffa47388e951c84a95a3ebc07aea04333`

The dependency install reported 30 total npm advisories. A production-dependency-only audit reported 16 advisories (4 moderate, 12 high, 0 critical). These packages are compiled into the static browser build rather than installed as a Node service on the QA host, but the advisories remain recorded release risk; dependency upgrades are outside this focused viewport-lock fix and were not applied silently.
