ALTER TABLE "backup_runs"
  ADD COLUMN IF NOT EXISTS "off_host_manifest" jsonb;
