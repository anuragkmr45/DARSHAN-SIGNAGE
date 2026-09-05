-- The original table accidentally used an array for name and a scalar for
-- event_types. Preserve all name entries and turn the scalar event into one
-- array element; PostgreSQL cannot perform either conversion implicitly.
ALTER TABLE "webhook_subscriptions"
  ALTER COLUMN "name" SET DATA TYPE varchar(255) USING array_to_string("name", ', ');--> statement-breakpoint
ALTER TABLE "webhook_subscriptions"
  ALTER COLUMN "event_types" SET DATA TYPE text[] USING ARRAY["event_types"];
