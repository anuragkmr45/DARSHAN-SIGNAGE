# Performance, Load And Resilience Plan

This document designs future tests. None were executed. Run only on isolated hardware and data that represent the five VM roles and actual player models. Obtain BQ-017 workload/SLO inputs, BQ-018 RPO/RTO and BQ-019 network boundary before assigning release pass/fail limits. The sample 500-player capacity template is not an approved target.

## Workload Model

Record these input dimensions before execution: connected/online players; concurrent CMS users; simultaneous uploads and largest permitted files; total source and processed object bytes; worker conversion/capture mix; webpage slots; message and notification rate; snapshot/poll/heartbeat/screenshot frequency; backup size/cadence; emergency and normal publish fanout. Use approved `CAPACITY_EVIDENCE_FILE` and the deployed role resource policy for the exact site/release. The previous VM RAM/disk figures are topology inputs, not measured capacity.

| Scenario | Load shape and actions | Measures | Pass rule | Case |
| --- | --- | --- | --- | --- |
| Baseline | Representative steady mix of CMS reads/writes, active screens, uploads and scheduled content; warm and cold caches separately. | API p50/p95/p99, errors, end-to-end display delay, CPU/RAM/disk, DB connections/latency, queue lag, S3 and Valkey latency | BQ-017 approved SLO, otherwise `TBD - NEEDS_BUSINESS_CONFIRMATION` | `PERF-01` |
| Peak | Ramp to approved peak fleet/users and maximum normal conversion/backup overlap. | Same plus worker backlog, scratch free space, Docker image/volume growth and rejected operations | Meet approved peak target without data corruption | `PERF-01`, `PERF-02` |
| Stress/breakpoint | Increase one dimension at a time beyond peak: player polls, upload concurrency, Chromium/FFmpeg work, backup scratch. Stop before harming shared infrastructure. | Saturation point, reject mode, OOM/restarts, recovery time, duplicate jobs/objects | Errors remain explicit; after removal of overload, data converges; numeric threshold TBD | `PERF-02`, `REL-02` |
| Spike | Reconnect player cohort and trigger one high-severity emergency/publish while realtime and fallback are monitored. | Command queue, reconnect rate, REST/WSS errors, first/last screen display and jitter | Meets BQ-017 emergency propagation target; no wrong winner or duplicate command | `PERF-03`, `CONC-03`, `REL-01` |
| Soak | Hold approved normal/peak mix over a representative retention and backup cycle, including controlled outages. | Memory/disk trend, spool discard, unfinished jobs, archive growth, backup success/retention and DB table counts | No unexplained growth or lost required evidence; accepted loss and duration TBD BQ-013/015 | `PERF-04`, `BKP-01` |
| Multi-PDF page rendering | Cycle layouts containing several selected-page PDFs across approved resolutions/DPI while repeatedly resizing/changing snapshots. Include long PDFs and page-only changes. | Player/CMS renderer memory, render latency, dropped/blank frames, raster-budget use, crash/recovery and PoP page parity | No unbounded memory growth or stale/wrong page; numeric latency threshold follows BQ-017 | `PERF-05`, `PLAYER-10`, `COMP-04` |

Ramp steps, stage duration, active test data volume and safe stop limits must be recorded in the run sheet using approved environment capacity. Do not infer success from response time alone: compare database rows, object hashes, player display state and PoP loss counters after load. Abort if the isolated environment approaches its agreed disk/memory guardrail, services become unavailable beyond the approved window, or data integrity may be harmed.

For document-page rollout, overlap large-PDF inspection/Office conversion with multiple CMS PDF previews and player rendering, interrupt and resume the cursor backfill, cancel renders through rapid resize/page changes, and replay page-aware PoP after an offline interval. Record worker backlog and scratch growth; numeric workload and latency targets remain TBD under BQ-017.

## Reliability And Resilience

| Fault | Expected observable behavior and recovery checkpoint | Case |
| --- | --- | --- |
| Valkey or Socket.IO unavailable | DB/REST authority remains; player polling eventually fetches current snapshot/commands; no false ACK or stale publish after reconnect. Time limit BQ-017. | `REL-01`, `PLAYER-02`, `OBS-01` |
| API unreachable to player | Production player locks within confirmed two-minute outage rule, stops emergency, removes media cache; identity and already-spooled PoP stay available. Recovery requires fresh backend validation and content fetch. | `PLAYER-03..04`, `PLAYER-07` |
| PostgreSQL unavailable/slow | Readiness fails; writes do not claim committed schedule/emergency; retry after recovery preserves transaction/outbox invariants. | `OBS-01`, `DATA-02`, `REL-02` |
| MinIO/S3 timeout, invalid object or full backend scratch | Upload/processing/backup produce explicit failed/retriable state; no READY without object; incomplete backup not approved. | `FILE-02..03`, `BKP-01`, `REL-02` |
| Worker crash/restart | Queued work resumes or fails visibly; no duplicate media promotion, PoP row or backup claim. Worker heartbeat/readiness reflect outage. | `REL-02`, `OBS-01`, `DATA-04` |
| PDF inspection/conversion crash | Document never becomes READY without a positive final-PDF count; retry converges once or fails with a stable reason; backfill resumes after the last cursor batch without changing selected pages. | `FILE-03`, `FILE-06`, `DATA-05`, `REL-02` |
| Player restart, corrupt cache or wrong display | Identity/security rules applied before playback; cache revalidated; no fabricated PoP across crash; fallback display selected explicitly. | `PLAYER-01`, `PLAYER-04..05`, `DATA-04` |
| Migration failure/interrupted installer | Deployment record reflects step/failure, API/worker not falsely ready, clean recovery rehearsal proves restored data; old image not started blindly on new schema. | `DEP-03`, `DEP-07`, `BKP-02..03` |
| Certificate expiry/untrusted CA | HTTPS/WSS/DB/Valkey/S3 client rejects untrusted peer; health and metrics identify failed dependency without secret leakage. | `DEP-06`, `SEC-02`, `OBS-02` |

## Recovery Measures

For backup/restore and role update, record start/end timestamps, last durable transaction, object counts/hashes, last displayed schedule, accepted versus persisted PoP and queue backlog. Calculate observed data loss and recovery time from these records. Compare with BQ-018 RPO/RTO only after a site owner supplies them. Preserve the distinction between application rollback and database/object restore; the migration code has no automatic reverse schema path.
