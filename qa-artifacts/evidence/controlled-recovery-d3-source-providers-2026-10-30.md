# D3 installed source providers — developer verification, 2026-10-30

Historical initial provider packet. The later [populated-status read-only correction](controlled-recovery-d3-source-status-readonly-correction-2026-10-30.md) fixes the initially shared mutable health/target observer wiring and supersedes the hashes/test count below. Activation flags are unchanged.

Status: bounded provider/live-prepare composition is implemented and developer checks passed. No Docker command, installed source preflight/prepare, application startup, host install or commit was performed by the implementation agent. No retained age identity, failed ciphertext or existing anonymous volume was changed/deleted. Live materialization/TLS/cgroup acceptance remains for root.

## Completed boundary and exact files

New files:
- `darshan-server/scripts/development/controlled-recovery-d3-source-installed.ts`: concrete installed factory, shared controller/source lock, D1 admission, read-only preflight/status and fixed preparation/stop composition.
- `darshan-server/scripts/controlled-recovery-d3-source.ts`: fixed CLI; sole commands preflight/prepare/status/stop; capture/resume fail before provider loading.
- `darshan-server/scripts/development/controlled-recovery-d3-source-installed.unit.test.ts`: 42 provider/CLI integration cases using fake Docker/probes and protected temporary journals.
- `docs/runbooks/controlled-recovery-d3-source-providers.md`: exact clean-environment commands and retained-resource/cleanup procedure.

Updated development modules: source-state (read-only journal view), source-layout (read-only verification view), source-profile (precise phase flags/commands), source-executor (bounded read-only readiness operations and one-shot effect-admission binding), source-services (shared pure ownership validation with exact current reserved-dispatch handling), d3-docker (absence observation without fabricated layout/config authority), d3-foundation and d3-activation. Source runtime tests add a real temporary-filesystem read-only commit-window regression. Updated package script, scripts/recovery-test tsconfigs, strict profile/schema, cascading D2/D3 activation/schema, runbook and QA status.

The concrete factory composes the verified foundation's ProtectedD3SourceLayout, FixedD3Docker/exact executor, DurableD3SourceState, ProtectedD3SourceVolumes/exact helper executor and ProtectedD3SourceHealth. The full-image MinIO capability record remains bound to its existing immutable digest. No replacement tool image or crypto authority was fabricated.

Phase flags are `providers_enabled:true`, `live_prepare_enabled:true`, `capture_enabled:false`, legacy `source_backup.enabled:false`, D2 `enabled:false` and `whole_run_enabled:false`. Full backup loading and recovery constructBoundary remain unavailable. Source commands create at most LAYOUT_READY/SERVICES_READY; schema/data/capsule/broker/capture stages remain closed.

## Admission and read-only behavior

Preflight/status do not create source directories, secrets, receipts or locks, recover publication links, or delete pending remnants. Read-only views reject unsafe publication windows for reviewed recovery; tests prove link counts and aliases remain unchanged. Preflight emits secret-free JSON with explicit next action, memory/swap/pressure evidence and retained-ID index; blocked reports mark ownership unverified. Journals alone never authorize resources.

Mutation uses a protected durable controller/source lock plus source command lock. Exact current reserved create intent may be re-admitted only under the owned operation lock, before that role exists; unknown/foreign/persisted ambiguous resources remain rejected. Every service mutation/helper checks the installed admission hook. Joined failure and cancellation preserve IDs before subsequent actions; uncertain settlement retains locks.

Admission re-observes exact empty-or-retained topology, foreign consumers (including stopped foreign volume consumers), subnet isolation, image/context/daemon/socket/config enrollment, capability evidence, unchanged D1 disk/inode/headroom/swap/pressure limits and Firefox identity. D1 itself is unchanged. Its adapter excludes only fully re-observed retained owned full container IDs from the foreign-running check; all unrelated running containers still fail. Missing pressure fails. No public ports, pulls/builds/prune/Compose/socket mounts/restart policies or ordinary application startup are admitted.

## Verification

The final single-fork run passed all 317 cases across 11 suites:

| Suite | Cases |
| --- | ---: |
| source installed providers/CLI | 42 |
| source runtime | 133 |
| source layout | 1 |
| source backup integration | 43 |
| source state | 14 |
| D3 execution | 14 |
| D4 tools | 8 |
| D1 readiness | 12 |
| D2 | 4 |
| D3 | 16 |
| D3 foundation | 30 |
| Total | 317 |

Command shape: `npx vitest run --config vitest.unit.config.ts <the eleven focused suite paths> --pool=forks --poolOptions.forks.singleFork=true`. All suites are under `scripts/development/`; basenames match the rows above and existing D1–D4 naming.

