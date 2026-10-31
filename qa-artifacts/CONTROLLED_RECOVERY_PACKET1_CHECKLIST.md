# Controlled recovery Packet 1 QA checklist

Status: developer contract fixtures implemented; real Docker E2E and release-environment evidence pending.

| Area | Required evidence | Current status |
|---|---|---|
| Fixed profile and CLI | Installed schema/assets hash-bound; no caller Docker/target controls; only prepare/resume/status/report | Developer fixture passed; installation pending |
| Source and hold | Exact trusted V2 source selected and rechecked every phase; active hold never released | Scripted fixture passed; real broker rehearsal pending |
| Journal/concurrency | One durable active operation/site; hash chain; fsynced intent/result; crash-before/after convergence; ambiguous truth retained | Developer fixture passed |
| Preflight | Wrong key/site/release/source/config/image/capacity fail before targets; all capacity categories use integer bytes | Developer fixtures partially passed; installed assets and resource measurement pending |
| Artifacts | Ciphertext verified; safe bounded extraction; V2 staging digest; separate configuration inventory | Developer malicious-entry fixtures passed; real age/tar artifact pending |
| Targets | Fresh labelled volumes/containers/private network; exact labels/IDs/images/mounts/consumers; production/foreign resources untouched | Scripted adapter fixtures passed; Docker E2E pending |
| PostgreSQL | Exact empty owned target; pinned transactional import; failed/ambiguous import reobserved or owned target recreated | Scripted adapter fixtures passed; PostgreSQL E2E pending |
| MinIO | Bounded resumable batches; GET/hash before skip; exact enumerate and full GET validation | Scripted corruption fixture passed; MinIO E2E pending |
| Data validation | Storage/media/PDF/video/layout/presentation/schedule/default/emergency/chat/PoP/screenshot/heartbeat/log refs; exclusion reconciliation; baseline deltas | Scripted reference fixture passed; application validation pending |
| Report | v3 only at DATA_VALIDATED; identities/aggregates/digests/timings/codes; no secrets/content | Developer redaction fixture passed |
| Promotion/rollback | No Packet 1 command or effect | Correctly deferred |
| Native engine | Production remains Unavailable/ENOTSUP; no selection/installation | Static check required at handoff |
| Full recovery regression | Existing 429-test recovery suite | Deferred until complete controlled flow is stable |

Do not mark Docker, PostgreSQL, MinIO, application, promotion, rollback, RTO, or production activation rows passed from scripted adapters. Preserve logs, checksums, timings, build identity, dataset identity, and observed fixes when the later disposable Docker gate runs.

