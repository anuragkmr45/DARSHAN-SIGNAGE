# Controlled Recovery Activation Packet D2 — Tiny Local E2E Executor

Packet D2 is a fixed, development-only orchestration contract layered on the enrolled D1 host identities. It is not production recovery, split-host proof, RTO evidence or native-engine activation. Firefox remains metadata-only and must never be signalled. No D2 live stage has been executed.

## Current activation state

The sole activation is `/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/tiny-e2e-d2.activation.json`. It fixes the operation UUID/prefix, work/evidence roots, Docker names/volumes/network, exact D1 image identities, application/profile asset hashes, 32 MiB dataset ceiling, no public ports, retention-on-failure and exact-cleanup evidence. It is currently `enabled:false`; the installed live stage-effect driver is not enrolled. The run command therefore fails before any effect.

The executor re-runs D1 readiness before every effect stage, enforces the Packet C serial order, journals secret-free receipts, resumes only when live observation exactly matches the journal, requires source/original target hashes to remain identical, records duration/peak memory/host swap, retains evidence before cleanup, and accepts cleanup only with retained exact ID/label evidence.

## Commands

Readiness:

```bash
cd /home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server
npm run controlled-recovery:e2e:readiness
```

Run command, only after every checklist item below is complete and activation is separately approved/enabled:

```bash
cd /home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server
npm run controlled-recovery:e2e:run
```

No endpoints, paths, commands, Compose files or alternative confirmation may be supplied.

## Pre-run checklist

- [ ] D1 readiness is `READY` immediately before the maintenance window; RAM reserve, swap/pressure, disk/inodes, daemon/context/socket/images, artifacts and untouched Firefox all pass.
- [ ] The fixed D2 activation and dataset manifest hashes match; `enabled` remains false until final approval.
- [ ] A reviewed installed implementation exists for every typed D2 effect method; no mock/fixture adapter is accepted for the live run.
- [ ] Fixed Docker resources use the deterministic `darshan-d2-20261030` names, enrolled image IDs and exact memory/CPU/pid caps; no pulls/builds/public ports exist.
- [ ] Disposable work/evidence roots are protected and contain no production credentials/data; generated age private identity never enters reports.
- [ ] Source stack, Packet A/B/C adapters, real backup path and one controlled prepare interruption/resume are independently reviewed.
- [ ] Electron player and fixed headless browser fit their caps; otherwise the required gate fails rather than substituting a mock. Firefox remains untouched.
- [ ] Promotion approval, write freeze, previous pointers/targets and rollback observations are fixed and reviewed.
- [ ] Failure retention is understood. Cleanup is a separate final stage after evidence and requires exact retained IDs/labels; never prune or use `down -v`.
- [ ] Operator explicitly approves enabling this one activation, then invokes only the exact packaged command above.

Until the live effect driver and approval exist, Packet D2 is a static orchestration foundation and the run command must remain disabled.
