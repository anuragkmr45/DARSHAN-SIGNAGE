# Backup and recovery Packet 04C2B CMS developer verification — 2026-10-29

## Implemented CMS surface

- Added `Backup` to subject-wide authorization checks and Settings module navigation. A role with an explicit unconditional `read Backup` grant can reach `/settings` without receiving organization settings, branding, logs, policy-update, or role access. Forbidden module redirects now select an actually accessible module, so a Backup-only role lands on Settings instead of looping on Dashboard.
- Settings tabs are authorization-scoped and choose an allowed default. Backup-only rendering mounts only the dedicated Backups surface; unrelated general, branding, security, appearance, default-media, logs, and roles queries are not issued. Shell appearance/branding bootstrap queries are also permission-gated.
- Replaced the legacy archive/presigned-link `BackupRun` model with safe history/detail/operation DTOs matching Packet 04C2A. Artifact sizes remain decimal strings, raw error messages and repository paths are absent, history health is limited to current server fields, and no last-success/verified-available monitoring fields are invented.
- Added parameterized history/detail/operation query keys and typed API methods for cursor pagination, detail, deletion operation, run-now, and idempotent deletion admission. Execution and deletion polling runs only while state is active. A 202 deletion response patches and invalidates the retained history row, detail, and operation rather than removing the row. Backup cache is cleared and authorization is refreshed on 401/403.
- Post-acceptance hardening makes 401/403 fail closed for active observers: every other pending backup-root read is cancelled with no state reversion before all mounted backup results are synchronously redacted and inactive entries are removed. Hook results independently suppress denied data while authorization refresh is in flight. `QueryObserver` concurrency regressions prove both that an existing row disappears and that an older pending history success cannot repopulate data after a policy denial; a fresh history fetch works again after authorization completes, so there is no permanent denial latch.
- A delete action now creates one idempotency key outside the mutation function and preserves it across the one permitted transport/5xx retry. Retry preflight replays DELETE with that same key when the fresh record exposes an active deletion operation, terminal `SUCCEEDED` operation, or tombstone. This covers both still-running admission and deletion that completed before the retry; an ineligible record without deletion evidence remains stale. 4xx responses are never retried. Run-now explicitly disables mutation retries because the endpoint has no client idempotency key.
- Added a dedicated `BackupsSection` explaining installation-wide scope and deployment-managed cadence/retention/off-host policy. It renders execution, capture/verification, artifact lifecycle, decimal-safe artifact sizes, expiry, retention protection codes, restore holds, deletion progress, tombstones, loading/error/empty, and unsupported/unconfigured runtime states.
- Run-now, artifact deletion, and download controls are independently permission-gated. Download is visibly disabled as `BACKUP_DOWNLOAD_NOT_SUPPORTED`; the CMS creates no archive URL, presign request, browser buffer, or cached downloadable artifact.
- Artifact deletion re-fetches the selected record before admission. If eligibility changed, the operator receives a stale/protection explanation; server 409 stale/protected responses remain visible. Confirmation states that artifacts are permanently removed while backup history, deletion operation, and tombstone remain.
- Role editing consumes `subject_actions.Backup` and displays only `read`, `create`, `delete`, and `download` for Backup. Backup conditions are removed from the editable draft and the UI explains that Backup grants are installation-wide and unconditional.

## CMS files

- Authorization/navigation: `darshan-cms/src/lib/access.ts`, `darshan-cms/src/hooks/useAuthorization.ts`, `darshan-cms/src/components/auth/ProtectedRoute.tsx`, `darshan-cms/src/AuthenticatedAppShell.tsx`, `darshan-cms/src/components/layout/AppSidebar.tsx`, `darshan-cms/src/components/settings/AppSettingsBootstrap.tsx`
- Contracts/cache/hooks: `darshan-cms/src/api/types.ts`, `darshan-cms/src/api/endpoints.ts`, `darshan-cms/src/api/queryKeys.ts`, `darshan-cms/src/api/domains/settings.ts`, `darshan-cms/src/hooks/useSettingsApi.ts`
- UI/role metadata: `darshan-cms/src/pages/Settings.tsx`, `darshan-cms/src/components/settings/BackupsSection.tsx`, `darshan-cms/src/components/settings/RolesPermissionsTab.tsx`, `darshan-cms/src/lib/backupPresentation.ts`, `darshan-cms/src/lib/permissionMetadata.ts`
- Focused tests: `darshan-cms/src/lib/access.test.ts`, `darshan-cms/src/api/queryKeys.test.ts`, `darshan-cms/src/components/settings/backupHelpers.test.ts`, `darshan-cms/tests/settings-backups.e2e.spec.ts`

## Developer checks

| Check | Result |
| --- | --- |
| `npx tsc -b --pretty false` | PASS |
| Focused unit run (`access`, query keys, backup helpers) | PASS — 3 files, 16 tests in the final full run |
| `npm run test:unit` | PASS — 31 files, 159 tests |
| `npx playwright test tests/settings-backups.e2e.spec.ts` | PASS — Chromium mock-browser suite, 5 tests |
| `npx playwright test tests/settings-default-media.e2e.spec.ts` | PASS — Chromium mock-browser regression suite, 4 tests |
| `npm run build` | PASS — Vite production build and bundle budget; CMS entry 222.8 KiB / 70.3 KiB gzip |
| `git diff --check` | PASS |

Focused mock-browser coverage proves Backup-only navigation, absence of unrelated settings requests, independent create/delete/download controls, visible unsupported download, retained 202 deletion row and `PREPARED` operation, stale server rejection, empty and bounded error states, and denial of the surface when `read Backup` is absent.

The final backup-helper unit suite uses live `QueryObserver` instances with a concurrent authorization fetch to prove observer-safe redaction and late-success fencing across separate policy/history requests. It also uses live `MutationObserver` retries for two lost-response cases: one where deletion remains `PREPARED`, and one where the retry detail is already `SUCCEEDED` with a tombstone. Both replay the identical key; the latter receives the backend `DELETED` response. Separate assertions prove no preflight DELETE and no retry for stale/4xx cases.

Warnings observed but not introduced as failures: the repository's browser compatibility datasets are stale, and the Node unit environment reports redux-persist falling back to noop storage.

## Pending real-environment gates

- No live CMS/server stack or real operator account was used for this CMS packet. Mock-browser results must not be treated as actual deployed-app testing.
- Run a deployed real-browser matrix for canonical system `SUPER_ADMIN`, built-in `ADMIN`, a custom wildcard role, and explicit Backup-only read/create/delete/download combinations. Confirm current `/auth/me` rules and live 401/403 revocation behavior match the accepted backend policy.
- Exercise a real backup run through capture, publication read-back verification, expiry/protection, 202 deletion, worker progress, tombstone completion, and page refresh. Include restore-hold and stale-dialog races plus broker/process failure recovery.
- Confirm production unconfigured/unsupported reason codes against the deployment's actual repository/broker settings.
- Packet 7 remains responsible for an authenticated streaming download relay. Until then `BACKUP_DOWNLOAD_NOT_SUPPORTED` is intentional; repository mounts, raw paths, eager presigned URLs, and browser archive buffering remain prohibited.
