-- Scheduled capacity only. Runtime room occupancy is deliberately separate:
-- expiring an authoring hold never proves a transmitting room is gone.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Adopted sites can have the0021 ledger without its physical exclusion. Stop
-- on existing conflicts; never rewrite/delete somebody's approved bookings.
DO $$
DECLARE extension_schema text;
BEGIN
  SELECT n.nspname INTO extension_schema FROM pg_extension e
    JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='btree_gist';
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='schedule_reservations'::regclass AND conname='schedule_reservations_active_overlap_excl') THEN
    IF EXISTS (SELECT 1 FROM schedule_reservations WHERE state IN ('HELD','RESERVED','PUBLISHED') AND start_at >= end_at)
      OR EXISTS (SELECT 1 FROM schedule_reservations a JOIN schedule_reservations b
        ON a.id < b.id AND a.screen_id=b.screen_id
        AND a.state IN ('HELD','RESERVED','PUBLISHED') AND b.state IN ('HELD','RESERVED','PUBLISHED')
        AND a.start_at < b.end_at AND b.start_at < a.end_at) THEN
      RAISE EXCEPTION 'Existing screen reservations conflict; review before migration' USING ERRCODE='23P01';
    END IF;
    EXECUTE format('ALTER TABLE schedule_reservations ADD CONSTRAINT schedule_reservations_active_overlap_excl
      EXCLUDE USING gist (screen_id %I.gist_uuid_ops WITH =, tsrange(start_at,end_at,''[)'') WITH &&)
      WHERE (state IN (''HELD'',''RESERVED'',''PUBLISHED''))', extension_schema);
  END IF;
END;
$$;
--> statement-breakpoint
CREATE TABLE live_fallback_preparations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), presentation_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state varchar(16) NOT NULL DEFAULT 'PENDING', source_fingerprint varchar(64) NOT NULL,
  source_graph jsonb NOT NULL, manifest jsonb, claim_token uuid, lease_expires_at timestamp, failure_code varchar(120),
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT live_fallback_preparations_state_check CHECK (state IN ('PENDING','PROCESSING','READY','FAILED','CANCELLED')),
  CONSTRAINT live_fallback_preparations_fingerprint_check CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT live_fallback_preparations_ready_check CHECK (state <> 'READY' OR (manifest IS NOT NULL AND jsonb_typeof(manifest)='object')),
  CONSTRAINT live_fallback_preparations_claim_check CHECK (
    (state='PROCESSING' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state<>'PROCESSING' AND claim_token IS NULL AND lease_expires_at IS NULL))
);
CREATE INDEX live_fallback_preparations_presentation_idx ON live_fallback_preparations(presentation_id,state);
CREATE INDEX live_fallback_preparations_source_idx ON live_fallback_preparations(source_fingerprint);
CREATE INDEX live_fallback_preparations_lease_idx ON live_fallback_preparations(state,lease_expires_at);
CREATE TABLE live_fallback_preparation_assets (
  preparation_id uuid NOT NULL REFERENCES live_fallback_preparations(id) ON DELETE RESTRICT,
  asset_id uuid NOT NULL, media_id uuid NOT NULL,
  storage_object_id uuid NOT NULL REFERENCES storage_objects(id) ON DELETE RESTRICT,
  sha256 varchar(64) NOT NULL, size bigint NOT NULL, content_type varchar(255) NOT NULL,
  render_type varchar(16) NOT NULL, source_type varchar(16) NOT NULL, status varchar(16) NOT NULL DEFAULT 'READY',
  representation varchar(64) NOT NULL, dependencies uuid[] NOT NULL DEFAULT '{}',
  source_object_id uuid, source_sha256 varchar(64), source_content_type varchar(255),
  PRIMARY KEY (preparation_id,asset_id),
  CONSTRAINT live_fallback_preparation_assets_valid_check CHECK (status='READY' AND sha256 ~ '^[0-9a-f]{64}$'
    AND size>0 AND render_type IN ('image','video','pdf','hls') AND source_type IN ('IMAGE','VIDEO','DOCUMENT','WEBPAGE'))
);
CREATE INDEX live_fallback_preparation_assets_object_idx ON live_fallback_preparation_assets(storage_object_id);
CREATE INDEX live_fallback_preparation_assets_media_idx ON live_fallback_preparation_assets(media_id);
--> statement-breakpoint
CREATE FUNCTION darshan_live_audience_valid(ids uuid[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT cardinality(ids) BETWEEN 1 AND 25 AND array_ndims(ids)=1 AND array_lower(ids,1)=1
    AND array_position(ids,NULL) IS NULL
    AND cardinality(ids)=(SELECT count(DISTINCT item) FROM unnest(ids) item)
$$;
CREATE TABLE live_schedule_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), schedule_id uuid NOT NULL, schedule_item_id uuid NOT NULL,
  schedule_request_id uuid, reservation_token uuid NOT NULL, schedule_revision integer NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  live_session_id uuid NOT NULL REFERENCES live_sessions(id) ON DELETE RESTRICT,
  presenter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, policy_revision integer NOT NULL,
  preparation_id uuid NOT NULL REFERENCES live_fallback_preparations(id) ON DELETE RESTRICT,
  approval_fingerprint varchar(64) NOT NULL, item_fingerprint varchar(64) NOT NULL, frozen_policy jsonb NOT NULL,
  screen_ids uuid[] NOT NULL, capacity_slot integer NOT NULL, start_at timestamp NOT NULL, end_at timestamp NOT NULL,
  state varchar(16) NOT NULL, hold_expires_at timestamp, publish_id uuid,
  approved_at timestamp, published_at timestamp, released_at timestamp, release_reason text,
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT live_schedule_occurrences_window_check CHECK (start_at<end_at),
  CONSTRAINT live_schedule_occurrences_slot_check CHECK (capacity_slot BETWEEN 1 AND 10),
  CONSTRAINT live_schedule_occurrences_audience_check CHECK (darshan_live_audience_valid(screen_ids)),
  CONSTRAINT live_schedule_occurrences_state_check CHECK (state IN ('HELD','RESERVED','PUBLISHED','RELEASED','EXPIRED','CANCELLED')),
  CONSTRAINT live_schedule_occurrences_revision_check CHECK (schedule_revision>0 AND policy_revision>0),
  CONSTRAINT live_schedule_occurrences_fingerprint_check CHECK (approval_fingerprint ~ '^[0-9a-f]{64}$' AND item_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT live_schedule_occurrences_policy_check CHECK (jsonb_typeof(frozen_policy)='object'),
  CONSTRAINT live_schedule_occurrences_lifecycle_check CHECK (
    (state<>'HELD' OR (hold_expires_at IS NOT NULL AND schedule_request_id IS NOT NULL))
    AND (state<>'RESERVED' OR schedule_request_id IS NOT NULL)
    AND (state<>'PUBLISHED' OR publish_id IS NOT NULL))
);
CREATE UNIQUE INDEX live_schedule_occurrences_token_item_idx ON live_schedule_occurrences(reservation_token,schedule_item_id);
CREATE INDEX live_schedule_occurrences_request_idx ON live_schedule_occurrences(schedule_request_id);
CREATE INDEX live_schedule_occurrences_publish_idx ON live_schedule_occurrences(publish_id);
CREATE INDEX live_schedule_occurrences_source_idx ON live_schedule_occurrences(live_session_id,state,end_at);
DO $$ DECLARE extension_schema text;
BEGIN
  SELECT n.nspname INTO extension_schema FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='btree_gist';
  EXECUTE format('ALTER TABLE live_schedule_occurrences ADD CONSTRAINT live_occurrences_active_capacity_excl
    EXCLUDE USING gist (capacity_slot %I.gist_int4_ops WITH =, tsrange(start_at,end_at,''[)'') WITH &&)
    WHERE (state IN (''HELD'',''RESERVED'',''PUBLISHED'')) DEFERRABLE INITIALLY IMMEDIATE', extension_schema);
END; $$;
CREATE TABLE live_occurrence_assets (
  occurrence_id uuid NOT NULL REFERENCES live_schedule_occurrences(id) ON DELETE RESTRICT,
  asset_id uuid NOT NULL, media_id uuid NOT NULL,
  storage_object_id uuid NOT NULL REFERENCES storage_objects(id) ON DELETE RESTRICT,
  sha256 varchar(64) NOT NULL, size bigint NOT NULL, content_type varchar(255) NOT NULL,
  render_type varchar(16) NOT NULL, source_type varchar(16) NOT NULL, status varchar(16) NOT NULL DEFAULT 'READY',
  representation varchar(64) NOT NULL, dependencies uuid[] NOT NULL DEFAULT '{}',
  source_object_id uuid, source_sha256 varchar(64), source_content_type varchar(255),
  PRIMARY KEY (occurrence_id,asset_id),
  CONSTRAINT live_occurrence_assets_valid_check CHECK (status='READY' AND sha256 ~ '^[0-9a-f]{64}$'
    AND size>0 AND render_type IN ('image','video','pdf','hls') AND source_type IN ('IMAGE','VIDEO','DOCUMENT','WEBPAGE'))
);
CREATE INDEX live_occurrence_assets_object_idx ON live_occurrence_assets(storage_object_id);
CREATE INDEX live_occurrence_assets_media_idx ON live_occurrence_assets(media_id);
--> statement-breakpoint
CREATE FUNCTION darshan_freeze_live_preparation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Retain live fallback preparation history' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.state='READY' THEN
      RAISE EXCEPTION 'Prepare assets before finalizing READY state' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.presentation_id,NEW.created_by,NEW.source_fingerprint,NEW.source_graph)
    IS DISTINCT FROM (OLD.presentation_id,OLD.created_by,OLD.source_fingerprint,OLD.source_graph)
    OR (OLD.state='READY' AND (NEW.state<>'READY' OR NEW.manifest IS DISTINCT FROM OLD.manifest)) THEN
    RAISE EXCEPTION 'Frozen live fallback preparation is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.state='READY' AND (jsonb_typeof(NEW.manifest->'assets') IS DISTINCT FROM 'array'
    OR NOT EXISTS (SELECT 1 FROM live_fallback_preparation_assets WHERE preparation_id=NEW.id)
    OR jsonb_array_length(NEW.manifest->'assets')<>(SELECT count(*) FROM live_fallback_preparation_assets WHERE preparation_id=NEW.id)) THEN
    RAISE EXCEPTION 'Prepared live fallback asset graph is incomplete' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER live_fallback_preparation_freeze BEFORE INSERT OR UPDATE OR DELETE ON live_fallback_preparations
  FOR EACH ROW EXECUTE FUNCTION darshan_freeze_live_preparation();
