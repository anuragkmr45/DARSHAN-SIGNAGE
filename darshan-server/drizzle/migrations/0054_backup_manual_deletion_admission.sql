ALTER TABLE "backup_retention_operations"
  ADD COLUMN "requested_by" uuid,
  ADD COLUMN "request_action" varchar(32),
  ADD COLUMN "idempotency_key" varchar(200);
--> statement-breakpoint
ALTER TABLE "backup_retention_operations"
  ADD CONSTRAINT "backup_retention_operations_requested_by_fk"
  FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "backup_retention_operations"
  ADD CONSTRAINT "backup_retention_operations_request_metadata_check"
  CHECK (("operation_kind" = 'MANUAL_DELETE'
          AND "requested_by" IS NOT NULL AND "request_action" = 'delete')
      OR ("operation_kind" = 'AUTOMATIC_RETENTION'
          AND "requested_by" IS NULL AND "request_action" IS NULL AND "idempotency_key" IS NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX "backup_retention_operations_request_idempotency_unique"
  ON "backup_retention_operations" ("requested_by", "request_action", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
