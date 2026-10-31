CREATE TABLE IF NOT EXISTS site_recovery_generations (
  site_id varchar(63) PRIMARY KEY,
  generation uuid NOT NULL UNIQUE,
  operation_id uuid NOT NULL UNIQUE,
  source_run_id uuid NOT NULL,
  source_manifest_sha256 varchar(64) NOT NULL,
  state varchar(40) NOT NULL DEFAULT 'APPLICATION_RECONCILED',
  reconciliation_completed_at timestamptz,
  reconciliation_receipt_sha256 varchar(64),
  reconciliation_action_counts jsonb,
  write_freeze boolean NOT NULL DEFAULT true,
  promoted_at timestamptz,
  accepted_at timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_recovery_generations_manifest_check
    CHECK (source_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT site_recovery_generations_reconciliation_receipt_check
    CHECK ((reconciliation_completed_at IS NULL AND reconciliation_receipt_sha256 IS NULL AND reconciliation_action_counts IS NULL)
      OR (reconciliation_completed_at IS NOT NULL AND reconciliation_receipt_sha256 ~ '^[a-f0-9]{64}$'
        AND jsonb_typeof(reconciliation_action_counts) = 'object')),
  CONSTRAINT site_recovery_generations_state_check
    CHECK (state IN ('APPLICATION_RECONCILED', 'APP_VALIDATED', 'AWAITING_PROMOTION',
      'PROMOTED_PENDING_ACCEPTANCE', 'ACCEPTED', 'ROLLED_BACK',
      'FAILED_RETRYABLE', 'OPERATOR_REVIEW', 'ABANDONED_RETAINED'))
);

CREATE TABLE IF NOT EXISTS recovery_pairing_reviews (
  generation uuid NOT NULL,
  certificate_id uuid NOT NULL REFERENCES device_certificates(id) ON DELETE RESTRICT,
  screen_id uuid NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'PENDING',
  actor_id uuid,
  reason text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (generation, certificate_id),
  CONSTRAINT recovery_pairing_reviews_status_check
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  CONSTRAINT recovery_pairing_reviews_decision_check
    CHECK ((status = 'PENDING' AND actor_id IS NULL AND reason IS NULL AND reviewed_at IS NULL)
      OR (status IN ('APPROVED', 'REJECTED') AND actor_id IS NOT NULL
        AND length(btrim(reason)) BETWEEN 1 AND 1000 AND reviewed_at IS NOT NULL))
);
CREATE INDEX recovery_pairing_reviews_screen_idx
  ON recovery_pairing_reviews (generation, screen_id, status);

CREATE TABLE IF NOT EXISTS recovery_generation_challenges (
  id uuid PRIMARY KEY,
  generation uuid NOT NULL,
  screen_id uuid NOT NULL,
  certificate_id uuid NOT NULL REFERENCES device_certificates(id) ON DELETE RESTRICT,
  client_nonce varchar(172) NOT NULL,
  server_challenge varchar(172) NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  receipt_sha256 varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation, screen_id, certificate_id, client_nonce),
  UNIQUE (server_challenge),
  CONSTRAINT recovery_generation_challenges_receipt_check
    CHECK ((consumed_at IS NULL AND receipt_sha256 IS NULL)
      OR (consumed_at IS NOT NULL AND receipt_sha256 ~ '^[a-f0-9]{64}$'))
);
CREATE INDEX recovery_generation_challenges_expiry_idx
  ON recovery_generation_challenges (expires_at, consumed_at);

ALTER TABLE device_commands
  ADD COLUMN IF NOT EXISTS recovery_generation uuid;
ALTER TABLE device_desired_state
  ADD COLUMN IF NOT EXISTS recovery_generation uuid;
ALTER TABLE device_desired_state_history
  ADD COLUMN IF NOT EXISTS recovery_generation uuid;

CREATE INDEX IF NOT EXISTS device_commands_recovery_generation_idx
  ON device_commands (screen_id, recovery_generation, status);
