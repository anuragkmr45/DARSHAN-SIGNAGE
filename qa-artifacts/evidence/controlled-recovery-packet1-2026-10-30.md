# Controlled recovery Packet 1 — developer evidence

Date: 2026-10-30 (Asia/Kolkata)

Scope: source-level and scripted-adapter Packet 1 only. No Docker daemon, live service, network, SSH, real key, credential, decrypt, import, restore, production target, promotion, rollback, migration, or native-engine activation was used.

## Implemented boundary

- Separate deployment command: `darshan-server/scripts/controlled-docker-recovery.ts`.
- Isolated modules: `darshan-server/src/recovery/controlled-docker/`.
- Terminal Packet 1 state: `DATA_VALIDATED` only.
- Commands: `prepare`, `resume`, `status`, `report`; no promote/rollback/hold-release/delete command.
- Frozen native worker remains `UnavailableRecoveryTargetEngine`; wire-v4 backend retains its tested `ENOTSUP` path.
- Release/schema registry remains `release-01` / `0055_backup_deletion_idempotency_bindings.sql`; no migration added.

## Final developer results

| Check | Result |
|---|---|
| Packet 1 + direct repository-source/hold/retention/compatibility/native-unavailable predecessors | PASS — 7 files, 186 tests |
| Packet 1 focused suite alone | PASS — 44 tests |
| Crash boundary matrix | PASS — before/after intent/result for all seven major phases (28 parameterized cases), plus ambiguous adapter effect recovery |
| Recovery test typecheck (`tsconfig.recovery-tests.json`) | PASS |
| Script/runtime typecheck (`tsconfig.scripts.json`) | PASS |
| Production CLI typecheck (`tsconfig.production-cli.json`) | PASS |
| Touched ESLint with zero warnings | PASS |
| Backend `npm run build` | PASS |
| Native wire-v4/ENOTSUP static contract | PASS — 1 Node test |
| Runtime package exposes `production:controlled-recovery` | PASS |

The 44 Packet 1 fixtures cover strict profile/CLI contracts; wrong key/site/release/source; exact hold truth; durable site concurrency and hash chaining; malicious traversal/link/sparse/duplicate/oversize archives; V2 staging inventory; separate exact configuration inventory; BigInt capacity beyond JavaScript safe integers; target collisions/foreign labels/mounts/configuration; fixed psql arguments and owned reset; interrupted object batches, GET corruption, extra objects, and final full GET; all required reference classes, missing references, exclusion summaries, table baseline/delta reconciliation; report gating/redaction; and native/shell/promotion/rollback isolation.

During focused testing, two defects were found and fixed:

1. Target verification originally keyed resources only by name; Docker resource namespaces can share a name. Verification now keys by resource kind plus name and additionally checks the fixed container configuration digest.
2. Resume originally advanced past a phase whose last durable event was a pending intent. Pending intent now takes precedence over the apparent last phase, including pending `DATA_VALIDATED`, so resume reobserves/retries that exact phase.

The installed asset design was also corrected before handoff to avoid a circular profile↔asset-manifest digest. The root-owned profile pins the root-owned asset manifest digest; the manifest pins every fixed asset digest.

## Explicit residual gates

- Disposable local Docker E2E with actual age artifacts, PostgreSQL, MinIO, API, worker, CMS and one player.
- Actual login/permissions, representative image/video/PDF/webpage playback, layouts/presentations, schedules/defaults, emergency, chat attachments, Proof-of-Play and screenshots.
- Installed profile/adapter activation and release engineering review of actual images, tools, mounts, configuration and resource headroom.
- Packet 2 or later: explicit promotion, rollback, session/pairing/command/notification reconciliation and old-target lifecycle.
- Full 429-test recovery regression is intentionally deferred under the confirmed fast-release cadence until the complete controlled flow is stable.
- QA/release environment: production-sized restore, four-hour RTO/two-hour maintenance evidence, load/stress/soak, multi-player/browser, two-node/Valkey, full topology, Windows/physical display, long video/PDF memory, failover and rollback rehearsal.

None of these residual gates is reported as developer-passed.

## Final independent-review correction addendum

The final complete-flow review found that Packet 1 admission and journaling were not yet safe for the current release. The corrected implementation keeps the original release-01/0055 profile immutable and adds a separate release-03/0057 profile/path. Current sources are admitted directly; enrolled older sources require an explicit passing reviewed compatibility decision; unsupported sources fail closed.

The journal now holds a durable per-operation execution lock across observation, intent, effect, re-observation and result. A deterministic parallel-resume fixture proves one destructive dispatch and stable `CONTROLLED_RECOVERY_OPERATION_BUSY` for the loser. Under that lock, only a provably incomplete trailing JSON frame is truncated; complete bad hashes and interior corruption remain fatal. Producer-shaped `./`, `.` and trailing-slash directory records are normalized while traversal, special entries and duplicate normalized paths remain rejected.

Corrected focused Packet 1/2/security/alert verification passed as part of **6 files / 76 tests**; the behavior-change full recovery regression passed **28 files / 485 tests**. The earlier “full regression deferred” note is superseded by this addendum. These are developer fixtures only; Docker/live recovery gates remain pending.

