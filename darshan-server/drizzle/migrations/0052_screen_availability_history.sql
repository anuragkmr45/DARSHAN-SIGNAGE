CREATE TABLE IF NOT EXISTS screen_availability_intervals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screen_id uuid NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  state varchar(16) NOT NULL CHECK (state IN ('ONLINE', 'OFFLINE')),
  source varchar(32) NOT NULL CHECK (source IN ('HEARTBEAT', 'EXPLICIT_OFFLINE', 'PLAYER_ERROR', 'STALE_TIMEOUT')),
  started_at timestamp NOT NULL,
  ended_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT screen_availability_interval_order CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS screen_availability_screen_started_idx
  ON screen_availability_intervals(screen_id, started_at);
CREATE INDEX IF NOT EXISTS screen_availability_range_idx
  ON screen_availability_intervals(started_at, ended_at);
CREATE UNIQUE INDEX IF NOT EXISTS screen_availability_one_open_per_screen_idx
  ON screen_availability_intervals(screen_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS backend_readiness_checkpoints (
  id varchar(256) PRIMARY KEY,
  deployment_id varchar(128) NOT NULL,
  server_id varchar(128) NOT NULL,
  observed_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS backend_readiness_observed_idx
  ON backend_readiness_checkpoints(observed_at);
