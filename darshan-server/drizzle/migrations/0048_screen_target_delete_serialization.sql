-- Serialize deletion with every table that can introduce a live screen/group
-- reference, including writes made by an older application node or a job.
-- The delete APIs take the same lock before reading references.
-- Statement triggers acquire it before PostgreSQL takes an UPDATE/DELETE
-- tuple lock; row triggers below then validate the specific new references.
CREATE OR REPLACE FUNCTION lock_screen_target_reference_statement()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('darshan_screen_target_references_v1'));
  RETURN NULL;
END;
$$;

CREATE TRIGGER schedule_items_target_statement_lock BEFORE INSERT OR UPDATE OR DELETE ON schedule_items FOR EACH STATEMENT EXECUTE FUNCTION lock_screen_target_reference_statement();
CREATE TRIGGER publish_targets_target_statement_lock BEFORE INSERT OR UPDATE OR DELETE ON publish_targets FOR EACH STATEMENT EXECUTE FUNCTION lock_screen_target_reference_statement();
CREATE TRIGGER publishes_target_statement_lock BEFORE INSERT OR UPDATE OR DELETE ON publishes FOR EACH STATEMENT EXECUTE FUNCTION lock_screen_target_reference_statement();
CREATE TRIGGER schedules_target_statement_lock BEFORE INSERT OR UPDATE OR DELETE ON schedules FOR EACH STATEMENT EXECUTE FUNCTION lock_screen_target_reference_statement();
CREATE TRIGGER schedule_reservations_target_statement_lock BEFORE INSERT OR UPDATE OR DELETE ON schedule_reservations FOR EACH STATEMENT EXECUTE FUNCTION lock_screen_target_reference_statement();
CREATE TRIGGER emergencies_target_statement_lock BEFORE INSERT OR UPDATE OR DELETE ON emergencies FOR EACH STATEMENT EXECUTE FUNCTION lock_screen_target_reference_statement();
CREATE TRIGGER screen_group_members_target_statement_lock BEFORE INSERT OR UPDATE OR DELETE ON screen_group_members FOR EACH STATEMENT EXECUTE FUNCTION lock_screen_target_reference_statement();
CREATE TRIGGER settings_target_statement_lock BEFORE INSERT OR UPDATE OR DELETE ON settings FOR EACH STATEMENT EXECUTE FUNCTION lock_screen_target_reference_statement();

