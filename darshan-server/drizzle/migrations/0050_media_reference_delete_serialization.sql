CREATE OR REPLACE FUNCTION assert_active_media_reference(reference_id text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  referenced_deleted_at timestamp;
BEGIN
  IF reference_id IS NULL OR btrim(reference_id) = '' THEN
    RETURN;
  END IF;
  IF reference_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Media reference is missing or deleted' USING ERRCODE = '23503';
  END IF;
  -- A share lock is compatible across normal authoring/PoP traffic but
  -- conflicts with the delete transaction's row update. Whichever side wins
  -- becomes authoritative for this specific Media ID without a fleet-global
  -- lock or a check/write gap.
  SELECT deleted_at INTO referenced_deleted_at
  FROM media
  WHERE id::text = reference_id
  FOR SHARE;
  IF NOT FOUND OR referenced_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Media reference is missing or deleted' USING ERRCODE = '23503';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION lock_historical_media_reference(reference_id text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF reference_id IS NULL OR btrim(reference_id) = ''
    OR reference_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN;
  END IF;
  -- Late PoP is historical evidence and remains admissible after deletion.
  -- Lock a row when one exists so a concurrent delete still has a defined
  -- before/after order; legacy missing IDs remain accepted as before.
  PERFORM 1 FROM media WHERE id::text = reference_id FOR SHARE;
END;
$$;

CREATE OR REPLACE FUNCTION setting_references_media(setting_key text, setting_value jsonb, media_id text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF setting_value IS NULL THEN
    RETURN false;
  END IF;
  IF setting_key = 'default_media_id' THEN
    RETURN (jsonb_typeof(setting_value) = 'string' AND setting_value #>> '{}' = media_id)
      OR (jsonb_typeof(setting_value) = 'object' AND setting_value->>'media_id' = media_id);
  ELSIF setting_key = 'default_media_variants' THEN
    RETURN jsonb_typeof(setting_value) = 'object' AND EXISTS (
      SELECT 1 FROM jsonb_each(setting_value) AS entry(key, value)
      WHERE (jsonb_typeof(entry.value) = 'string' AND entry.value #>> '{}' = media_id)
        OR (jsonb_typeof(entry.value) = 'object' AND entry.value->>'media_id' = media_id)
    );
  ELSIF setting_key = 'default_media_targets' THEN
    RETURN jsonb_typeof(setting_value) = 'array' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(setting_value) AS entry(value)
      WHERE (jsonb_typeof(entry.value->'media_id') = 'string' AND entry.value->>'media_id' = media_id)
        OR (jsonb_typeof(entry.value->'media_id') = 'object' AND entry.value->'media_id'->>'media_id' = media_id)
    );
  ELSIF setting_key = 'org.branding' THEN
    RETURN jsonb_typeof(setting_value) = 'object' AND media_id IN (
      setting_value->>'logo_media_id',
      setting_value->>'icon_media_id',
      setting_value->>'favicon_media_id'
    );
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION validate_media_reference_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reference_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'presentation_items' OR TG_TABLE_NAME = 'presentation_slot_items' THEN
    PERFORM assert_active_media_reference(NEW.media_id::text);
  ELSIF TG_TABLE_NAME = 'chat_attachments' THEN
    PERFORM assert_active_media_reference(NEW.media_asset_id::text);
  ELSIF TG_TABLE_NAME = 'chat_bookmarks' THEN
    PERFORM assert_active_media_reference(NEW.media_asset_id::text);
  ELSIF TG_TABLE_NAME = 'screens' THEN
    PERFORM assert_active_media_reference(NEW.current_media_id::text);
  ELSIF TG_TABLE_NAME = 'emergencies' OR TG_TABLE_NAME = 'emergency_types' THEN
    PERFORM assert_active_media_reference(NEW.media_id::text);
  ELSIF TG_TABLE_NAME = 'settings' THEN
    IF NEW.key = 'default_media_id' THEN
      IF jsonb_typeof(NEW.value) = 'string' THEN
        PERFORM assert_active_media_reference(NEW.value #>> '{}');
      ELSIF jsonb_typeof(NEW.value) = 'object' THEN
        PERFORM assert_active_media_reference(NEW.value->>'media_id');
      END IF;
    ELSIF NEW.key = 'default_media_variants' AND jsonb_typeof(NEW.value) = 'object' THEN
      FOR reference_id IN
        SELECT CASE jsonb_typeof(value)
          WHEN 'string' THEN value #>> '{}'
          WHEN 'object' THEN value->>'media_id'
          ELSE NULL
        END
        FROM jsonb_each(NEW.value)
      LOOP
        PERFORM assert_active_media_reference(reference_id);
      END LOOP;
    ELSIF NEW.key = 'default_media_targets' AND jsonb_typeof(NEW.value) = 'array' THEN
      FOR reference_id IN
        SELECT CASE jsonb_typeof(value->'media_id')
          WHEN 'string' THEN value->>'media_id'
          WHEN 'object' THEN value->'media_id'->>'media_id'
          ELSE NULL
        END
        FROM jsonb_array_elements(NEW.value)
      LOOP
        PERFORM assert_active_media_reference(reference_id);
      END LOOP;
    ELSIF NEW.key = 'org.branding' AND jsonb_typeof(NEW.value) = 'object' THEN
      PERFORM assert_active_media_reference(NEW.value->>'logo_media_id');
      PERFORM assert_active_media_reference(NEW.value->>'icon_media_id');
      PERFORM assert_active_media_reference(NEW.value->>'favicon_media_id');
    END IF;
  ELSIF TG_TABLE_NAME = 'proof_of_play' THEN
    PERFORM lock_historical_media_reference(NEW.media_id::text);
  ELSIF TG_TABLE_NAME = 'media' THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND (
      EXISTS (SELECT 1 FROM chat_attachments WHERE media_asset_id = NEW.id)
      OR EXISTS (SELECT 1 FROM chat_bookmarks WHERE media_asset_id = NEW.id)
      OR EXISTS (SELECT 1 FROM presentation_items WHERE media_id = NEW.id)
      OR EXISTS (SELECT 1 FROM presentation_slot_items WHERE media_id = NEW.id)
      OR EXISTS (SELECT 1 FROM screens WHERE current_media_id = NEW.id)
      OR EXISTS (SELECT 1 FROM emergencies WHERE media_id = NEW.id)
      OR EXISTS (SELECT 1 FROM emergency_types WHERE media_id = NEW.id)
      OR EXISTS (SELECT 1 FROM proof_of_play WHERE media_id = NEW.id)
      OR EXISTS (
        SELECT 1 FROM settings
        WHERE setting_references_media(key, value, NEW.id::text)
      )
    ) THEN
      RAISE EXCEPTION 'Media is referenced and cannot be deleted' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER media_reference_delete_guard BEFORE UPDATE OF deleted_at ON media FOR EACH ROW EXECUTE FUNCTION validate_media_reference_change();

CREATE TRIGGER presentation_items_media_guard BEFORE INSERT OR UPDATE OF media_id ON presentation_items FOR EACH ROW EXECUTE FUNCTION validate_media_reference_change();
CREATE TRIGGER presentation_slot_items_media_guard BEFORE INSERT OR UPDATE OF media_id ON presentation_slot_items FOR EACH ROW EXECUTE FUNCTION validate_media_reference_change();
CREATE TRIGGER chat_attachments_media_guard BEFORE INSERT OR UPDATE OF media_asset_id ON chat_attachments FOR EACH ROW EXECUTE FUNCTION validate_media_reference_change();
CREATE TRIGGER chat_bookmarks_media_guard BEFORE INSERT OR UPDATE OF media_asset_id ON chat_bookmarks FOR EACH ROW EXECUTE FUNCTION validate_media_reference_change();
CREATE TRIGGER screens_media_guard BEFORE INSERT OR UPDATE OF current_media_id ON screens FOR EACH ROW EXECUTE FUNCTION validate_media_reference_change();
CREATE TRIGGER emergencies_media_guard BEFORE INSERT OR UPDATE OF media_id ON emergencies FOR EACH ROW EXECUTE FUNCTION validate_media_reference_change();
CREATE TRIGGER emergency_types_media_guard BEFORE INSERT OR UPDATE OF media_id ON emergency_types FOR EACH ROW EXECUTE FUNCTION validate_media_reference_change();
CREATE TRIGGER settings_media_guard BEFORE INSERT OR UPDATE OF key, value ON settings FOR EACH ROW EXECUTE FUNCTION validate_media_reference_change();

-- PoP is historical evidence rather than authoring. Order it with deletion per
-- Media row, but allow a late event after deletion instead of discarding an
-- already completed playback transition.
CREATE TRIGGER proof_of_play_media_guard BEFORE INSERT OR UPDATE OF media_id ON proof_of_play FOR EACH ROW EXECUTE FUNCTION validate_media_reference_change();
