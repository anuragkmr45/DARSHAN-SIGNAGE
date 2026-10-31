/** Compiled runtime mirror of the reviewed release-owned JSON registry. */
export const RECOVERY_COMPATIBILITY_REGISTRY_DOCUMENT = {
  format: 'darshan-recovery-compatibility-registry-v1',
  releases: [{
    release_id: 'release-01',
    source_kind: 'LOCAL_FILESYSTEM_V2',
    manifest_versions: [2],
    compatibility_generation: 1,
    terminal_migration_id: '0055_backup_deletion_idempotency_bindings.sql',
    ledger_fingerprint_sha256: 'fb7b1204029c2a4a3fac754845fff3723732ae8b0de6df54a5460c41b9a3f167',
  }, {
    release_id: 'release-02',
    source_kind: 'LOCAL_FILESYSTEM_V2',
    manifest_versions: [2],
    compatibility_generation: 2,
    terminal_migration_id: '0056_recovery_runtime_authority.sql',
    ledger_fingerprint_sha256: '69b84a7d0bdebf17df6bec95f907791d586cc9558ec33fb18b79eb41b6e62a2b',
  }, {
    release_id: 'release-03',
    source_kind: 'LOCAL_FILESYSTEM_V2',
    manifest_versions: [2],
    compatibility_generation: 3,
    terminal_migration_id: '0057_controlled_recovery_report_projection.sql',
    ledger_fingerprint_sha256: '05561d3b1c8cac7fa57f6d47503835d23c2b88f7886203ab9c8207238762c438',
  }],
} as const;
