ALTER TABLE media ADD COLUMN IF NOT EXISTS deleted_at timestamp;
ALTER TABLE media ADD COLUMN IF NOT EXISTS deleted_by uuid;
CREATE INDEX IF NOT EXISTS media_deleted_at_idx ON media (deleted_at);
