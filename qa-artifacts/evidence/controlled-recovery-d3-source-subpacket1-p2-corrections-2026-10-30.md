# D3 source subpacket 1 — independent-review P2 corrections

The independent review found three real gaps in the initial static source implementation: it checked network consumers but missed foreign volume users on another network; cancellation during create could flow into start before being checked; and a failed middle stop left a mixed running/stopped state that could not retry. All three are corrected within the source subpacket. Production/native boundaries, desired resource caps, source profile and activation gates remain unchanged. No Docker, source/application service, credential/TLS/key, database, backup or private-state effect was run; no package was installed and no commit was made.

The source inventory now lists all containers with `--all`, inspects every listed ID and validates the complete returned ID set. It checks source named-volume consumers and bind consumers of the source volume data paths, including read-only mounts, stopped containers and unrelated names/networks. The service layer accepts only the exact retained, nonretired owned container IDs as consumers. Foreign/malformed/changed inspection remains fail-closed before effects.

Create/start now carry the same `AbortSignal` through the fixed Docker execution contract. A successful create racing cancellation is settled by exact identity inspection and durable ID recording, then cancellation is checked before start or any next mutation. Uncertain failed creation retains its pending intent. No cancellation path claims cleanup or loses the returned verified identity by starting another stage.

The source observation exposes complete topology independently from READY/STOPPED/MIXED running state. `stop` accepts complete, exact, nonforeign MIXED topology, stops only remaining running service IDs and joins all retained service IDs, including those already stopped by a previous attempt. Missing/pending/foreign/changed topology is still refused. A stop receipt is written only after final STOPPED observation. Status reports the incomplete stop with a fixed `stop` continuation and makes no successful backup claim.

New deterministic cases cover each of PostgreSQL/MinIO/Valkey source volumes with foreign running and stopped containers on another network, a stopped read-only bind consumer, cancellation during all eight network/volume/init/runtime create boundaries, signal forwarding through all create/start calls, and a failure on the middle stop followed by successful exact-ID retry. The real protected journal and fake Docker API are used; these are not live Docker/probe results.

Focused source tests passed **57/57** (43 integration and 14 state cases) in **25.47 seconds**. Direct D1–D4/foundation/executor predecessor suites passed **84/84** across six files in **15.24 seconds**. These are **141 distinct cases across eight files**, all run single-fork. Recovery-tests typecheck, scripts typecheck, server compilation build, focused zero-warning lint and final `git diff --check` passed. No additional live acceptance is implied.

Current SHA-256:

| File | SHA-256 |
|---|---|
| `controlled-recovery-d3-docker.ts` | `37300ac2a7e044d08acdbc3c7143c45b4103b2eed766e4c84618e4208bcd6cd8` |
| `controlled-recovery-d3-source-services.ts` | `2243c2e30cc847f91c8228bfb200b19699fe3d373ab77feb01eca3f9a2b9e0f0` |
| `controlled-recovery-d3-source-backup.ts` | `e09d8d7b010f7cb49428adc36f885e7636816141d90173bfa5e9a5ceee2b828f` |
| D3 activation | `8a9145bd0300857280a3b813d8c4fd155abfd720e4cbe6a280e7d405110f6636` |
| D2 activation, unchanged | `fd9ccffa3cca4512479400cc8257e58d1ed90f12069b4bf7b8483cec88a558b9` |
| runtime profile, unchanged | `bb25b878973049872d48d0358c6fef146c28b5e4122bde1842cd46840d1aa0aa` |
| strict runtime schema, unchanged | `2e93beae0ecaf591755e8678cc96202788c635542644540d50b3bb8c9603fd3c` |

Source activation and whole-run effects remain disabled/unavailable. Concrete layout/TLS, volume materialization, source executor/probes, migration/seed/capsule/broker/capture and settlement providers remain pending exactly as in the source subpacket runbook. These fixes do not close live source/backup, application, restore, promotion/rollback, topology/platform, production/native or RTO gates.
