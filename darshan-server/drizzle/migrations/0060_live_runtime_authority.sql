-- Additive, default-disabled live runtime authority. No credentials, SDP,
-- signaling tickets or replayable authority grants belong in these tables.
CREATE TABLE live_occurrence_controls (
  occurrence_id uuid PRIMARY KEY REFERENCES live_schedule_occurrences(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 1,
  generation integer NOT NULL DEFAULT 0, current_run_id uuid,
  disabled_by uuid, disable_reason text, updated_at timestamp NOT NULL DEFAULT now(),
  start_notified_at timestamp, end_notified_at timestamp,
  CONSTRAINT live_occurrence_controls_revision_check CHECK(revision>0 AND generation>=0)
);
CREATE TABLE live_media_nodes (
  id uuid PRIMARY KEY, managed_instance_id uuid NOT NULL, authority_epoch uuid NOT NULL,
  endpoint_fingerprint varchar(64) NOT NULL, accepting_new_runs boolean NOT NULL DEFAULT false,
  last_seen_at timestamp NOT NULL DEFAULT now(), observed_dead_at timestamp, death_witness_id uuid,
  CONSTRAINT live_media_nodes_fingerprint_check CHECK(endpoint_fingerprint ~ '^[0-9a-f]{64}$')
);
CREATE TABLE live_runs (
  id uuid PRIMARY KEY, occurrence_id uuid NOT NULL REFERENCES live_schedule_occurrences(id) ON DELETE RESTRICT,
  generation integer NOT NULL, authority_epoch uuid NOT NULL,
  node_instance_id uuid NOT NULL REFERENCES live_media_nodes(id) ON DELETE RESTRICT,
  runtime_slot integer NOT NULL, state varchar(16) NOT NULL DEFAULT 'PREPARING',
  presenter_user_id uuid NOT NULL, presenter_session_jti varchar(255) NOT NULL,
  presenter_runtime_session_id uuid NOT NULL, operation_revision bigint NOT NULL DEFAULT 1,
  revision integer NOT NULL DEFAULT 1, stop_reason varchar(160),
  created_at timestamp NOT NULL DEFAULT now(), started_at timestamp, stopped_at timestamp,
  teardown_confirmed_at timestamp, updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT live_runs_generation_unique UNIQUE(id,generation),
  CONSTRAINT live_runs_occurrence_generation_unique UNIQUE(occurrence_id,generation),
  CONSTRAINT live_runs_slot_check CHECK(runtime_slot BETWEEN 1 AND 10),
  CONSTRAINT live_runs_revision_check CHECK(generation>0 AND operation_revision>0 AND revision>0),
  CONSTRAINT live_runs_state_check CHECK(state IN ('PREPARING','RUNNING','STOPPING','STOPPED')),
  CONSTRAINT live_runs_teardown_check CHECK((state='STOPPED')=(teardown_confirmed_at IS NOT NULL))
);
-- Runtime occupancy is independent of scheduled window/hold expiry. A logical
-- STOPPING/REVOKED state NEVER frees a slot; only observed teardown can do so.
CREATE UNIQUE INDEX live_runs_occupied_slot_idx ON live_runs(runtime_slot) WHERE teardown_confirmed_at IS NULL;
CREATE UNIQUE INDEX live_runs_active_occurrence_idx ON live_runs(occurrence_id) WHERE teardown_confirmed_at IS NULL;
CREATE INDEX live_runs_reconcile_idx ON live_runs(state,updated_at);
CREATE TABLE live_admissions (
  id uuid PRIMARY KEY, run_id uuid NOT NULL, generation integer NOT NULL,
  role varchar(16) NOT NULL, participant_id varchar(255) NOT NULL,
  user_id uuid, session_jti varchar(255), screen_id uuid, certificate_serial varchar(255),
  runtime_session_id uuid NOT NULL, readiness jsonb,
  operation_revision bigint NOT NULL DEFAULT 1, state varchar(16) NOT NULL DEFAULT 'PENDING',
  last_authorized_at timestamp, created_at timestamp NOT NULL DEFAULT now(),
  revoked_at timestamp, teardown_confirmed_at timestamp, updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT live_admissions_run_fk FOREIGN KEY(run_id,generation) REFERENCES live_runs(id,generation) ON DELETE RESTRICT,
  CONSTRAINT live_admissions_role_check CHECK(role IN ('presenter','receiver')),
  CONSTRAINT live_admissions_state_check CHECK(state IN ('PENDING','ACTIVE','REVOKING','REVOKED')),
  CONSTRAINT live_admissions_revision_check CHECK(operation_revision>0),
  CONSTRAINT live_admissions_binding_check CHECK(
    (role='presenter' AND user_id IS NOT NULL AND session_jti IS NOT NULL AND screen_id IS NULL AND certificate_serial IS NULL AND readiness IS NULL)
    OR (role='receiver' AND user_id IS NULL AND session_jti IS NULL AND screen_id IS NOT NULL AND certificate_serial IS NOT NULL AND jsonb_typeof(readiness)='object'))
);
CREATE UNIQUE INDEX live_admissions_presenter_idx ON live_admissions(run_id) WHERE role='presenter' AND teardown_confirmed_at IS NULL;
CREATE UNIQUE INDEX live_admissions_receiver_idx ON live_admissions(run_id,screen_id) WHERE role='receiver' AND teardown_confirmed_at IS NULL;
CREATE INDEX live_admissions_reconcile_idx ON live_admissions(state,last_authorized_at);
CREATE TABLE live_media_operations (
  id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES live_runs(id) ON DELETE RESTRICT,
  admission_id uuid REFERENCES live_admissions(id) ON DELETE RESTRICT,
  kind varchar(24) NOT NULL, operation_revision bigint NOT NULL, dedupe_key varchar(255) NOT NULL UNIQUE,
  state varchar(16) NOT NULL DEFAULT 'PENDING', claim_token uuid, lease_expires_at timestamp,
  attempts integer NOT NULL DEFAULT 0, available_at timestamp NOT NULL DEFAULT now(),
  last_error_code varchar(100), created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT live_media_operations_kind_check CHECK(kind IN ('CREATE','REVOKE_ADMISSION','REVOKE_RUN')),
  CONSTRAINT live_media_operations_state_check CHECK(state IN ('PENDING','PROCESSING','ACKED')),
  CONSTRAINT live_media_operations_claim_check CHECK((state='PROCESSING' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR(state<>'PROCESSING' AND claim_token IS NULL AND lease_expires_at IS NULL)),
  CONSTRAINT live_media_operations_revision_check CHECK(operation_revision>0 AND attempts>=0),
  CONSTRAINT live_media_operations_target_check CHECK((kind='REVOKE_RUN' AND admission_id IS NULL) OR(kind<>'REVOKE_RUN' AND admission_id IS NOT NULL))
);
CREATE INDEX live_media_operations_pending_idx ON live_media_operations(state,available_at,lease_expires_at);
CREATE TABLE live_runtime_receipts (
  scope_hash varchar(64) NOT NULL, action varchar(64) NOT NULL, request_id uuid NOT NULL,
  body_sha256 varchar(64) NOT NULL, occurrence_id uuid NOT NULL REFERENCES live_schedule_occurrences(id) ON DELETE RESTRICT,
  run_id uuid REFERENCES live_runs(id) ON DELETE RESTRICT, admission_id uuid REFERENCES live_admissions(id) ON DELETE RESTRICT,
  created_at timestamp NOT NULL DEFAULT now(), PRIMARY KEY(scope_hash,action,request_id),
  CONSTRAINT live_runtime_receipts_hash_check CHECK(scope_hash ~ '^[0-9a-f]{64}$' AND body_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE TABLE live_admission_observations (
  admission_id uuid PRIMARY KEY REFERENCES live_admissions(id) ON DELETE RESTRICT,
  runtime_session_id uuid NOT NULL, sequence bigint NOT NULL, connection varchar(16) NOT NULL,
  subscription varchar(16) NOT NULL, frame varchar(16) NOT NULL, audio varchar(16) NOT NULL,
  fallback_ready boolean NOT NULL, fallback_reason varchar(160), received_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT live_admission_observations_seq_check CHECK(sequence>0 AND sequence<=9007199254740991),
  CONSTRAINT live_admission_observations_state_check CHECK(connection IN ('DISCONNECTED','CONNECTING','CONNECTED')
    AND subscription IN ('NONE','SUBSCRIBING','SUBSCRIBED') AND frame IN ('NONE','READY') AND audio IN ('NONE','READY','DEGRADED','MUTED'))
);
CREATE TABLE live_media_death_witnesses (
  id uuid PRIMARY KEY, node_instance_id uuid NOT NULL REFERENCES live_media_nodes(id) ON DELETE RESTRICT,
  authority_epoch uuid NOT NULL, managed_instance_id uuid NOT NULL, process_start_ticks varchar(32) NOT NULL,
  body_sha256 varchar(64) NOT NULL, received_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT live_media_death_witnesses_hash_check CHECK(body_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT live_media_death_witnesses_ticks_check CHECK(process_start_ticks ~ '^[0-9]+$')
);
CREATE FUNCTION darshan_freeze_live_runtime_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='live_runs' AND (to_jsonb(NEW)-ARRAY['state','operation_revision','revision','stop_reason','started_at','stopped_at','teardown_confirmed_at','updated_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','operation_revision','revision','stop_reason','started_at','stopped_at','teardown_confirmed_at','updated_at']) THEN
    RAISE EXCEPTION 'Live run authority binding is immutable' USING ERRCODE='23514';
  ELSIF TG_TABLE_NAME='live_admissions' AND (to_jsonb(NEW)-ARRAY['state','operation_revision','last_authorized_at','revoked_at','teardown_confirmed_at','updated_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','operation_revision','last_authorized_at','revoked_at','teardown_confirmed_at','updated_at']) THEN
    RAISE EXCEPTION 'Live admission identity/readiness binding is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER live_run_binding_freeze BEFORE UPDATE ON live_runs FOR EACH ROW EXECUTE FUNCTION darshan_freeze_live_runtime_binding();
CREATE TRIGGER live_admission_binding_freeze BEFORE UPDATE ON live_admissions FOR EACH ROW EXECUTE FUNCTION darshan_freeze_live_runtime_binding();
