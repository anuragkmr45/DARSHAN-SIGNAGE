# D3 source packet 2B1 QA status

Scope is source/static implementation and deterministic tests only. Retained live source services, volumes, keys and journals remain untouched. Root's prior SERVICES_READY acceptance is separate from this packet.

- [x] Bind a separate strict source data profile to the unchanged source runtime SHA; data providers enabled, live seed disabled.
- [x] Fixed `seed`/read-only `data-status`; capture/resume and whole-run recovery remain unavailable.
- [x] Explicit certificate/CA/SNI/IP-bound PG/S3 clients with protected-file credentials and bounded operations.
- [x] Invoke the production migration runner with the real pinned 59-entry manifest; verify full ledger/release/terminal 0057, without D3 ledger inserts.
- [x] Parameterized current-schema fixture plan, deterministic valid three-page PDF/page 2, video loop/emergency, chat, device and stale operational work.
- [x] Conditional immutable uploads and authenticated GET/hash verification for all 16 durable objects, including every log source and archive logs.
- [x] Atomic SQL references/seed receipt, exclusive SQL lease, exact NOLOGIN writer role identity and post-commit revocation/closure.
- [x] Complete business row/object/catalog/configuration seal separate from physical PG/resource identity and explicitly enumerated operational exclusions.
- [x] Durable schema/seal stages, SQL commit and object-prefix retry guards, protected host-to-SQL receipt binding, read-only unsafe-window refusal.
- [x] Initial 2B1: 426 distinct deterministic tests across single-fork runs; scripts/app/recovery typechecks, server build, focused lint, 45-asset/hash audit and diff check. Original evidence retains those historical per-run counts.
- [x] Review P2 corrections: exact UI-password link recovery, checked-out PG error/settlement ownership and enum/internal-FK schema identity; all 201 affected tests, three typechecks, build/lint/diff and current 45-asset/hash audit passed.
- [x] Independent code/security review and explicit `live_seed_enabled:true` enrollment, preserving source runtime SHA 1deb808f… and all other recovery gates false.
- [x] One controlled live attempt and read-only failure diagnosis captured; 59 real migrations reached 0057, but the BASELINED execution-state verifier mismatch blocked schema receipt/seed. No second seed ran; owned intent/UI passwords/database prefix are retained.
- [x] Static ledger comparison corrected to the two production completed method/state pairs; real-manifest 38-baseline/21-applied regression and unchanged strict authority checks. Independent review approved; live recovery acceptance remains outstanding.
- [x] Independent review approved the correction and one retained seed continuation; its first fresh preflight blocked with generic Docker failure/ownership not reobserved. Zero continuation seed attempts and no admission waiver; retained resources preserved.
- [x] Separately authorized read-only diagnosis found current RAM below the unchanged gate and two catches masking classified errors; enrolled Docker identities/resources match and all diagnostic Docker calls succeeded. Original inner preflight failure is unrecorded/unproven. No retry or code correction performed.
- [x] Separate static observability correction preserves classified failures, adds strict bounded/redacted diagnostics and retains all admission limits; 35 diagnostic, 291 companion lifecycle and 142 predecessor tests passed, plus scripts/app/recovery typechecks, build and focused lint. Independent review and any further live admission remain outstanding.
- [ ] Bounded real migration/seed/SQL constraint/conditional S3 acceptance followed by a separate fresh-process data-status and writer-closure proof.
- [ ] Five-role signed capsule, backup reservation, container capture/package/encryption, broker and durable attempt/publication settlement.

See [2B1 runbook](../docs/runbooks/controlled-recovery-d3-source-data.md) for exact commands, [live gate failure evidence](evidence/controlled-recovery-d3-live-source-data-gate-2026-10-31.md) for current enrollment/retained state, and [P2 static evidence](evidence/controlled-recovery-d3-source-subpacket2b1-p2-corrections-2026-10-31.md) for reviewed code checks. Original static evidence remains historical. No seed/seal acceptance is claimed, and no production/native, restore, runtime/application, promotion or rollback boundary is activated.
