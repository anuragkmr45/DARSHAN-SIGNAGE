CREATE TABLE IF NOT EXISTS "darshan_schema_migrations" (
  "migration_id" varchar(255) PRIMARY KEY NOT NULL,
  "checksum_sha256" varchar(64) NOT NULL,
  "release_id" varchar(128) NOT NULL,
  "applied_method" varchar(16) NOT NULL DEFAULT 'APPLIED',
  "approval_ticket" varchar(128),
  "applied_at" timestamp NOT NULL DEFAULT now()
);
