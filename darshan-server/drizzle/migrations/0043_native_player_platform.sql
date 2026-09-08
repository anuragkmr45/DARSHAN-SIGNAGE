CREATE TABLE IF NOT EXISTS "device_installations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "screen_id" uuid NOT NULL,
  "installation_id" uuid NOT NULL,
  "installation_epoch" integer NOT NULL DEFAULT 1,
  "client_kind" varchar(32) NOT NULL,
  "platform" varchar(32) NOT NULL,
  "runtime_profile" varchar(64) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'PENDING',
  "capability_hash" varchar(64),
  "capability_manifest" jsonb,
  "first_seen_at" timestamp NOT NULL DEFAULT now(),
  "last_seen_at" timestamp NOT NULL DEFAULT now(),
  "revoked_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "device_installations_epoch_check" CHECK ("installation_epoch" > 0),
  CONSTRAINT "device_installations_status_check" CHECK ("status" IN ('PENDING', 'ACTIVE', 'REVOKED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_installations_installation_epoch_idx"
  ON "device_installations" ("installation_id", "installation_epoch");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_installations_screen_id_idx"
  ON "device_installations" ("screen_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_installations_capability_hash_idx"
  ON "device_installations" ("capability_hash");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "device_credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "credential_id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "screen_id" uuid NOT NULL,
  "installation_id" uuid NOT NULL,
  "installation_epoch" integer NOT NULL,
  "algorithm" varchar(32) NOT NULL,
  "public_key_pem" text NOT NULL,
  "auth_version" varchar(32) NOT NULL DEFAULT 'signature_v2',
  "trust_level" varchar(32) NOT NULL DEFAULT 'UNVERIFIED',
  "attestation_type" varchar(32),
  "attestation_evidence" jsonb,
  "is_revoked" boolean NOT NULL DEFAULT false,
  "expires_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "rotated_at" timestamp,
  "revoked_at" timestamp,
  CONSTRAINT "device_credentials_epoch_check" CHECK ("installation_epoch" > 0),
  CONSTRAINT "device_credentials_algorithm_check" CHECK ("algorithm" IN ('ES256')),
  CONSTRAINT "device_credentials_trust_check" CHECK ("trust_level" IN ('UNVERIFIED', 'SOFTWARE_KEY', 'HARDWARE_KEY', 'PLAY_INTEGRITY_VERIFIED', 'APP_ATTEST_VERIFIED', 'REVOKED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_credentials_credential_id_idx"
  ON "device_credentials" ("credential_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_credentials_active_installation_idx"
  ON "device_credentials" ("installation_id", "installation_epoch", "is_revoked");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_credentials_screen_id_idx"
  ON "device_credentials" ("screen_id", "is_revoked");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "device_auth_nonces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "credential_id" uuid NOT NULL,
  "nonce" varchar(128) NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_auth_nonces_credential_nonce_idx"
  ON "device_auth_nonces" ("credential_id", "nonce");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_auth_nonces_expires_at_idx"
  ON "device_auth_nonces" ("expires_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "device_capability_observations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "screen_id" uuid NOT NULL,
  "installation_id" uuid NOT NULL,
  "capability_hash" varchar(64) NOT NULL,
  "capability_manifest" jsonb NOT NULL,
  "observed_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_capability_observations_screen_observed_idx"
  ON "device_capability_observations" ("screen_id", "observed_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_capability_observations_installation_hash_idx"
  ON "device_capability_observations" ("installation_id", "capability_hash");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "device_push_endpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "screen_id" uuid NOT NULL,
  "installation_id" uuid NOT NULL,
  "provider" varchar(32) NOT NULL,
  "token" text NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'ACTIVE',
  "last_seen_at" timestamp NOT NULL DEFAULT now(),
  "invalidated_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "device_push_endpoints_status_check" CHECK ("status" IN ('ACTIVE', 'INVALIDATED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_push_endpoints_provider_token_idx"
  ON "device_push_endpoints" ("provider", "token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_push_endpoints_screen_status_idx"
  ON "device_push_endpoints" ("screen_id", "status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "media_renditions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "media_id" uuid NOT NULL,
  "source_revision" varchar(128) NOT NULL,
  "role" varchar(64) NOT NULL,
  "state" varchar(32) NOT NULL DEFAULT 'PENDING',
  "mime_type" varchar(255) NOT NULL,
  "container" varchar(64),
  "codecs" varchar(128)[] NOT NULL DEFAULT '{}',
  "width" integer,
  "height" integer,
  "frame_rate_milli" integer,
  "bitrate" integer,
  "size_bytes" bigint,
  "sha256" varchar(64),
  "bucket" varchar(255),
  "object_key" varchar(1024),
  "required_capabilities" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "page_manifest" jsonb,
  "capture_expires_at" timestamp,
  "failure_reason" varchar(120),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "media_renditions_state_check" CHECK ("state" IN ('PENDING', 'PROCESSING', 'READY', 'FAILED')),
  CONSTRAINT "media_renditions_sha256_check" CHECK ("sha256" IS NULL OR "sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_renditions_source_role_idx"
  ON "media_renditions" ("media_id", "source_revision", "role");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_renditions_media_state_idx"
  ON "media_renditions" ("media_id", "state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_renditions_sha256_idx"
  ON "media_renditions" ("sha256");
