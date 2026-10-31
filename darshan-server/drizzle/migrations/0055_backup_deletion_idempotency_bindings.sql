CREATE TABLE "backup_retention_request_idempotency" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "requested_by" uuid NOT NULL,
  "request_action" varchar(32) NOT NULL,
  "backup_run_id" uuid NOT NULL,
  "operation_id" uuid NOT NULL,
  "idempotency_key" varchar(200) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "backup_retention_request_idempotency_requested_by_fk"
    FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "backup_retention_request_idempotency_run_fk"
    FOREIGN KEY ("backup_run_id") REFERENCES "backup_runs"("id") ON DELETE RESTRICT,
  CONSTRAINT "backup_retention_request_idempotency_operation_fk"
    FOREIGN KEY ("operation_id") REFERENCES "backup_retention_operations"("id") ON DELETE RESTRICT,
  CONSTRAINT "backup_retention_request_idempotency_action_check"
    CHECK ("request_action" = 'delete')
);
--> statement-breakpoint
INSERT INTO "backup_retention_request_idempotency"
  ("requested_by", "request_action", "backup_run_id", "operation_id", "idempotency_key")
SELECT "requested_by", "request_action", "backup_run_id", "id", "idempotency_key"
  FROM "backup_retention_operations"
 WHERE "operation_kind" = 'MANUAL_DELETE'
   AND "requested_by" IS NOT NULL
   AND "request_action" = 'delete'
   AND "idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "backup_retention_request_idempotency_actor_key_unique"
  ON "backup_retention_request_idempotency" ("requested_by", "request_action", "idempotency_key");
--> statement-breakpoint
CREATE INDEX "backup_retention_request_idempotency_operation_idx"
  ON "backup_retention_request_idempotency" ("operation_id");
