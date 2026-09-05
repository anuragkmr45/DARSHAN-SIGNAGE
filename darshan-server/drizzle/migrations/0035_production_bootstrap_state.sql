CREATE TABLE IF NOT EXISTS "production_bootstrap_states" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "bootstrap_version" varchar(64) NOT NULL,
  "admin_user_id" uuid NOT NULL,
  "release_id" varchar(128) NOT NULL,
  "completed_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
