CREATE TABLE IF NOT EXISTS "worker_runtime_heartbeats" (
  "id" varchar(256) PRIMARY KEY NOT NULL,
  "deployment_id" varchar(128) NOT NULL,
  "server_id" varchar(128) NOT NULL,
  "release_id" varchar(128) NOT NULL,
  "observed_at" timestamp NOT NULL DEFAULT now(),
  "started_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "worker_runtime_heartbeats_deployment_updated_idx"
  ON "worker_runtime_heartbeats" ("deployment_id", "updated_at");