CREATE OR REPLACE FUNCTION lock_screen_target_reference_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('darshan_screen_target_references_v1'));
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'schedule_items' OR TG_TABLE_NAME = 'emergencies' THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(NEW.screen_ids) AS target(id)
      WHERE NOT EXISTS (SELECT 1 FROM screens WHERE screens.id::text = target.id)
    ) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(NEW.screen_group_ids) AS target(id)
      WHERE NOT EXISTS (SELECT 1 FROM screen_groups WHERE screen_groups.id::text = target.id)
    ) THEN
      RAISE EXCEPTION 'Screen or group target no longer exists' USING ERRCODE = '23503';
    END IF;
  ELSIF TG_TABLE_NAME = 'publish_targets' THEN
    IF (NEW.screen_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM screens WHERE id = NEW.screen_id))
      OR (NEW.screen_group_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM screen_groups WHERE id = NEW.screen_group_id)) THEN
      RAISE EXCEPTION 'Publish target no longer exists' USING ERRCODE = '23503';
    END IF;
  ELSIF TG_TABLE_NAME = 'schedule_reservations' THEN
    IF NOT EXISTS (SELECT 1 FROM screens WHERE id = NEW.screen_id) THEN
      RAISE EXCEPTION 'Reservation screen no longer exists' USING ERRCODE = '23503';
    END IF;
  ELSIF TG_TABLE_NAME = 'screen_group_members' THEN
    IF NOT EXISTS (SELECT 1 FROM screens WHERE id = NEW.screen_id)
      OR NOT EXISTS (SELECT 1 FROM screen_groups WHERE id = NEW.group_id) THEN
      RAISE EXCEPTION 'Group member target no longer exists' USING ERRCODE = '23503';
    END IF;
  ELSIF TG_TABLE_NAME = 'settings' THEN
    IF NEW.key = 'default_media_targets' AND (jsonb_typeof(NEW.value) <> 'array' OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.value) AS target(value)
      WHERE (target.value->>'target_type' = 'SCREEN'
          AND NOT EXISTS (SELECT 1 FROM screens WHERE id::text = target.value->>'target_id'))
         OR (target.value->>'target_type' = 'GROUP'
          AND NOT EXISTS (SELECT 1 FROM screen_groups WHERE id::text = target.value->>'target_id'))
    )) THEN
      RAISE EXCEPTION 'Default media target no longer exists' USING ERRCODE = '23503';
    END IF;
  ELSIF TG_TABLE_NAME = 'publishes' THEN
    IF NEW.status = 'ACTIVE' AND EXISTS (
      SELECT 1 FROM publish_targets AS target WHERE target.publish_id = NEW.id
        AND ((target.screen_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM screens WHERE id = target.screen_id))
          OR (target.screen_group_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM screen_groups WHERE id = target.screen_group_id)))
    ) THEN
      RAISE EXCEPTION 'Active publish target no longer exists' USING ERRCODE = '23503';
    END IF;
  ELSIF TG_TABLE_NAME = 'schedules' THEN
    IF NEW.end_at > now() AND EXISTS (
      SELECT 1 FROM schedule_items AS item WHERE item.schedule_id = NEW.id AND item.end_at > now()
        AND (EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(item.screen_ids) AS target(id)
          WHERE NOT EXISTS (SELECT 1 FROM screens WHERE screens.id::text = target.id)
        ) OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(item.screen_group_ids) AS target(id)
          WHERE NOT EXISTS (SELECT 1 FROM screen_groups WHERE screen_groups.id::text = target.id)
        ))
    ) THEN
      RAISE EXCEPTION 'Schedule target no longer exists' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER schedule_items_target_reference_lock
  BEFORE INSERT OR UPDATE OF screen_ids, screen_group_ids, start_at, end_at OR DELETE ON schedule_items
  FOR EACH ROW EXECUTE FUNCTION lock_screen_target_reference_change();
CREATE TRIGGER publish_targets_target_reference_lock
  BEFORE INSERT OR UPDATE OF screen_id, screen_group_id OR DELETE ON publish_targets
  FOR EACH ROW EXECUTE FUNCTION lock_screen_target_reference_change();
CREATE TRIGGER publishes_target_reference_lock
  BEFORE INSERT OR UPDATE OF status OR DELETE ON publishes
  FOR EACH ROW EXECUTE FUNCTION lock_screen_target_reference_change();
CREATE TRIGGER schedules_target_reference_lock
  BEFORE INSERT OR UPDATE OF end_at, is_active OR DELETE ON schedules
  FOR EACH ROW EXECUTE FUNCTION lock_screen_target_reference_change();
CREATE TRIGGER schedule_reservations_target_reference_lock
  BEFORE INSERT OR UPDATE OF screen_id, state, end_at OR DELETE ON schedule_reservations
  FOR EACH ROW EXECUTE FUNCTION lock_screen_target_reference_change();
CREATE TRIGGER emergencies_target_reference_lock
  BEFORE INSERT OR UPDATE OF screen_ids, screen_group_ids, target_all, is_active, expires_at OR DELETE ON emergencies
  FOR EACH ROW EXECUTE FUNCTION lock_screen_target_reference_change();
CREATE TRIGGER screen_group_members_target_reference_lock
  BEFORE INSERT OR UPDATE OF screen_id, group_id OR DELETE ON screen_group_members
  FOR EACH ROW EXECUTE FUNCTION lock_screen_target_reference_change();
CREATE TRIGGER settings_target_reference_lock
  BEFORE INSERT OR UPDATE OF key, value OR DELETE ON settings
  FOR EACH ROW EXECUTE FUNCTION lock_screen_target_reference_change();
