ALTER TABLE publish_targets
  ADD COLUMN IF NOT EXISTS resolved_screen_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];
--> statement-breakpoint
ALTER TABLE publish_targets
  ADD COLUMN IF NOT EXISTS applied_at timestamp;
--> statement-breakpoint
ALTER TABLE proof_of_play
  ADD COLUMN IF NOT EXISTS publish_id uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS proof_of_play_publish_id_idx ON proof_of_play (publish_id);
