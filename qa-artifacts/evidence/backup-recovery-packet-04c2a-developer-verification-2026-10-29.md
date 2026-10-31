# Backup and recovery Packet 04C2A backend developer verification — 2026-10-29

## Implemented backend surface

- Added the dedicated global `Backup` RBAC subject and independent `read`, `create`, `delete`, and `download` actions. Only canonical `is_system=true` `SUPER_ADMIN` has implicit authority; built-in ADMIN/DEPARTMENT/OPERATOR and custom/inherited wildcard grants remain denied. Explicit unconditional subject grants, including inherited grants, work; conditional and unsupported Backup grants are rejected/ignored fail-closed.
- Backup settings reads, history, detail and operation reads use `read Backup`; run-now uses `create Backup`; artifact deletion uses `delete Backup`; download uses `download Backup`. Backup settings update remains `update OrgSettings`, including deployment-managed production schedule enforcement. Generic settings list/upsert cannot expose or mutate the backup section as a bypass.
- Added safe history/detail/operation DTOs with bounded keyset paging, independent health, sanitized artifact metadata and decimal string sizes. Responses contain no database row spreads, storage object IDs, buckets/object keys, repository paths, mount paths, presigned URLs, or archive bytes.
- Added durable idempotent manual-deletion admission on the existing retention lifecycle. It uses database-clock policy recomputation under the fresh session/user/role transaction and row locks, persists actor/action/idempotency metadata, creates `PREPARED`/`DELETE_REQUESTED`, retains all history, and returns 202 with `Location`/`Retry-After`. Duplicate unresolved requests reuse the operation; completed deletion returns the tombstone.
- Manual retention deliveries load only the requested run. Queue delivery failure does not roll back admitted work; recurring retention reconciliation can resume it.
- Disabled the legacy hard-delete and eager-presign helpers. Download authorization is live, but the endpoint and descriptors return stable `BACKUP_DOWNLOAD_NOT_SUPPORTED` / `BACKUP_STREAMING_RELAY_NOT_IMPLEMENTED` until Packet 7.
- Added migration `0054_backup_manual_deletion_admission.sql` for requester/action/idempotency metadata and binding.
- Live-route review correction: raw `execute` timestamps are normalized from driver strings at every DTO and policy boundary. Retention evidence/database clocks fail closed when invalid. Keyset cursors carry the lossless PostgreSQL `timestamptz::text` value so microseconds are not truncated, and cursor UUIDs require canonical RFC 4122 shape before SQL casting.
- Public DTOs no longer expose raw execution or operation error messages. Error codes are restricted to stable uppercase machine-code form; malformed values collapse to `BACKUP_ERROR_UNAVAILABLE`.
- Added migration `0055_backup_deletion_idempotency_bindings.sql`. It supports multiple actor/action keys for one coalesced operation, backfills any 0054 key, and resolves concurrent key races through a unique binding plus deterministic conflict lookup rather than leaking a database error.
- Replaced the obsolete hard-delete/ADMIN/presign route suite with Packet 4C2A RBAC, run-now, safe history, durable 202 admission, coalesced-key binding, retained history, tombstone replay, and unsupported-download coverage.

## Developer checks

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| Focused Packet 4C2A/RBAC/retention unit tests | PASS — 7 files, 76 tests in the broad focused run; final post-hardening run 5 files, 53 tests |
| `npm run build` | PASS |
| `npm run build:production` | PASS |
| API catalog JSON parse | PASS |
| `git diff --check` | PASS |
| Focused changed-file ESLint | New Packet 4C2A service/test/schema files pass; existing touched shared files retain pre-existing `no-explicit-any` warnings. Removed the only new lint error. |
| Disposable PostgreSQL route/migration/coordination suites | PASS — PostgreSQL 15, dedicated `darshan_capture_test`, migration count 57, full gate 3 files / 19 tests; added cursor regression route gate 7/7 |

Post-review focused result: `npx tsc --noEmit` PASS; 5 focused files / 56 tests PASS; focused strict ESLint PASS; normal and production builds PASS; `git diff --check` PASS.

Primary live-database command:

```text
TEST_DATABASE_URL=postgresql://postgres:***@127.0.0.1:55432/darshan_capture_test \
  npm run test:integration -- \
  src/routes/settings-backups.test.ts \
  src/backups/retention-schema.integration.test.ts \
  src/backups/coordination.integration.test.ts
```

Observed result: all 19 tests passed. The first execution exposed only a teardown-order defect: the route test removed `maintenance_site_state` before its test-created `maintenance_operations` children. Cleanup was reordered, and the unchanged application scenarios then passed on the second execution. A final exact PostgreSQL regression inserted two rows with the same `2099-01-01 00:00:00.123456+00` timestamp, paginated them one row at a time, and proved that the second row was not skipped; the expanded route suite passed 7/7. Runtime checks covered denial for ADMIN and wildcard roles, explicit Backup grants, conditional-grant rejection, run creation, durable 202 deletion and replay, key binding, retained history/tombstone behavior, stable unsupported download, migration 0055, and backup coordination.

## Remaining gates

- CMS integration remains out of this backend-only packet.
- Broker/process fault injection, cross-process simultaneous DELETE admission, and permission revocation during an already-open CMS dialog remain later end-to-end gates; the durable database behavior and current-authorization route boundary are covered here.
- Packet 7 must supply the authenticated streaming relay before any backup can be downloaded; repository mounts, raw paths, eager presigning, and archive buffering remain prohibited.
