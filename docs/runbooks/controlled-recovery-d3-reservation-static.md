# D3 backup reservation: static review only

The reusable reservation provider is implemented; installed reservation, capture, broker and whole-run gates remain false. This packet authorizes no live command. The selectively enrolled live-seed gate remains true, but existing live admission and missing accepted seed/seal/capsule receipts still block progression. Source/data/capsule profile bytes remain unchanged.

The separate `tiny-d3.reservation-profile.json` fixes the accepted profiles, PostgreSQL application name, `pgboss.backup` queue, 10-second statement/1-second lock/30-second transaction bounds and development DDL. `loadInstalledD3BackupReservation()` verifies that profile then always rejects with `CONTROLLED_RECOVERY_D3_RESERVATION_NOT_ADMITTED`. `reserve-backup` and `reservation-status` are future fixed names, not installed CLI commands. Existing source CLI accepts neither. Do not invoke live commands to test this packet.

The foundation exposes a reusable reservation factory. Its prerequisite reader uses only read-only protected source state/data/layout/public age receipts and the real capsule status verifier, including signatures, inventory, data verification and retained ciphertext. Missing/pending/unsafe receipts block before admission, locks or SQL clients. No synthetic receipt or fake enqueue exists in installed composition. The session factory constructs only an explicit certificate-verified/pinned `pg.Pool` for retained PostgreSQL; it does not load ordinary app config, start jobs or create S3 clients.

One checked-out SQL transaction takes non-waiting site/operation advisory transaction locks, re-observes physical identity, the complete real ledger, SQL seed receipt and business seal, verifies/creates the exact control schema and invokes the same internal production request helper. A real, unstarted `PgBoss` instance creates/verifies the backup queue and sends its delivery through that checked-out transaction adapter. The immutable binding is inserted after the helper allocates its run ID and before commit. Binding, run, queue and delivery commit together. Initial coalescing onto an unbound foreign run is refused. Exact retries coalesce; no new run replaces a terminal, cancelled, superseded or expired running reservation.

The SQL binding is the durable reservation seam. This static provider does not append `BACKUP_RESERVED` to the retained source journal; installed stage progression and fixed command composition remain behind the disabled activation and future capture acceptance.

`darshan_d3_control.operation_backup_bindings` is outside the application migration ledger. Primary/unique keys, bounded JSON/digest constraints and immutable mutation/truncate triggers protect its single operation binding. It binds operation/site/repository, all accepted profiles, source intent/schema/SQL seed/seal/physical/business/configuration, retained public key/age receipt, signed encrypted capsule/policy/inventory and run ID. Transaction/status require the referenced real run and delivery. Application backup hard deletion remains disabled. Unknown control objects, owner/ACL/constraint/trigger/index drift and conflicting bindings fail closed.

Immutable-trigger verification includes null `WHEN` qualification, zero arguments and immediate/nondeferrable execution; a same-name conditional trigger is foreign, even when its function and enabled/type fields match.

The business seal excludes only the validated control schema and exact owned `backup` metadata: queue/bound delivery rows, deterministic partition/catalog and its FK enforcement triggers. Structural verification compares that partition to the retained fixture partition; every excluded delivery must name the immutable bound run. No backup schedule/subscription is allowed. All non-backup pg-boss rows/catalog, including seeded stale work, remain business-sealed. Binding physical/configuration/migration/business identities are rechecked. The ordinary production dump is unchanged. The future D3-only dump contract requires `--exclude-schema=darshan_d3_control`; no capture executor is admitted.

Read-only provider status uses a read-only SQL transaction: no mutation/advisory/controller lock, DDL, enqueue, repair, publication recovery or worker startup. Commit transport failure or uncertain session settlement reports `UNCERTAIN`; the caller's operation lock must remain retained. Do not retry uncertain mutation without independent read-only reconciliation and separate approval.

Static review command, from the backend directory:

```bash
NODE_OPTIONS=--max-old-space-size=1024 ./node_modules/.bin/vitest run --config vitest.unit.config.ts scripts/development/controlled-recovery-d3-reservation.unit.test.ts --pool=forks --poolOptions.forks.singleFork=true
```

The real PostgreSQL/pg-boss caller-owned transaction rollback case in `src/backups/coordination.integration.test.ts` is source-only and unrun in this no-live packet. A dedicated `_test` database is required before separate authorization. Fake transaction tests exercise real pg-boss generated plans, transaction ownership, rollback/conflict/lease/deadline/cancellation and catalog projection; they do not prove PostgreSQL catalog acceptance, real enqueue rollback or pg_dump output.

Remaining: independent review; disposable SQL catalog/transaction/dump acceptance; retained-source admission and seed/seal acceptance; separately reviewed live capsule; native worker age/broker authority; fixed capture/package/encryption/publication; restore/runtime/app/promotion/rollback. No live reservation command is available until prerequisites and separate activation are approved. Preserve all retained resources/private identities.