CREATE FUNCTION darshan_freeze_live_preparation_asset() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE preparation_state text;
BEGIN
  SELECT state INTO preparation_state FROM live_fallback_preparations
    WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.preparation_id ELSE NEW.preparation_id END FOR UPDATE;
  IF preparation_state IS NULL OR preparation_state NOT IN ('PENDING','PROCESSING')
    OR (TG_OP='UPDATE' AND NEW.preparation_id<>OLD.preparation_id) THEN
    RAISE EXCEPTION 'Prepared live fallback assets are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER live_fallback_preparation_asset_freeze BEFORE INSERT OR UPDATE OR DELETE ON live_fallback_preparation_assets
  FOR EACH ROW EXECUTE FUNCTION darshan_freeze_live_preparation_asset();
CREATE FUNCTION darshan_freeze_live_occurrence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retain published live policy history' USING ERRCODE='23514'; END IF;
  IF (NEW.schedule_id,NEW.schedule_item_id,NEW.schedule_request_id,NEW.reservation_token,NEW.schedule_revision,
    NEW.owner_user_id,NEW.live_session_id,NEW.presenter_user_id,NEW.policy_revision,NEW.preparation_id,
    NEW.approval_fingerprint,NEW.item_fingerprint,NEW.frozen_policy,NEW.screen_ids,NEW.start_at,NEW.end_at)
    IS DISTINCT FROM (OLD.schedule_id,OLD.schedule_item_id,OLD.schedule_request_id,OLD.reservation_token,OLD.schedule_revision,
    OLD.owner_user_id,OLD.live_session_id,OLD.presenter_user_id,OLD.policy_revision,OLD.preparation_id,
    OLD.approval_fingerprint,OLD.item_fingerprint,OLD.frozen_policy,OLD.screen_ids,OLD.start_at,OLD.end_at)
    OR (OLD.publish_id IS NOT NULL AND NEW.publish_id IS DISTINCT FROM OLD.publish_id) THEN
    RAISE EXCEPTION 'Approved live occurrence policy is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER live_occurrence_freeze BEFORE UPDATE OR DELETE ON live_schedule_occurrences
  FOR EACH ROW EXECUTE FUNCTION darshan_freeze_live_occurrence();
