# Controlled Docker recovery — Packet 1

Packet 1 restores one exact trusted V2 backup into fresh PostgreSQL and MinIO targets and stops at `DATA_VALIDATED`. It does not promote, roll back, release the restore hold, delete targets, or activate the frozen native engine. Production native recovery remains `Unavailable` / `ENOTSUP`.

## Installation gate

This source packet does not install or activate a deployment adapter. Release engineering must review and install a profile at `/etc/darshan/controlled-recovery/profile.json`, its hash-bound asset manifest, pinned tools/images/configuration, a dedicated Docker context, protected journal/workspace directories, and the deployment adapter. The example contains placeholders and must never be activated directly. The recovery key stays outside the VMs until the operator mounts it below the profile's fixed `recovery_key_root`.

Before activation, verify the profile against `deploy/production/controlled-recovery/profile.schema.json`, bind the root-owned `assets.json` digest in the profile, verify every root-owned asset digest, and inspect disk, inode, and memory headroom. Do not pass a Docker context, compose file, executable, mount, endpoint, target name, image, or import option on the command line.

## Operator flow

1. Record the approved site, release `release-01`, exact backup run UUID, signed manifest SHA-256, fixed operation UUID, and mounted recovery-key file.
2. Run `production:controlled-recovery -- prepare` with only `--operation-id`, `--backup-run-id`, `--manifest-sha256`, `--site-id`, `--approved-release-id release-01`, and `--recovery-key-file`.
3. If interrupted, use the identical inputs with `resume`. Resume reopens the external hash-chained journal, rechecks exact source/hold truth, and reobserves target state before any effect. `OPERATOR_REVIEW` means truth is ambiguous; retain the hold, journal, workspace, and targets.
4. Use `status --operation-id UUID`. A successful Packet 1 terminal state is exactly `DATA_VALIDATED`.
5. Use `report --operation-id UUID` only after validation. Report v3 contains identities, aggregate counts/digests, timings, and stable codes; it must not contain keys, credentials, raw SQL/configuration, object keys, or user content.

Never run `docker compose down -v`, prune, reuse a volume, or remove a target by name. Names are not ownership evidence. Only an exact operation/generation label-and-ID match may be reset, and Packet 1 may reset only its owned PostgreSQL target after an ambiguous/failed import. Source holds and all original/recovery targets are intentionally retained for later promotion/rollback packets.

## Validation scope and evidence

Preflight must finish before target creation: repository/mount/site identity, signed manifest/policy, ciphertext sizes/hashes, key-ID-to-recipient proof, release/schema compatibility, fixed tools/images/configuration, protected workspace, target disk, images, preserved originals, PostgreSQL data/index/WAL/import, MinIO objects, inodes, memory, and headroom.

Artifact extraction rejects traversal, links, devices, FIFOs, sparse files, duplicate normalized paths, unexpected components, and size/count limits. It reconstructs the brokered V2 `database/` and `objects/` tree and compares the sealed staging digest; the configuration capsule inventory is validated separately.

Database import is pinned to `psql -X --set=ON_ERROR_STOP=1 --single-transaction` with no ambient options. Object resume GETs and hashes bytes before skipping and finishes with exact-set enumeration plus full GET size/hash verification. Data validation covers `storage_objects`, media, thumbnails, PDFs, fallback/default media, chat, screenshots, Proof-of-Play, heartbeat/log objects, and embedded layout/presentation/schedule/default/emergency references. Staging, recursive archives, and transient exclusions require explicit zero-or-more reconciliation. Post-import table baselines and bounded reconciliation deltas are evidence; Packet 1 does not invent source expected counts absent from the manifest.

## Deferred gates

The disposable Docker E2E, actual API/worker/CMS/player validation, promotion, rollback, production activation, production-sized recovery, four-hour RTO/two-hour maintenance evidence, and full QA topology/load/soak/platform checks remain pending. Run the complete 429-test recovery regression only when the entire controlled flow is stable, per the fast-release cadence.

## Activation review corrections

The installed adapter must treat Docker inspection as four separate fixed observations: enrolled local context/socket, daemon identity, immutable images, and the exact resource set. An empty resource result is valid only when every enrolled network, volume and container is explicitly absent; any partial or foreign set is an operator-review failure. If all exact owned resources already exist after an interrupted create, record their observed digest and continue without recreating them.

The database archive contract is one file named `darshan_postgres_<YYYYMMDD>_<HHMMSS>.sql`. Before validation or resume, load the immutable external `DATABASE_RESTORED` receipt and compare current target counts to that baseline; current counts are never a replacement baseline. Final object validation enumerates the exact set and then GET-streams, sizes and hashes every object. Cancellation must close the archive iterator and terminate/join the pinned decrypt subprocess before its authority is released.

Source binding and prior-deployment snapshot publication are first-writer-wins and immutable. Exact replay is permitted; a different source, binding, receipt or protected pointer/overlay byte sequence is a conflict. Promotion retries reuse the first protected snapshot. Acceptance and rollback keep the fixed `SITE → OPERATION → DEPLOYMENT_ROLE → PROMOTION` locks through reobservation, authorization, effects and state transition. These requirements have static/injected developer evidence only; do not activate them until the signed installed assets and disposable live gates in the release checklist pass.

