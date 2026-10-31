# D3 source 2A acceptance status

Developer status only. Evidence: [P2 corrections and final verification](evidence/controlled-recovery-d3-source-subpacket2a-p2-corrections-2026-10-30.md). Runbook: [fixed providers and blockers](../docs/runbooks/controlled-recovery-d3-source-subpacket2a.md).

The later [installed provider packet](evidence/controlled-recovery-d3-source-providers-2026-10-30.md) admits provider/live-prepare flags with capture disabled and supplies the fixed CLI. Live acceptance remains unchecked below.

- [x] Retained protected crypto/layout rejection and continuity tests.
- [x] Fixed source executor admission, bounds and exact helper settlement tests.
- [x] Protected numeric volume ownership/mode/hash and cancellation tests.
- [x] Fixed health positive/negative contract tests with deterministic transport.
- [x] D4 inherited-volume override and exact removal argv tests.
- [x] Preserve crypto process uncertainty with a durable layout lock and no retry mutation.
- [x] Recover exact layout/volume-receipt publication windows and verify matching pending remnants.
- [x] Parse bounded Valkey responses incrementally across every split point, rejecting malformed/extra frames.
- [x] D1–D4/source predecessor tests, both typechecks, server build, focused lint and diff check.
- [x] Bind root's direct MinIO binary file-credential capability observation to exact image/evidence digest; this does not prove source TLS or materialization.
- [x] Implement and deterministically test the fixed installed provider/admission composition; see [preparation runbook](../docs/runbooks/controlled-recovery-d3-source-providers.md).
- [x] Verify populated status with actual retained layout/state and read-only health/target observers; normal and unsafe-window filesystem inventories remain unchanged.
- [x] Normalize only the exact Docker capability set and reconcile protected pending-create authority during explicit prepare; read-only commands remain blocked without repair.
- [x] Require canonical materialization binding and file/volume/layout evidence for every retained runtime observation, including complete READY and repeat prepare, without repair.
- [x] Root separately accepted bounded real owned-volume materialization and helper settlement; [live source evidence](evidence/controlled-recovery-d3-live-source-prepare-2026-10-31.md).
- [x] Root separately accepted real PG/S3/Valkey certificate-bound positive/negative probes through SERVICES_READY; no data/backup acceptance inferred.
- [ ] Complete migrations, seed/seal, capsule, broker/capture/publication settlement.

D2, legacy source_backup and whole_run remain disabled. Source service acceptance is limited to the linked root evidence. The separate 2B1 data providers are static-tested with live seed disabled; migration/seed/capsule/encrypted-backup acceptance remains open. Existing anonymous volumes and retained age identity were untouched.