CREATE FUNCTION darshan_freeze_live_occurrence_asset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Approved live fallback assets are immutable' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER live_occurrence_asset_freeze BEFORE UPDATE OR DELETE ON live_occurrence_assets
  FOR EACH ROW EXECUTE FUNCTION darshan_freeze_live_occurrence_asset();
CREATE FUNCTION darshan_validate_live_occurrence_asset_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM live_schedule_occurrences occurrence
    JOIN live_fallback_preparations preparation ON preparation.id=occurrence.preparation_id AND preparation.state='READY'
    JOIN live_fallback_preparation_assets asset ON asset.preparation_id=preparation.id AND asset.asset_id=NEW.asset_id
    WHERE occurrence.id=NEW.occurrence_id
      AND (asset.media_id,asset.storage_object_id,asset.sha256,asset.size,asset.content_type,asset.render_type,
        asset.source_type,asset.status,asset.representation,asset.dependencies,
        asset.source_object_id,asset.source_sha256,asset.source_content_type)
        IS NOT DISTINCT FROM (NEW.media_id,NEW.storage_object_id,NEW.sha256,NEW.size,NEW.content_type,NEW.render_type,
        NEW.source_type,NEW.status,NEW.representation,NEW.dependencies,
        NEW.source_object_id,NEW.source_sha256,NEW.source_content_type)
  ) THEN
    RAISE EXCEPTION 'Occurrence assets must equal the prepared immutable graph' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER live_occurrence_asset_insert_guard BEFORE INSERT ON live_occurrence_assets
  FOR EACH ROW EXECUTE FUNCTION darshan_validate_live_occurrence_asset_insert();
CREATE FUNCTION darshan_assert_live_occurrence_assets_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected bigint; actual bigint;
BEGIN
  SELECT count(*) INTO expected FROM live_fallback_preparation_assets WHERE preparation_id=NEW.preparation_id;
  SELECT count(*) INTO actual FROM live_occurrence_assets WHERE occurrence_id=NEW.id;
  IF expected=0 OR expected<>actual THEN
    RAISE EXCEPTION 'Occurrence fallback graph must be complete at commit' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER live_occurrence_assets_complete AFTER INSERT ON live_schedule_occurrences
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION darshan_assert_live_occurrence_assets_complete();
-- Rollback is manual and requires stopping live publication/authority, reviewing
-- all retained preparations/occurrences and their immutable artifacts first.
-- Never use CASCADE or downgrade while any live approval/run is still relevant.
-- Preserve the repaired0021 screen exclusion when reverting this feature.
