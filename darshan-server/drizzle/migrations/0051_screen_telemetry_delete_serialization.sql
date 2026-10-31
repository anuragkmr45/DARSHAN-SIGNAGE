-- The telemetry tables predate declarative Screen foreign keys. Serialize
-- their target validation with Screen deletion without taking a fleet-global
-- lock: concurrent writers for the same Screen share this row lock, while the
-- delete path's FOR UPDATE conflicts with it.
CREATE OR REPLACE FUNCTION lock_screen_telemetry_target()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM screens WHERE id = NEW.screen_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Telemetry Screen target no longer exists' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER heartbeats_screen_target_lock
  BEFORE INSERT OR UPDATE OF screen_id ON heartbeats
  FOR EACH ROW EXECUTE FUNCTION lock_screen_telemetry_target();

CREATE TRIGGER proof_of_play_screen_target_lock
  BEFORE INSERT OR UPDATE OF screen_id ON proof_of_play
  FOR EACH ROW EXECUTE FUNCTION lock_screen_telemetry_target();

CREATE TRIGGER screenshots_screen_target_lock
  BEFORE INSERT OR UPDATE OF screen_id ON screenshots
  FOR EACH ROW EXECUTE FUNCTION lock_screen_telemetry_target();
