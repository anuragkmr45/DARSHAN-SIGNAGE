CREATE TABLE IF NOT EXISTS "darshan_deployment_runs" (
  "release_id" varchar(128) PRIMARY KEY NOT NULL,
  "site_name" varchar(128) NOT NULL,
  "role_manifest_sha256" varchar(64) NOT NULL,
  "mode" varchar(16) NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'RUNNING',
  "last_step" varchar(64) NOT NULL DEFAULT 'BEGIN',
  "approval_ticket" varchar(128),
  "started_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp,
  CONSTRAINT "darshan_deployment_runs_mode_check" CHECK ("mode" IN ('INSTALL', 'UPGRADE', 'ADOPT')),
  CONSTRAINT "darshan_deployment_runs_status_check" CHECK ("status" IN ('RUNNING', 'COMPLETE', 'FAILED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "darshan_deployment_runs_one_running_idx"
  ON "darshan_deployment_runs" ((status))
  WHERE "status" = 'RUNNING';