`npm run typecheck:scripts`, `npx tsc --noEmit -p tsconfig.recovery-tests.json`, focused ESLint with `--max-warnings=0`, `npm run build` and `git diff --check` passed. All 37 enrolled asset hashes match. Earlier iterations exposed one generic-error assertion mismatch, a test tuple-typing error, and a fake invalid-health test using the real 30-attempt clock; those tests were corrected without weakening executor errors, production parsing or runtime limits. The final full run above is clean.

New cases cover empty read-only preflight/status with no filesystem mutations; exact retained repeat preparation; authenticated status; mixed-stop retry; insufficient memory/swap/pressure/missing pressure; capability rejection; Firefox changes; image/context mismatch; foreign running/volume/subnet resources; partial/pending resources; controller concurrency; cancellation during init creation; missing provider/method wiring; provider failure without service-readiness receipt; reserved-intent re-admission and foreign race rejection; uncertainty lock retention; fixed CLI arguments and secret-free output. Real OpenSSL tests remain confined to temporary directories. No live source acceptance is inferred.

## Root execution and retained-resource procedure

Use the exact clean-environment preflight and prepare commands in [the runbook](../../docs/runbooks/controlled-recovery-d3-source-providers.md), as enrolled developer UID:GID 1000:1000 from `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`. The entrypoint is `/home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts` with exactly one final word `preflight`, `prepare`, `status` or `stop`.

Only preflight READY with source EMPTY or exact retained READY and nextAction prepare admits the next prepare command. Status performs real positive/negative health once service readiness is retained. Root still needs bounded live materialization, TLS, cgroup and exact settlement evidence before accepting this source phase.

Stop is limited to a complete exact nonforeign topology and joins the exact retained IDs, including mixed-state retries. It retains containers/network/volumes/keys/journals rather than deleting data. Partial/foreign/changed/uncertain state requires independent exact-ID inspection of protected receipts/cidfiles and Docker truth; never adopt/delete by prefix, never remove unattributed old volumes, and never take over stale locks by PID. No destructive cleanup CLI was installed.

Migrations/ledger, representative/PDF/object fixtures and seal, distinct signing/capsule, transactional operation-backup reservation, capture/package/encryption/publication settlement remain missing. Production/native recovery and restore/runtime/app/promotion/rollback remain frozen.

## Exact SHA-256 enrollment

```text
ab37b8838abbc49af2aa4e7a7e44ddf8288ee88271647b8cf0f72b2fb4b64dc8 darshan-server/scripts/development/controlled-recovery-d3-source-installed.ts
e11171085f47d122f240fd3f9d13dd83e5f446ef66aedba460dca955ef02745b darshan-server/scripts/controlled-recovery-d3-source.ts
8e9409250b0bbaf0b59f3774dd6a5b3526e577629785587e90c482b68837fb6c darshan-server/scripts/development/controlled-recovery-d3-source-installed.unit.test.ts
d43fe366b3fb373123a7caab7ac3c5953352b0bb2f2aeff36857751281740388 darshan-server/scripts/development/controlled-recovery-d3-source-state.ts
32111f6de957801c114835410d2f042087ccc704894baae8073be8a0804326de darshan-server/scripts/development/controlled-recovery-d3-source-layout.ts
cce8019ed46a0c5adc1e82bf211fef7010165ad09e681dcd9f2ce11eb8c988c8 darshan-server/scripts/development/controlled-recovery-d3-source-profile.ts
f961c2eb1c7966a57ba999bac6c2a24f8dbf0228f68963edab403f6a557669a4 darshan-server/scripts/development/controlled-recovery-d3-source-executor.ts
5261fc02440549426e0e16b39a4cbf5df5afa3279bdecfa115e96e6766b6049a darshan-server/scripts/development/controlled-recovery-d3-source-services.ts
c84a243401e166bc94341493a91ff12c96f9bbe78584358d12bc24240523f3be darshan-server/scripts/development/controlled-recovery-d3-docker.ts
478919a337d95940e48e9e09a8859ca88a51cd6c9ee63a99141b59d8e71d72af darshan-server/scripts/development/controlled-recovery-d3-foundation.ts
e796b5eae7bab61941fe46c6f339fe84636b1a3cae5c2725e799d4c16b37cf36 darshan-server/scripts/development/controlled-recovery-d3-activation.ts
1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632 deploy/development/controlled-recovery/tiny-d3.runtime-profile.json
65694f38e2b13a291bf6ac9868bde2c61d22f42fb9bd90f355f214dd8c333e7e deploy/development/controlled-recovery/tiny-d3.runtime-profile.schema.json
e1fee72bb27f95a6a864fa6a29f3cdab910b3193becba7964c3a5f08f5e357e1 deploy/development/controlled-recovery/tiny-e2e-d2.activation.json
1bf71126958af2fc5b04973981f1b8b2db6fa8d911781b540102806616b17bf0 deploy/development/controlled-recovery/tiny-e2e-d3.activation.json
10637d3539f49652c6abc53d82aa75f665bb01f2781311e426a979ddac67ced8 deploy/development/controlled-recovery/tiny-e2e-d3.schema.json
```

