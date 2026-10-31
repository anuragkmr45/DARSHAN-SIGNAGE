# D3 live-prepare capability correction and pending-create recovery — 2026-10-31

The later [common runtime materialization-authority correction](controlled-recovery-d3-ready-materialization-binding-2026-10-31.md) makes the binding/file-evidence check mandatory on complete READY observation as well as partial runtime continuation, and supersedes the hashes/test count below. The reviewed pending-init retry and activation flags are unchanged.

Status: bounded static correction and developer verification passed. No Docker, installed CLI, host install, commit, retained-key change, live-container/volume/network change or cleanup was performed by the implementation agent. The supplied live resources remain untouched.

## Live facts supplied by root

Docker 29 returned canonical prefixed CapAdd names for the enrolled PG-init plan: CAP_CHOWN, CAP_DAC_OVERRIDE, CAP_FOWNER, CAP_SETGID, CAP_SETUID. The former parser rejected that spelling. Network and three named volumes are durably recorded; PG-init has a durable intent and protected cidfile but no created receipt. Root supplied full ID `68e31e2748c50274492e131ae8f01af768aad9329c3c0bae1084291239ffdda9`, created/running=false/exit=0, with exact enrolled image, configuration, labels, argv, mounts and caps. This record repeats supplied facts; no independent live observation was performed here.

## Correction and safe retry contract

Observed capabilities may use uppercase planned names or one canonical CAP_ prefix. The normalized set must equal the exact planned set. Duplicates (including aliases), unknown/missing/extra capabilities, repeated prefixes and lowercase/mixed-case ambiguity fail. Normalization preserves resource identity hashes.

Only explicit prepare, under the shared controller lock and source command lock, may reconcile one pending intent at the next position of the exact retained ordered resource prefix. It loads the canonical bound intent, reconstructs fixed configuration, inspects the exact uniquely named resource through the strict parser, checks every existing retained identity and foreign consumer, reruns admission and repeats inspection before publication. Containers require the protected full-ID cidfile to equal the observed full ID, created/unstarted Docker state with zero PID/restarts/start/finish times and false running/dead/restarting/OOM flags, plus no durable start evidence. Network/volume recovery uses the exact intent/config/labels/full identity; name alone is never accepted.

Canonical immutable reconciliation and created receipts precede start. Start intent is durable before each start dispatch. Cancellation immediately after reconciliation retains the created ID and dispatches no start; an explicit retry can continue that exact unstarted prefix without recreating it. Previously started stopped/exited containers are not automatically restarted. Runtime-prefix continuation requires a materialization binding published only after the protected materializer succeeds; missing/mismatched binding blocks. Reconciliation, start and materialization metadata remain protected, bound to operation/site/repository/profile and validated on reload. They are not SQL, source-seal or backup-success receipts.

Read-only preflight/status retain their previous strict behavior: any pending role is blocked, without metadata repair or lock/publication effects. The reviewed explicit pending retry is an exception to the initial EMPTY/READY preflight rule, not a bypass of internal admission.

## Exact files

Code: `controlled-recovery-d3-docker.ts`, `controlled-recovery-d3-source-state.ts`, `controlled-recovery-d3-source-services.ts`, `controlled-recovery-d3-source-backup.ts`, `controlled-recovery-d3-source-installed.ts`, all under `darshan-server/scripts/development/`. Tests/support: `controlled-recovery-d3-source.test-support.ts` and `controlled-recovery-d3-source-installed.unit.test.ts`. D3 activation asset hashes were refreshed; runtime profile, D2 activation, images/tools/keys and flags are unchanged. Runbook/QA status were updated.

## Verification

The final single-fork run passed **365/365 cases across 11 suites**:

| Suite | Cases |
| --- | ---: |
| installed providers/CLI/reconciliation | 90 |
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
| Total | 365 |

All used `--pool=forks --poolOptions.forks.singleFork=true`. Both typechecks (`npm run typecheck:scripts`, `npx tsc --noEmit -p tsconfig.recovery-tests.json`), focused ESLint with `--max-warnings=0`, `npm run build` and `git diff --check` passed. All 37 asset hashes match.

New regressions cover the exact supplied PG-init ID with Docker 29 caps; every capability ambiguity; absent/mismatched/unsafe cidfile; running/previously-started state; altered image/config/argv/env/mount/caps; foreign name/consumer; multiple pending roles; start evidence; exact pending network and each volume success/conflict; runtime-container continuation with materialization binding; missing binding; ID/start receipt ordering; exactly-once continuation; cancellation after reconcile before start; and unchanged blocked read-only inventory. Docker/network transports are fakes; real temporary crypto/layout tests retain their existing isolation.

## Exact root retry and expected result

From `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`, as enrolled developer UID:GID 1000:1000:

```sh
env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts prepare
```

The expected first reconciliation is PG-init's exact created receipt and reconciliation receipt, followed by one start of the retained ID. If all subsequent real initialization/materialization/TLS checks succeed, JSON reports SOURCE_SERVICES_PREPARED, stage SERVICES_READY, reconciledRoles [postgres-init], nextAction status and captureEnabled/wholeRunEnabled false. No live success is claimed by this static record. Any further real failure must retain evidence and block rather than invent readiness.

Provider/live-prepare flags remain true; capture, legacy source_backup.enabled, D2 enabled and whole_run remain false. Full schema/data/capsule/broker/capture, production/native recovery and restore/runtime/app/promotion/rollback stay frozen. No stale lock takeover, by-name adoption, image pull/build, broad permission change or destructive cleanup is added.

## Final SHA-256

```text
5892fd727520e8862bfeea79f78aed3f40c84473ca2e93ff4b2f686b7fceda40 darshan-server/scripts/development/controlled-recovery-d3-docker.ts
c85dfb8e97a08db129ca66392e6c03570e45bb0d33fffedb868070c7613d0446 darshan-server/scripts/development/controlled-recovery-d3-source-state.ts
1103ffc5bea41db6f1b8a2df6d9ab0be4510fc49738faa086ba298c72bb62c0e darshan-server/scripts/development/controlled-recovery-d3-source-services.ts
f5ee61f8d631e175d80a2f2e59f2c372dac1756c9c63a87cd0e5a00030bfd9fa darshan-server/scripts/development/controlled-recovery-d3-source-backup.ts
cd52e76f3cc5f19d56cf79afe51362c5665e5e819c72bc713d17103c06dda094 darshan-server/scripts/development/controlled-recovery-d3-source-installed.ts
03bfa10d5ac015aaa6736aea2700391d650cd742832e62b7bb55bcc4f980c189 darshan-server/scripts/development/controlled-recovery-d3-source.test-support.ts
2293b3204bee628395dac0d531d615e4c55b4a836a91fb9cc23b2297682df3f2 darshan-server/scripts/development/controlled-recovery-d3-source-installed.unit.test.ts
25fb32f33c460afcbf7c7ed536b65e9a33ed47cd3a6295739ce3a72077d92f6d deploy/development/controlled-recovery/tiny-e2e-d3.activation.json
1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632 deploy/development/controlled-recovery/tiny-d3.runtime-profile.json
e1fee72bb27f95a6a864fa6a29f3cdab910b3193becba7964c3a5f08f5e357e1 deploy/development/controlled-recovery/tiny-e2e-d2.activation.json
```

