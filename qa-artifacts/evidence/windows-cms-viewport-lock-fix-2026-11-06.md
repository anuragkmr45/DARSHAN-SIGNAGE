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

The operator authorized SSH access and CMS-only deployment. A read-only preflight to `192.168.29.64:22` was actively refused, and no approved local SSH key was present. No remote command, transfer, backup, service change, or deployment occurred. Deployment and the real pairing journey remain pending a reachable SSH endpoint and approved authentication path.
