CREATE TABLE IF NOT EXISTS "media_cache_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "screen_id" uuid NOT NULL,
  "media_id" text,
  "event_type" varchar(80) NOT NULL,
  "severity" varchar(20) NOT NULL DEFAULT 'ERROR',
  "source" varchar(80),
  "status" varchar(40) NOT NULL DEFAULT 'OPEN',
  "error_code" varchar(80),
  "http_status" integer,
  "message" text,
  "cache_key" text,
  "url_host" text,
  "url_path_hash" text,
  "snapshot_id" uuid,
  "schedule_id" uuid,
  "default_media_version" text,
  "playback_mode" varchar(40),
  "attempt_count" integer NOT NULL DEFAULT 1,
  "metadata" jsonb,
  "reported_at" timestamp NOT NULL,
  "received_at" timestamp NOT NULL DEFAULT now(),
  "resolved_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "media_cache_reports_screen_reported_idx"
  ON "media_cache_reports" ("screen_id", "reported_at");

CREATE INDEX IF NOT EXISTS "media_cache_reports_media_reported_idx"
  ON "media_cache_reports" ("media_id", "reported_at");

CREATE INDEX IF NOT EXISTS "media_cache_reports_status_severity_reported_idx"
  ON "media_cache_reports" ("status", "severity", "reported_at");

CREATE INDEX IF NOT EXISTS "media_cache_reports_event_reported_idx"
  ON "media_cache_reports" ("event_type", "reported_at");
