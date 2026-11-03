-- Support paginated Screen Group membership discovery without loading the full fleet.
CREATE INDEX IF NOT EXISTS screen_group_members_screen_id_idx
  ON screen_group_members (screen_id);
