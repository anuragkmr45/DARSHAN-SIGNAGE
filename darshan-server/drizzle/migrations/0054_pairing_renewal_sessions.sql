ALTER TABLE device_pairings ADD COLUMN IF NOT EXISTS retired_reason varchar(40);
--> statement-breakpoint
ALTER TABLE device_pairings ADD COLUMN IF NOT EXISTS renewal_request_id uuid;
--> statement-breakpoint
ALTER TABLE device_pairings ADD COLUMN IF NOT EXISTS generation integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS device_pairing_sessions (
  device_id uuid PRIMARY KEY,
  credential_hash varchar(64) NOT NULL UNIQUE,
  generation integer NOT NULL DEFAULT 0,
  revoked_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY device_id
    ORDER BY (expires_at > now()) DESC, created_at DESC, id DESC
  ) AS position
  FROM device_pairings
  WHERE used = false AND device_id IS NOT NULL
)
UPDATE device_pairings AS pairing
SET used = true, used_at = now(), retired_reason = 'MIGRATION_SUPERSEDED'
FROM ranked
WHERE pairing.id = ranked.id AND ranked.position > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS device_pairings_active_device_idx
  ON device_pairings (device_id) WHERE used = false AND device_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS device_pairings_renewal_request_idx
  ON device_pairings (device_id, renewal_request_id) WHERE renewal_request_id IS NOT NULL;
