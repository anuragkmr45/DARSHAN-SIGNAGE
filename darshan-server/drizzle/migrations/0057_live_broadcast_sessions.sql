-- Additive authoring foundation only: no live runtime credentials or changes
-- to immutable snapshots. Existing clients keep required presentation fallback.
CREATE TABLE live_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  description text,
  presenter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  microphone boolean NOT NULL DEFAULT false,
  screen_share_audio boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1,
  policy_revision integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  owner_scope varchar(16) NOT NULL DEFAULT 'RESTRICTED',
  owner_department_id uuid REFERENCES departments(id) ON DELETE RESTRICT,
  deleted_at timestamp,
  deleted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT live_sessions_revision_check CHECK (revision > 0),
  CONSTRAINT live_sessions_policy_revision_check CHECK (policy_revision > 0 AND policy_revision <= revision),
  CONSTRAINT live_sessions_deleted_inactive_check CHECK (deleted_at IS NULL OR is_active = false),
  CONSTRAINT live_sessions_owner_scope_check CHECK (
    (owner_scope = 'DEPARTMENT' AND owner_department_id IS NOT NULL)
    OR (owner_scope IN ('ORGANIZATION', 'RESTRICTED') AND owner_department_id IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX live_sessions_owner_idx ON live_sessions (owner_scope, owner_department_id);
CREATE INDEX live_sessions_presenter_idx ON live_sessions (presenter_user_id);
CREATE INDEX live_sessions_active_idx ON live_sessions (is_active, deleted_at);
--> statement-breakpoint
ALTER TABLE schedule_items
  ADD COLUMN source_kind varchar(16) NOT NULL DEFAULT 'PRESENTATION',
  ADD COLUMN live_session_id uuid REFERENCES live_sessions(id) ON DELETE RESTRICT,
  ADD CONSTRAINT schedule_items_source_kind_check CHECK (
    (source_kind = 'PRESENTATION' AND live_session_id IS NULL)
    OR (source_kind = 'LIVE' AND live_session_id IS NOT NULL)
  );
CREATE INDEX schedule_items_live_session_idx ON schedule_items (live_session_id);
--> statement-breakpoint
CREATE FUNCTION darshan_validate_live_source_reference() RETURNS trigger AS $$
DECLARE live_source live_sessions%ROWTYPE;
BEGIN
  IF NEW.source_kind = 'LIVE' AND (
    TG_OP = 'INSERT' OR NEW.live_session_id IS DISTINCT FROM OLD.live_session_id
    OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
  ) THEN
    SELECT * INTO live_source FROM live_sessions WHERE id = NEW.live_session_id FOR SHARE;
    IF NOT FOUND OR live_source.deleted_at IS NOT NULL OR NOT live_source.is_active THEN
      RAISE EXCEPTION 'Live source unavailable' USING ERRCODE = '23514', CONSTRAINT = 'schedule_items_live_source_available';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER schedule_items_live_source_available
  BEFORE INSERT OR UPDATE OF source_kind, live_session_id ON schedule_items
  FOR EACH ROW EXECUTE FUNCTION darshan_validate_live_source_reference();
-- Rollback requires disabling live authoring/publication and proving there are
-- no LIVE items or published LIVE snapshots/runs. Never silently discard them.
-- Then drop the trigger/function, schedule_items_source_kind_check, schedule_items_live_session_idx,
-- live_session_id/source_kind, and live_sessions (in that order). Old ordinary
-- items retain their mandatory presentation_id; no down migration is automatic.
