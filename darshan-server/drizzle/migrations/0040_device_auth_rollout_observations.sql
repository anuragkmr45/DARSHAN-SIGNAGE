CREATE TABLE IF NOT EXISTS "device_auth_rollout_observations" (
  "screen_id" uuid PRIMARY KEY NOT NULL REFERENCES "screens"("id") ON DELETE CASCADE,
  "last_signed_http_at" timestamp,
  "last_signed_socket_at" timestamp,
  "last_legacy_http_at" timestamp,
  "last_legacy_socket_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_auth_rollout_observations_updated_idx"
  ON "device_auth_rollout_observations" ("updated_at");
