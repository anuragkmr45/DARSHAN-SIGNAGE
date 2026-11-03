-- One editable live draft and one idempotent submission. This journal contains
-- policy/review data only; never media tickets, URLs, cookies or credentials.
CREATE TABLE live_authoring_drafts (
  id uuid PRIMARY KEY,
  schedule_id uuid UNIQUE REFERENCES schedules(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  last_request_id uuid NOT NULL,
  last_request_fingerprint varchar(64) NOT NULL CHECK (last_request_fingerprint ~ '^[0-9a-f]{64}$'),
  last_review jsonb NOT NULL CHECK (jsonb_typeof(last_review)='object'),
  submission_request_id uuid,
  submission_fingerprint varchar(64) CHECK (submission_fingerprint ~ '^[0-9a-f]{64}$'),
  submitted_request_id uuid REFERENCES schedule_requests(id) ON DELETE RESTRICT,
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT live_authoring_drafts_submission_check CHECK (
    (submission_request_id IS NULL AND submission_fingerprint IS NULL AND submitted_request_id IS NULL)
    OR (submission_request_id IS NOT NULL AND submission_fingerprint IS NOT NULL AND submitted_request_id IS NOT NULL))
);
CREATE INDEX live_authoring_drafts_creator_idx ON live_authoring_drafts(created_by);
-- Rollback only after stopping live authoring and retaining a reviewed export
-- of draft/submission identities. Do not drop their schedules or request history.
