-- Existing records have no reliable completion outcome in PostgreSQL.
-- Preserve them as unknown; new telemetry writes the player-reported flag.
ALTER TABLE "proof_of_play"
ADD COLUMN "completed" boolean;
