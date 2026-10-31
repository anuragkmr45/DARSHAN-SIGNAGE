CREATE TABLE IF NOT EXISTS controlled_recovery_report_projections (
  operation_id uuid PRIMARY KEY,
  site_id varchar(63) NOT NULL,
  sequence bigint NOT NULL,
  report_sha256 varchar(64) NOT NULL,
  envelope_sha256 varchar(64) NOT NULL UNIQUE,
  source_run_id uuid NOT NULL,
  source_manifest_sha256 varchar(64) NOT NULL,
  profile_sha256 varchar(64) NOT NULL,
  configuration_sha256 varchar(64) NOT NULL,
  release_id varchar(64) NOT NULL,
  schema_migration_id varchar(128) NOT NULL,
  target_id varchar(128) NOT NULL,
  recovery_generation uuid,
  state varchar(40) NOT NULL,
  data_result varchar(64) NOT NULL,
  application_result varchar(64) NOT NULL,
  promotion_result varchar(64) NOT NULL,
  rollback_result varchar(64) NOT NULL,
  report_created_at timestamptz NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  unexecuted_gates jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT controlled_recovery_report_sequence_check CHECK (sequence > 0),
  CONSTRAINT controlled_recovery_report_digests_check CHECK (
    report_sha256 ~ '^[a-f0-9]{64}$' AND envelope_sha256 ~ '^[a-f0-9]{64}$'
    AND source_manifest_sha256 ~ '^[a-f0-9]{64}$' AND profile_sha256 ~ '^[a-f0-9]{64}$'
    AND configuration_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT controlled_recovery_report_state_check CHECK (state IN (
    'DATA_VALIDATED', 'APPLICATION_RECONCILED', 'APP_VALIDATED', 'AWAITING_PROMOTION',
    'PROMOTED_PENDING_ACCEPTANCE', 'ACCEPTED', 'ROLLED_BACK', 'OPERATOR_REVIEW', 'FAILED_RETRYABLE')),
  CONSTRAINT controlled_recovery_report_gates_check CHECK (jsonb_typeof(unexecuted_gates) = 'array')
);
CREATE UNIQUE INDEX controlled_recovery_report_site_sequence_idx
  ON controlled_recovery_report_projections (site_id, sequence);
CREATE INDEX controlled_recovery_report_latest_idx
  ON controlled_recovery_report_projections (site_id, sequence DESC, imported_at DESC);
