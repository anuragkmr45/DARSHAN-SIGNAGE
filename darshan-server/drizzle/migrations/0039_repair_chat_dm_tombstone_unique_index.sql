-- The initial source-derived production baseline accidentally omitted this
-- predicate. Recreate the index so deleted DM tombstones do not prevent a
-- user pair from creating a new active DM. Existing live databases receive
-- the same repair through the migration ledger.
DROP INDEX IF EXISTS "chat_conversations_dm_pair_key_active_idx";
---> statement-breakpoint
DROP INDEX IF EXISTS "chat_conversations_dm_pair_key_idx";
---> statement-breakpoint
CREATE UNIQUE INDEX "chat_conversations_dm_pair_key_active_idx"
ON "chat_conversations" ("dm_pair_key")
WHERE "type" = 'DM' AND "state" <> 'DELETED';
