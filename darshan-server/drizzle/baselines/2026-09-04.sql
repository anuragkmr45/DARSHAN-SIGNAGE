--
-- PostgreSQL database dump
--


-- Dumped from database version 15.19
-- Dumped by pg_dump version 15.19

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: SCHEMA "public"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA "public" IS 'standard public schema';


--
-- Name: chat_bookmark_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."chat_bookmark_type" AS ENUM (
    'LINK',
    'FILE',
    'MESSAGE'
);


--
-- Name: chat_conversation_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."chat_conversation_state" AS ENUM (
    'ACTIVE',
    'ARCHIVED',
    'DELETED'
);


--
-- Name: chat_conversation_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."chat_conversation_type" AS ENUM (
    'DM',
    'GROUP_CLOSED',
    'FORUM_OPEN'
);


--
-- Name: chat_invite_policy; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."chat_invite_policy" AS ENUM (
    'ANY_MEMBER_CAN_INVITE',
    'ADMINS_ONLY_CAN_INVITE',
    'INVITES_DISABLED'
);


--
-- Name: chat_member_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."chat_member_role" AS ENUM (
    'OWNER',
    'CHAT_ADMIN',
    'MOD',
    'MEMBER'
);


--
-- Name: chat_revision_action; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."chat_revision_action" AS ENUM (
    'EDIT',
    'DELETE'
);


--
-- Name: command_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."command_status" AS ENUM (
    'PENDING',
    'SENT',
    'ACKNOWLEDGED',
    'COMPLETED',
    'FAILED',
    'LEASED',
    'PROCESSING',
    'ACKED_SUCCESS',
    'ACKED_FAILURE',
    'EXPIRED',
    'DEAD_LETTER',
    'CANCELLED'
);


--
-- Name: command_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."command_type" AS ENUM (
    'REBOOT',
    'REFRESH',
    'TEST_PATTERN',
    'TAKE_SCREENSHOT',
    'SET_SCREENSHOT_INTERVAL',
    'REFRESH_SCHEDULE',
    'SCREENSHOT',
    'CLEAR_CACHE',
    'PING',
    'RESYNC',
    'SET_ACTIVE_DISPLAY'
);


--
-- Name: media_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."media_status" AS ENUM (
    'PENDING',
    'PROCESSING',
    'READY',
    'FAILED'
);


--
-- Name: media_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."media_type" AS ENUM (
    'IMAGE',
    'VIDEO',
    'DOCUMENT',
    'WEBPAGE'
);


--
-- Name: publish_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."publish_status" AS ENUM (
    'ACTIVE',
    'TAKEN_DOWN'
);


--
-- Name: request_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."request_status" AS ENUM (
    'OPEN',
    'IN_PROGRESS',
    'PENDING_APPROVAL',
    'APPROVED',
    'REJECTED',
    'COMPLETED'
);


--
-- Name: schedule_request_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."schedule_request_status" AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'CANCELLED',
    'PUBLISHED',
    'TAKEN_DOWN',
    'EXPIRED'
);


--
-- Name: schedule_reservation_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."schedule_reservation_state" AS ENUM (
    'HELD',
    'RESERVED',
    'PUBLISHED',
    'RELEASED',
    'EXPIRED',
    'CANCELLED'
);


--
-- Name: screen_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."screen_status" AS ENUM (
    'ACTIVE',
    'INACTIVE',
    'OFFLINE'
);


SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."api_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "scopes" "text"[],
    "roles" "text"[],
    "token_prefix" character varying(12) NOT NULL,
    "secret_hash" character varying(255) NOT NULL,
    "created_by" "uuid" NOT NULL,
    "expires_at" timestamp without time zone,
    "is_revoked" boolean DEFAULT false NOT NULL,
    "last_used_at" timestamp without time zone,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "action" character varying(100) NOT NULL,
    "entity_type" character varying(100) NOT NULL,
    "entity_id" "uuid",
    "ip_address" character varying(45),
    "storage_object_id" "uuid",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: backup_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."backup_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "trigger_type" character varying(20) NOT NULL,
    "status" character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    "triggered_by" "uuid",
    "started_at" timestamp without time zone,
    "completed_at" timestamp without time zone,
    "error_message" "text",
    "files" "jsonb",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: chat_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."chat_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid" NOT NULL,
    "media_asset_id" "uuid" NOT NULL,
    "kind" character varying(50),
    "ord" integer DEFAULT 0 NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: chat_bookmarks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."chat_bookmarks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "type" "public"."chat_bookmark_type" NOT NULL,
    "label" character varying(255) NOT NULL,
    "emoji" character varying(32),
    "url" "text",
    "media_asset_id" "uuid",
    "message_id" "uuid",
    "created_by" "uuid" NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: chat_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."chat_conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "public"."chat_conversation_type" NOT NULL,
    "dm_pair_key" character varying(255),
    "title" character varying(255),
    "topic" "text",
    "purpose" "text",
    "created_by" "uuid" NOT NULL,
    "state" "public"."chat_conversation_state" DEFAULT 'ACTIVE'::"public"."chat_conversation_state" NOT NULL,
    "invite_policy" "public"."chat_invite_policy" DEFAULT 'ANY_MEMBER_CAN_INVITE'::"public"."chat_invite_policy" NOT NULL,
    "last_seq" bigint DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp without time zone,
    "deleted_at" timestamp without time zone
);


--
-- Name: chat_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."chat_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."chat_member_role" DEFAULT 'MEMBER'::"public"."chat_member_role" NOT NULL,
    "is_system" boolean DEFAULT false NOT NULL,
    "joined_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "left_at" timestamp without time zone,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: chat_message_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."chat_message_revisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid" NOT NULL,
    "editor_id" "uuid" NOT NULL,
    "action" "public"."chat_revision_action" NOT NULL,
    "old_body_text" "text",
    "old_body_rich" "jsonb",
    "new_body_text" "text",
    "new_body_rich" "jsonb",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."chat_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "seq" bigint NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "body_text" "text",
    "body_rich" "jsonb",
    "also_to_channel" boolean DEFAULT false NOT NULL,
    "reply_to_message_id" "uuid",
    "thread_root_id" "uuid",
    "thread_reply_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "edited_at" timestamp without time zone,
    "deleted_at" timestamp without time zone
);


--
-- Name: chat_moderation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."chat_moderation" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "muted_until" timestamp without time zone,
    "banned_until" timestamp without time zone,
    "reason" "text",
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: chat_pins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."chat_pins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "message_id" "uuid" NOT NULL,
    "pinned_by" "uuid" NOT NULL,
    "pinned_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: chat_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."chat_reactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "emoji" character varying(64) NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: chat_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."chat_receipts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "last_read_seq" bigint DEFAULT 0 NOT NULL,
    "last_delivered_seq" bigint DEFAULT 0 NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: command_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."command_outbox" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "screen_id" "uuid" NOT NULL,
    "command_id" "uuid",
    "event_type" character varying(80) NOT NULL,
    "reason" "text",
    "payload" "jsonb",
    "status" character varying(40) DEFAULT 'PENDING'::character varying NOT NULL,
    "priority" integer DEFAULT 0 NOT NULL,
    "available_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "next_attempt_at" timestamp without time zone,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 5 NOT NULL,
    "dispatched_at" timestamp without time zone,
    "last_error" "text",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: conversation_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."conversation_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "attachments" "jsonb",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: conversation_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."conversation_reads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "last_read_at" timestamp without time zone,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "participant_a" "uuid" NOT NULL,
    "participant_b" "uuid" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: darshan_schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."darshan_schema_migrations" (
    "migration_id" character varying(255) NOT NULL,
    "checksum_sha256" character varying(64) NOT NULL,
    "release_id" character varying(128) NOT NULL,
    "applied_method" character varying(16) DEFAULT 'APPLIED'::character varying NOT NULL,
    "approval_ticket" character varying(128),
    "applied_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."departments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" "text",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: device_certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."device_certificates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "screen_id" "uuid" NOT NULL,
    "serial" character varying(255) NOT NULL,
    "certificate_pem" "text" NOT NULL,
    "public_key_pem" "text",
    "auth_version" character varying(32) DEFAULT 'legacy'::character varying NOT NULL,
    "is_revoked" boolean DEFAULT false NOT NULL,
    "expires_at" timestamp without time zone NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp without time zone
);


--
-- Name: device_command_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."device_command_status_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "command_id" "uuid" NOT NULL,
    "screen_id" "uuid" NOT NULL,
    "old_status" "public"."command_status",
    "new_status" "public"."command_status" NOT NULL,
    "reason" "text",
    "attempt_count" integer,
    "delivery_token" "uuid",
    "metadata" "jsonb",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: device_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."device_commands" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "screen_id" "uuid" NOT NULL,
    "type" "public"."command_type" NOT NULL,
    "status" "public"."command_status" DEFAULT 'PENDING'::"public"."command_status" NOT NULL,
    "payload" "jsonb",
    "delivery_token" "uuid",
    "claimed_at" timestamp without time zone,
    "acknowledged_at" timestamp without time zone,
    "delivery_attempts" integer DEFAULT 0 NOT NULL,
    "priority" integer DEFAULT 0 NOT NULL,
    "expires_at" timestamp without time zone,
    "lease_expires_at" timestamp without time zone,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 5 NOT NULL,
    "last_error" "text",
    "result_payload" "jsonb",
    "correlation_id" "uuid",
    "idempotency_key" "text",
    "desired_snapshot_id" "uuid",
    "desired_default_media_version" "text",
    "desired_emergency_version" "text",
    "completed_at" timestamp without time zone,
    "cancelled_at" timestamp without time zone,
    "dead_lettered_at" timestamp without time zone,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: device_desired_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."device_desired_state" (
    "screen_id" "uuid" NOT NULL,
    "snapshot_id" "uuid",
    "default_media_version" "text",
    "emergency_version" "text",
    "command_version" bigint DEFAULT 0 NOT NULL,
    "state_version" bigint DEFAULT 1 NOT NULL,
    "last_command_id" "uuid",
    "last_command_type" character varying(80),
    "last_command_reason" "text",
    "last_changed_reason" "text",
    "metadata" "jsonb",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: device_desired_state_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."device_desired_state_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "screen_id" "uuid" NOT NULL,
    "state_version" bigint NOT NULL,
    "command_version" bigint NOT NULL,
    "snapshot_id" "uuid",
    "default_media_version" "text",
    "emergency_version" "text",
    "command_id" "uuid",
    "reason" "text",
    "metadata" "jsonb",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: device_pairings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."device_pairings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "device_id" "uuid",
    "pairing_code" character varying(255) NOT NULL,
    "used" boolean DEFAULT false NOT NULL,
    "used_at" timestamp without time zone,
    "expires_at" timestamp without time zone NOT NULL,
    "width" integer,
    "height" integer,
    "aspect_ratio" character varying(50),
    "orientation" character varying(50),
    "model" character varying(255),
    "codecs" character varying(255)[],
    "device_info" "jsonb",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: emergencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."emergencies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "emergency_type_id" "uuid",
    "message" "text" NOT NULL,
    "priority" character varying(20) DEFAULT 'HIGH'::character varying NOT NULL,
    "media_id" "uuid",
    "screen_ids" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "screen_group_ids" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "target_all" boolean DEFAULT false NOT NULL,
    "expires_at" timestamp without time zone,
    "audit_note" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "triggered_by" "uuid",
    "triggered_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "cleared_by" "uuid",
    "cleared_at" timestamp without time zone,
    "clear_reason" "text",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: emergency_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."emergency_status" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "triggered_by" "uuid",
    "triggered_at" timestamp without time zone,
    "cleared_by" "uuid",
    "cleared_at" timestamp without time zone,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: emergency_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."emergency_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" "text",
    "message" "text" NOT NULL,
    "severity" character varying(20) DEFAULT 'HIGH'::character varying NOT NULL,
    "media_id" "uuid",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: heartbeats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."heartbeats" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "screen_id" "uuid" NOT NULL,
    "status" character varying(20),
    "storage_object_id" "uuid",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: layouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."layouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" "text",
    "aspect_ratio" character varying(50) NOT NULL,
    "spec" "jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: log_archives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."log_archives" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "log_type" character varying(50) NOT NULL,
    "window_start" timestamp without time zone NOT NULL,
    "window_end" timestamp without time zone NOT NULL,
    "record_count" integer NOT NULL,
    "storage_object_id" "uuid" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: login_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."login_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" character varying(255) NOT NULL,
    "success" boolean NOT NULL,
    "ip_address" character varying(45),
    "storage_object_id" "uuid",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."media" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "type" "public"."media_type" NOT NULL,
    "status" "public"."media_status" DEFAULT 'PENDING'::"public"."media_status" NOT NULL,
    "source_object_id" "uuid",
    "source_bucket" character varying(255),
    "source_object_key" character varying(1024),
    "source_content_type" character varying(255),
    "source_size" integer,
    "source_url" "text",
    "ready_object_id" "uuid",
    "thumbnail_object_id" "uuid",
    "status_reason" character varying(120),
    "duration_seconds" integer,
    "width" integer,
    "height" integer,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: media_cache_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."media_cache_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "screen_id" "uuid" NOT NULL,
    "media_id" "text",
    "event_type" character varying(80) NOT NULL,
    "severity" character varying(20) DEFAULT 'ERROR'::character varying NOT NULL,
    "source" character varying(80),
    "status" character varying(40) DEFAULT 'OPEN'::character varying NOT NULL,
    "error_code" character varying(80),
    "http_status" integer,
    "message" "text",
    "cache_key" "text",
    "url_host" "text",
    "url_path_hash" "text",
    "snapshot_id" "uuid",
    "schedule_id" "uuid",
    "default_media_version" "text",
    "playback_mode" character varying(40),
    "attempt_count" integer DEFAULT 1 NOT NULL,
    "metadata" "jsonb",
    "reported_at" timestamp without time zone NOT NULL,
    "received_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp without time zone,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: media_upload_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."media_upload_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "media_id" "uuid" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "idempotency_key" character varying(255) NOT NULL,
    "state" character varying(32) DEFAULT 'INITIALIZING'::character varying NOT NULL,
    "strategy" character varying(16) NOT NULL,
    "original_filename" character varying(512) NOT NULL,
    "display_name" character varying(255) NOT NULL,
    "content_type" character varying(255) NOT NULL,
    "expected_size" integer NOT NULL,
    "checksum_sha256" character varying(64) NOT NULL,
    "part_size" integer,
    "staging_bucket" character varying(255) NOT NULL,
    "staging_object_key" character varying(1024) NOT NULL,
    "canonical_bucket" character varying(255) NOT NULL,
    "canonical_object_key" character varying(1024) NOT NULL,
    "multipart_upload_id" "text",
    "expires_at" timestamp without time zone NOT NULL,
    "completed_at" timestamp without time zone,
    "aborted_at" timestamp without time zone,
    "failure_reason" character varying(120),
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" character varying(255) NOT NULL,
    "message" "text",
    "type" character varying(32) DEFAULT 'INFO'::character varying NOT NULL,
    "data" "jsonb",
    "is_read" boolean DEFAULT false NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: presentation_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."presentation_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "presentation_id" "uuid" NOT NULL,
    "media_id" "uuid" NOT NULL,
    "order" integer NOT NULL,
    "duration_seconds" integer,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: presentation_slot_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."presentation_slot_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "presentation_id" "uuid" NOT NULL,
    "slot_id" character varying(255) NOT NULL,
    "media_id" "uuid" NOT NULL,
    "order" integer DEFAULT 0 NOT NULL,
    "duration_seconds" integer,
    "fit_mode" character varying(50),
    "audio_enabled" boolean DEFAULT false,
    "loop_enabled" boolean DEFAULT false,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: presentations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."presentations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" "text",
    "layout_id" "uuid",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: production_bootstrap_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."production_bootstrap_states" (
    "id" character varying(64) NOT NULL,
    "bootstrap_version" character varying(64) NOT NULL,
    "admin_user_id" "uuid" NOT NULL,
    "release_id" character varying(128) NOT NULL,
    "completed_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: proof_of_play; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."proof_of_play" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "screen_id" "uuid" NOT NULL,
    "media_id" "uuid",
    "presentation_id" "uuid",
    "schedule_id" "uuid",
    "scene_id" "text",
    "slot_id" character varying(255),
    "item_id" "text",
    "playback_instance_id" "uuid",
    "started_at" timestamp without time zone NOT NULL,
    "ended_at" timestamp without time zone,
    "storage_object_id" "uuid",
    "idempotency_key" character varying(64) NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: publish_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."publish_targets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "publish_id" "uuid" NOT NULL,
    "screen_id" "uuid",
    "screen_group_id" "uuid",
    "status" character varying(50) DEFAULT 'PENDING'::character varying NOT NULL,
    "error" "text",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: publishes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."publishes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "schedule_id" "uuid" NOT NULL,
    "snapshot_id" "uuid" NOT NULL,
    "published_by" "uuid" NOT NULL,
    "status" "public"."publish_status" DEFAULT 'ACTIVE'::"public"."publish_status" NOT NULL,
    "taken_down_at" timestamp without time zone,
    "taken_down_by" "uuid",
    "takedown_reason" "text",
    "published_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: request_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."request_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "request_id" "uuid" NOT NULL,
    "message_id" "uuid",
    "storage_object_id" "uuid" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: request_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."request_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "request_id" "uuid" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: request_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."request_status_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "request_id" "uuid" NOT NULL,
    "old_status" "public"."request_status",
    "new_status" "public"."request_status" NOT NULL,
    "changed_by" "uuid" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" character varying(255) NOT NULL,
    "description" "text",
    "status" "public"."request_status" DEFAULT 'OPEN'::"public"."request_status" NOT NULL,
    "priority" character varying(20) DEFAULT 'MEDIUM'::character varying,
    "created_by" "uuid" NOT NULL,
    "assigned_to" "uuid",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(100) NOT NULL,
    "description" "text",
    "permissions" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_system" boolean DEFAULT false NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: schedule_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."schedule_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "schedule_id" "uuid" NOT NULL,
    "presentation_id" "uuid" NOT NULL,
    "start_at" timestamp without time zone NOT NULL,
    "end_at" timestamp without time zone NOT NULL,
    "priority" integer DEFAULT 0 NOT NULL,
    "screen_ids" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "screen_group_ids" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: schedule_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."schedule_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "schedule_id" "uuid" NOT NULL,
    "schedule_payload" "jsonb" NOT NULL,
    "status" "public"."schedule_request_status" DEFAULT 'PENDING'::"public"."schedule_request_status" NOT NULL,
    "review_notes" "text",
    "notes" "text",
    "reservation_token" "uuid",
    "reservation_version" integer,
    "reservation_state" character varying(50),
    "hold_expires_at" timestamp without time zone,
    "published_at" timestamp without time zone,
    "taken_down_at" timestamp without time zone,
    "taken_down_by" "uuid",
    "takedown_reason" "text",
    "requested_by" "uuid" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp without time zone,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: schedule_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."schedule_reservations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "screen_id" "uuid" NOT NULL,
    "schedule_id" "uuid" NOT NULL,
    "schedule_item_id" "uuid" NOT NULL,
    "schedule_request_id" "uuid",
    "owner_user_id" "uuid" NOT NULL,
    "state" "public"."schedule_reservation_state" NOT NULL,
    "start_at" timestamp without time zone NOT NULL,
    "end_at" timestamp without time zone NOT NULL,
    "hold_expires_at" timestamp without time zone,
    "reservation_token" "uuid" NOT NULL,
    "reservation_version" integer DEFAULT 1 NOT NULL,
    "publish_id" "uuid",
    "approved_at" timestamp without time zone,
    "published_at" timestamp without time zone,
    "released_at" timestamp without time zone,
    "release_reason" "text",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: schedule_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."schedule_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "schedule_id" "uuid" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "storage_object_id" "uuid",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."schedules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" "text",
    "timezone" character varying(100),
    "start_at" timestamp without time zone NOT NULL,
    "end_at" timestamp without time zone NOT NULL,
    "revision" integer DEFAULT 1 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: screen_display_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."screen_display_states" (
    "screen_id" "uuid" NOT NULL,
    "desired_selection" "jsonb" DEFAULT '{"mode": "PRIMARY", "preferred_key": null}'::"jsonb" NOT NULL,
    "selection_version" integer DEFAULT 1 NOT NULL,
    "active_display_key" character varying(255),
    "placement" character varying(32) DEFAULT 'UNVERIFIED'::character varying NOT NULL,
    "display_profile" "jsonb",
    "profile_hash" character varying(64),
    "profile_revision" integer DEFAULT 0 NOT NULL,
    "runtime_session_id" character varying(64),
    "observation_seq" bigint DEFAULT 0 NOT NULL,
    "observed_at" timestamp without time zone,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: screen_group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."screen_group_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "screen_id" "uuid" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: screen_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."screen_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" "text",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: screens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."screens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "location" character varying(255),
    "aspect_ratio" character varying(50),
    "width" integer,
    "height" integer,
    "orientation" character varying(50),
    "device_info" "jsonb",
    "status" "public"."screen_status" DEFAULT 'OFFLINE'::"public"."screen_status" NOT NULL,
    "last_heartbeat_at" timestamp without time zone,
    "current_schedule_id" "uuid",
    "current_media_id" "uuid",
    "current_scene_id" "text",
    "active_slots" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "screenshot_interval_seconds" integer,
    "screenshot_enabled" boolean DEFAULT false NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: screenshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."screenshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "screen_id" "uuid" NOT NULL,
    "storage_object_id" "uuid" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "access_jti" character varying(255) NOT NULL,
    "expires_at" timestamp without time zone NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" character varying(255) NOT NULL,
    "value" "jsonb",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: sso_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."sso_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" character varying(50) DEFAULT 'oidc'::character varying NOT NULL,
    "issuer" character varying(255) NOT NULL,
    "client_id" character varying(255) NOT NULL,
    "client_secret" character varying(255) NOT NULL,
    "authorization_url" character varying(512),
    "token_url" character varying(512),
    "jwks_url" character varying(512),
    "redirect_uri" character varying(512),
    "scopes" "text"[],
    "is_active" boolean DEFAULT false NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: storage_objects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."storage_objects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bucket" character varying(255) NOT NULL,
    "object_key" character varying(1024) NOT NULL,
    "content_type" character varying(100),
    "size" integer,
    "sha256" character varying(64),
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: system_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."system_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "level" character varying(20) NOT NULL,
    "message" "text" NOT NULL,
    "context" "jsonb",
    "storage_object_id" "uuid",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: user_notification_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."user_notification_counters" (
    "user_id" "uuid" NOT NULL,
    "unread_total" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" character varying(255) NOT NULL,
    "password_hash" "text" NOT NULL,
    "first_name" character varying(100),
    "last_name" character varying(100),
    "role_id" "uuid" NOT NULL,
    "department_id" "uuid",
    "is_active" boolean DEFAULT true NOT NULL,
    "ext" "jsonb",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: webhook_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."webhook_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "event_types" "text"[] NOT NULL,
    "target_url" character varying(2048) NOT NULL,
    "secret" character varying(255) NOT NULL,
    "headers" "jsonb",
    "is_active" boolean DEFAULT true NOT NULL,
    "last_status" character varying(50),
    "last_status_at" timestamp without time zone,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id");


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");


--
-- Name: backup_runs backup_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."backup_runs"
    ADD CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id");


--
-- Name: chat_attachments chat_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."chat_attachments"
    ADD CONSTRAINT "chat_attachments_pkey" PRIMARY KEY ("id");


--
-- Name: chat_bookmarks chat_bookmarks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."chat_bookmarks"
    ADD CONSTRAINT "chat_bookmarks_pkey" PRIMARY KEY ("id");


--
-- Name: chat_conversations chat_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."chat_conversations"
    ADD CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id");


--
-- Name: chat_members chat_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."chat_members"
    ADD CONSTRAINT "chat_members_pkey" PRIMARY KEY ("id");


--
-- Name: chat_message_revisions chat_message_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."chat_message_revisions"
    ADD CONSTRAINT "chat_message_revisions_pkey" PRIMARY KEY ("id");


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id");


--
-- Name: chat_moderation chat_moderation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."chat_moderation"
    ADD CONSTRAINT "chat_moderation_pkey" PRIMARY KEY ("id");


--
-- Name: chat_pins chat_pins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."chat_pins"
    ADD CONSTRAINT "chat_pins_pkey" PRIMARY KEY ("id");


--
-- Name: chat_reactions chat_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."chat_reactions"
    ADD CONSTRAINT "chat_reactions_pkey" PRIMARY KEY ("id");


--
-- Name: chat_receipts chat_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."chat_receipts"
    ADD CONSTRAINT "chat_receipts_pkey" PRIMARY KEY ("id");


--
-- Name: command_outbox command_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."command_outbox"
    ADD CONSTRAINT "command_outbox_pkey" PRIMARY KEY ("id");


--
-- Name: conversation_messages conversation_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."conversation_messages"
    ADD CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id");


--
-- Name: conversation_reads conversation_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."conversation_reads"
    ADD CONSTRAINT "conversation_reads_pkey" PRIMARY KEY ("id");


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");


--
-- Name: darshan_schema_migrations darshan_schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."darshan_schema_migrations"
    ADD CONSTRAINT "darshan_schema_migrations_pkey" PRIMARY KEY ("migration_id");


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_pkey" PRIMARY KEY ("id");


--
-- Name: device_certificates device_certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."device_certificates"
    ADD CONSTRAINT "device_certificates_pkey" PRIMARY KEY ("id");


--
-- Name: device_certificates device_certificates_serial_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."device_certificates"
    ADD CONSTRAINT "device_certificates_serial_unique" UNIQUE ("serial");


--
-- Name: device_command_status_history device_command_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."device_command_status_history"
    ADD CONSTRAINT "device_command_status_history_pkey" PRIMARY KEY ("id");


--
-- Name: device_commands device_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."device_commands"
    ADD CONSTRAINT "device_commands_pkey" PRIMARY KEY ("id");


--
-- Name: device_desired_state_history device_desired_state_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."device_desired_state_history"
    ADD CONSTRAINT "device_desired_state_history_pkey" PRIMARY KEY ("id");


--
-- Name: device_desired_state device_desired_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."device_desired_state"
    ADD CONSTRAINT "device_desired_state_pkey" PRIMARY KEY ("screen_id");


--
-- Name: device_pairings device_pairings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."device_pairings"
    ADD CONSTRAINT "device_pairings_pkey" PRIMARY KEY ("id");


--
-- Name: emergencies emergencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."emergencies"
    ADD CONSTRAINT "emergencies_pkey" PRIMARY KEY ("id");


--
-- Name: emergency_status emergency_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."emergency_status"
    ADD CONSTRAINT "emergency_status_pkey" PRIMARY KEY ("id");


--
-- Name: emergency_types emergency_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."emergency_types"
    ADD CONSTRAINT "emergency_types_pkey" PRIMARY KEY ("id");


--
-- Name: heartbeats heartbeats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."heartbeats"
    ADD CONSTRAINT "heartbeats_pkey" PRIMARY KEY ("id");


--
-- Name: layouts layouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."layouts"
    ADD CONSTRAINT "layouts_pkey" PRIMARY KEY ("id");


--
-- Name: log_archives log_archives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."log_archives"
    ADD CONSTRAINT "log_archives_pkey" PRIMARY KEY ("id");


--
-- Name: login_attempts login_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."login_attempts"
    ADD CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id");


--
-- Name: media_cache_reports media_cache_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."media_cache_reports"
    ADD CONSTRAINT "media_cache_reports_pkey" PRIMARY KEY ("id");


--
-- Name: media media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."media"
    ADD CONSTRAINT "media_pkey" PRIMARY KEY ("id");


--
-- Name: media_upload_sessions media_upload_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."media_upload_sessions"
    ADD CONSTRAINT "media_upload_sessions_pkey" PRIMARY KEY ("id");


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");


--
-- Name: presentation_items presentation_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."presentation_items"
    ADD CONSTRAINT "presentation_items_pkey" PRIMARY KEY ("id");


--
-- Name: presentation_slot_items presentation_slot_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."presentation_slot_items"
    ADD CONSTRAINT "presentation_slot_items_pkey" PRIMARY KEY ("id");


--
-- Name: presentations presentations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."presentations"
    ADD CONSTRAINT "presentations_pkey" PRIMARY KEY ("id");


--
-- Name: production_bootstrap_states production_bootstrap_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."production_bootstrap_states"
    ADD CONSTRAINT "production_bootstrap_states_pkey" PRIMARY KEY ("id");


--
-- Name: proof_of_play proof_of_play_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."proof_of_play"
    ADD CONSTRAINT "proof_of_play_pkey" PRIMARY KEY ("id");


--
-- Name: publish_targets publish_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."publish_targets"
    ADD CONSTRAINT "publish_targets_pkey" PRIMARY KEY ("id");


--
-- Name: publishes publishes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."publishes"
    ADD CONSTRAINT "publishes_pkey" PRIMARY KEY ("id");


--
-- Name: request_attachments request_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."request_attachments"
    ADD CONSTRAINT "request_attachments_pkey" PRIMARY KEY ("id");


--
-- Name: request_messages request_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."request_messages"
    ADD CONSTRAINT "request_messages_pkey" PRIMARY KEY ("id");


--
-- Name: request_status_history request_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."request_status_history"
    ADD CONSTRAINT "request_status_history_pkey" PRIMARY KEY ("id");


--
-- Name: requests requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."requests"
    ADD CONSTRAINT "requests_pkey" PRIMARY KEY ("id");


--
-- Name: roles roles_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_name_unique" UNIQUE ("name");


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");


--
-- Name: schedule_items schedule_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."schedule_items"
    ADD CONSTRAINT "schedule_items_pkey" PRIMARY KEY ("id");


--
-- Name: schedule_requests schedule_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."schedule_requests"
    ADD CONSTRAINT "schedule_requests_pkey" PRIMARY KEY ("id");


--
-- Name: schedule_reservations schedule_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."schedule_reservations"
    ADD CONSTRAINT "schedule_reservations_pkey" PRIMARY KEY ("id");


--
-- Name: schedule_snapshots schedule_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."schedule_snapshots"
    ADD CONSTRAINT "schedule_snapshots_pkey" PRIMARY KEY ("id");


--
-- Name: schedules schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."schedules"
    ADD CONSTRAINT "schedules_pkey" PRIMARY KEY ("id");


--
-- Name: screen_display_states screen_display_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."screen_display_states"
    ADD CONSTRAINT "screen_display_states_pkey" PRIMARY KEY ("screen_id");


--
-- Name: screen_group_members screen_group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."screen_group_members"
    ADD CONSTRAINT "screen_group_members_pkey" PRIMARY KEY ("id");


--
-- Name: screen_groups screen_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."screen_groups"
    ADD CONSTRAINT "screen_groups_pkey" PRIMARY KEY ("id");


--
-- Name: screens screens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."screens"
    ADD CONSTRAINT "screens_pkey" PRIMARY KEY ("id");


--
-- Name: screenshots screenshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."screenshots"
    ADD CONSTRAINT "screenshots_pkey" PRIMARY KEY ("id");


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id");


--
-- Name: settings settings_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."settings"
    ADD CONSTRAINT "settings_key_unique" UNIQUE ("key");


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."settings"
    ADD CONSTRAINT "settings_pkey" PRIMARY KEY ("id");


--
-- Name: sso_configs sso_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."sso_configs"
    ADD CONSTRAINT "sso_configs_pkey" PRIMARY KEY ("id");


--
-- Name: storage_objects storage_objects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."storage_objects"
    ADD CONSTRAINT "storage_objects_pkey" PRIMARY KEY ("id");


--
-- Name: system_logs system_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."system_logs"
    ADD CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id");


--
-- Name: user_notification_counters user_notification_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."user_notification_counters"
    ADD CONSTRAINT "user_notification_counters_pkey" PRIMARY KEY ("user_id");


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_unique" UNIQUE ("email");


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");


--
-- Name: webhook_subscriptions webhook_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."webhook_subscriptions"
    ADD CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id");


--
-- Name: api_keys_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "api_keys_created_by_idx" ON "public"."api_keys" USING "btree" ("created_by");


--
-- Name: api_keys_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "api_keys_expires_at_idx" ON "public"."api_keys" USING "btree" ("expires_at");


--
-- Name: api_keys_token_prefix_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "api_keys_token_prefix_idx" ON "public"."api_keys" USING "btree" ("token_prefix");


--
-- Name: audit_logs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_logs_created_at_idx" ON "public"."audit_logs" USING "btree" ("created_at");


--
-- Name: audit_logs_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_logs_user_id_idx" ON "public"."audit_logs" USING "btree" ("user_id");


--
-- Name: backup_runs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "backup_runs_created_at_idx" ON "public"."backup_runs" USING "btree" ("created_at");


--
-- Name: backup_runs_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "backup_runs_status_idx" ON "public"."backup_runs" USING "btree" ("status");


--
-- Name: chat_attachments_media_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_attachments_media_idx" ON "public"."chat_attachments" USING "btree" ("media_asset_id");


--
-- Name: chat_attachments_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_attachments_message_idx" ON "public"."chat_attachments" USING "btree" ("message_id");


--
-- Name: chat_attachments_message_media_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "chat_attachments_message_media_idx" ON "public"."chat_attachments" USING "btree" ("message_id", "media_asset_id");


--
-- Name: chat_bookmarks_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_bookmarks_conversation_idx" ON "public"."chat_bookmarks" USING "btree" ("conversation_id");


--
-- Name: chat_bookmarks_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_bookmarks_created_by_idx" ON "public"."chat_bookmarks" USING "btree" ("created_by");


--
-- Name: chat_bookmarks_media_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_bookmarks_media_idx" ON "public"."chat_bookmarks" USING "btree" ("media_asset_id");


--
-- Name: chat_bookmarks_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_bookmarks_message_idx" ON "public"."chat_bookmarks" USING "btree" ("message_id");


--
-- Name: chat_conversations_dm_pair_key_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "chat_conversations_dm_pair_key_active_idx" ON "public"."chat_conversations" USING "btree" ("dm_pair_key") WHERE (("type" = 'DM'::"public"."chat_conversation_type") AND ("state" <> 'DELETED'::"public"."chat_conversation_state"));


--
-- Name: chat_conversations_state_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_conversations_state_type_idx" ON "public"."chat_conversations" USING "btree" ("state", "type");


--
-- Name: chat_conversations_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_conversations_updated_at_idx" ON "public"."chat_conversations" USING "btree" ("updated_at");


--
-- Name: chat_members_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_members_conversation_idx" ON "public"."chat_members" USING "btree" ("conversation_id");


--
-- Name: chat_members_conversation_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "chat_members_conversation_user_idx" ON "public"."chat_members" USING "btree" ("conversation_id", "user_id");


--
-- Name: chat_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_members_user_idx" ON "public"."chat_members" USING "btree" ("user_id");


--
-- Name: chat_message_revisions_editor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_message_revisions_editor_idx" ON "public"."chat_message_revisions" USING "btree" ("editor_id", "created_at");


--
-- Name: chat_message_revisions_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_message_revisions_message_idx" ON "public"."chat_message_revisions" USING "btree" ("message_id", "created_at");


--
-- Name: chat_messages_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_messages_conversation_idx" ON "public"."chat_messages" USING "btree" ("conversation_id");


--
-- Name: chat_messages_conversation_seq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "chat_messages_conversation_seq_idx" ON "public"."chat_messages" USING "btree" ("conversation_id", "seq");


--
-- Name: chat_messages_reply_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_messages_reply_to_idx" ON "public"."chat_messages" USING "btree" ("reply_to_message_id");


--
-- Name: chat_messages_thread_root_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_messages_thread_root_idx" ON "public"."chat_messages" USING "btree" ("thread_root_id");


--
-- Name: chat_moderation_conversation_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "chat_moderation_conversation_user_idx" ON "public"."chat_moderation" USING "btree" ("conversation_id", "user_id");


--
-- Name: chat_moderation_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_moderation_user_idx" ON "public"."chat_moderation" USING "btree" ("user_id");


--
-- Name: chat_pins_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_pins_conversation_idx" ON "public"."chat_pins" USING "btree" ("conversation_id");


--
-- Name: chat_pins_conversation_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "chat_pins_conversation_message_idx" ON "public"."chat_pins" USING "btree" ("conversation_id", "message_id");


--
-- Name: chat_pins_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_pins_message_idx" ON "public"."chat_pins" USING "btree" ("message_id");


--
-- Name: chat_reactions_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_reactions_message_idx" ON "public"."chat_reactions" USING "btree" ("message_id");


--
-- Name: chat_reactions_message_user_emoji_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "chat_reactions_message_user_emoji_idx" ON "public"."chat_reactions" USING "btree" ("message_id", "user_id", "emoji");


--
-- Name: chat_receipts_conversation_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "chat_receipts_conversation_user_idx" ON "public"."chat_receipts" USING "btree" ("conversation_id", "user_id");


--
-- Name: chat_receipts_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_receipts_user_idx" ON "public"."chat_receipts" USING "btree" ("user_id");


--
-- Name: command_outbox_command_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "command_outbox_command_id_idx" ON "public"."command_outbox" USING "btree" ("command_id");


--
-- Name: command_outbox_next_attempt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "command_outbox_next_attempt_idx" ON "public"."command_outbox" USING "btree" ("status", "next_attempt_at");


--
-- Name: command_outbox_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "command_outbox_pending_idx" ON "public"."command_outbox" USING "btree" ("status", "available_at", "priority", "created_at");


--
-- Name: command_outbox_screen_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "command_outbox_screen_id_idx" ON "public"."command_outbox" USING "btree" ("screen_id", "created_at");


--
-- Name: conversation_messages_author_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "conversation_messages_author_idx" ON "public"."conversation_messages" USING "btree" ("author_id");


--
-- Name: conversation_messages_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "conversation_messages_conversation_idx" ON "public"."conversation_messages" USING "btree" ("conversation_id");


--
-- Name: conversation_reads_conversation_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "conversation_reads_conversation_user_idx" ON "public"."conversation_reads" USING "btree" ("conversation_id", "user_id");


--
-- Name: conversations_participants_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "conversations_participants_idx" ON "public"."conversations" USING "btree" ("participant_a", "participant_b");


--
-- Name: device_certificates_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "device_certificates_expires_at_idx" ON "public"."device_certificates" USING "btree" ("expires_at");


--
-- Name: device_certificates_screen_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "device_certificates_screen_id_idx" ON "public"."device_certificates" USING "btree" ("screen_id");


--
-- Name: device_certificates_serial_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "device_certificates_serial_idx" ON "public"."device_certificates" USING "btree" ("serial");


--
-- Name: device_command_status_history_command_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "device_command_status_history_command_id_idx" ON "public"."device_command_status_history" USING "btree" ("command_id", "created_at");


--
-- Name: device_command_status_history_screen_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "device_command_status_history_screen_id_idx" ON "public"."device_command_status_history" USING "btree" ("screen_id", "created_at");


--
-- Name: device_commands_claim_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "device_commands_claim_state_idx" ON "public"."device_commands" USING "btree" ("screen_id", "status", "claimed_at");


--
-- Name: device_commands_correlation_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "device_commands_correlation_id_idx" ON "public"."device_commands" USING "btree" ("correlation_id");


--
-- Name: device_commands_delivery_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "device_commands_delivery_token_idx" ON "public"."device_commands" USING "btree" ("delivery_token");


--
-- Name: device_commands_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "device_commands_expires_at_idx" ON "public"."device_commands" USING "btree" ("expires_at");


--
-- Name: device_commands_lease_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "device_commands_lease_expires_at_idx" ON "public"."device_commands" USING "btree" ("lease_expires_at");


--
-- Name: device_commands_lifecycle_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "device_commands_lifecycle_claim_idx" ON "public"."device_commands" USING "btree" ("screen_id", "status", "priority", "created_at");


--
-- Name: device_commands_screen_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "device_commands_screen_id_idx" ON "public"."device_commands" USING "btree" ("screen_id");


--
-- Name: device_commands_screen_idempotency_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "device_commands_screen_idempotency_key_idx" ON "public"."device_commands" USING "btree" ("screen_id", "idempotency_key");


--
-- Name: device_commands_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "device_commands_status_idx" ON "public"."device_commands" USING "btree" ("status");


--
-- Name: device_desired_state_history_command_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "device_desired_state_history_command_id_idx" ON "public"."device_desired_state_history" USING "btree" ("command_id");


--
-- Name: device_desired_state_history_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "device_desired_state_history_created_at_idx" ON "public"."device_desired_state_history" USING "btree" ("created_at");


--
-- Name: device_desired_state_history_screen_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "device_desired_state_history_screen_version_idx" ON "public"."device_desired_state_history" USING "btree" ("screen_id", "state_version");


--
-- Name: device_desired_state_snapshot_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "device_desired_state_snapshot_id_idx" ON "public"."device_desired_state" USING "btree" ("snapshot_id");


--
-- Name: device_desired_state_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "device_desired_state_updated_at_idx" ON "public"."device_desired_state" USING "btree" ("updated_at");


--
-- Name: device_pairings_active_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "device_pairings_active_code_idx" ON "public"."device_pairings" USING "btree" ("pairing_code");


--
-- Name: emergency_types_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "emergency_types_name_idx" ON "public"."emergency_types" USING "btree" ("name");


--
-- Name: emergency_types_severity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "emergency_types_severity_idx" ON "public"."emergency_types" USING "btree" ("severity");


--
-- Name: heartbeats_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "heartbeats_created_at_idx" ON "public"."heartbeats" USING "btree" ("created_at");


--
-- Name: heartbeats_screen_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "heartbeats_screen_id_idx" ON "public"."heartbeats" USING "btree" ("screen_id");


--
-- Name: heartbeats_storage_object_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "heartbeats_storage_object_id_idx" ON "public"."heartbeats" USING "btree" ("storage_object_id");


--
-- Name: layouts_aspect_ratio_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "layouts_aspect_ratio_idx" ON "public"."layouts" USING "btree" ("aspect_ratio");


--
-- Name: layouts_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "layouts_created_by_idx" ON "public"."layouts" USING "btree" ("created_by");


--
-- Name: log_archives_log_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "log_archives_log_type_idx" ON "public"."log_archives" USING "btree" ("log_type");


--
-- Name: login_attempts_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "login_attempts_created_at_idx" ON "public"."login_attempts" USING "btree" ("created_at");


--
-- Name: login_attempts_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "login_attempts_email_idx" ON "public"."login_attempts" USING "btree" ("email");


--
-- Name: media_cache_reports_event_reported_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "media_cache_reports_event_reported_idx" ON "public"."media_cache_reports" USING "btree" ("event_type", "reported_at");


--
-- Name: media_cache_reports_media_reported_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "media_cache_reports_media_reported_idx" ON "public"."media_cache_reports" USING "btree" ("media_id", "reported_at");


--
-- Name: media_cache_reports_screen_reported_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "media_cache_reports_screen_reported_idx" ON "public"."media_cache_reports" USING "btree" ("screen_id", "reported_at");


--
-- Name: media_cache_reports_status_severity_reported_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "media_cache_reports_status_severity_reported_idx" ON "public"."media_cache_reports" USING "btree" ("status", "severity", "reported_at");


--
-- Name: media_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "media_created_by_idx" ON "public"."media" USING "btree" ("created_by");


--
-- Name: media_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "media_status_idx" ON "public"."media" USING "btree" ("status");


--
-- Name: media_upload_sessions_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "media_upload_sessions_expires_at_idx" ON "public"."media_upload_sessions" USING "btree" ("expires_at");


--
-- Name: media_upload_sessions_media_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "media_upload_sessions_media_id_idx" ON "public"."media_upload_sessions" USING "btree" ("media_id");


--
-- Name: media_upload_sessions_state_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "media_upload_sessions_state_expires_at_idx" ON "public"."media_upload_sessions" USING "btree" ("state", "expires_at");


--
-- Name: media_upload_sessions_user_idempotency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "media_upload_sessions_user_idempotency_idx" ON "public"."media_upload_sessions" USING "btree" ("created_by", "idempotency_key");


--
-- Name: notifications_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notifications_created_at_idx" ON "public"."notifications" USING "btree" ("created_at");


--
-- Name: notifications_is_read_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notifications_is_read_idx" ON "public"."notifications" USING "btree" ("is_read");


--
-- Name: notifications_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notifications_user_id_idx" ON "public"."notifications" USING "btree" ("user_id");


--
-- Name: notifications_user_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "notifications_user_unread_idx" ON "public"."notifications" USING "btree" ("user_id");


--
-- Name: presentation_items_presentation_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "presentation_items_presentation_id_idx" ON "public"."presentation_items" USING "btree" ("presentation_id");


--
-- Name: presentation_slot_items_presentation_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "presentation_slot_items_presentation_id_idx" ON "public"."presentation_slot_items" USING "btree" ("presentation_id");


--
-- Name: presentations_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "presentations_created_by_idx" ON "public"."presentations" USING "btree" ("created_by");


--
-- Name: presentations_layout_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "presentations_layout_id_idx" ON "public"."presentations" USING "btree" ("layout_id");


--
-- Name: proof_of_play_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "proof_of_play_created_at_idx" ON "public"."proof_of_play" USING "btree" ("created_at");


--
-- Name: proof_of_play_idempotency_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "proof_of_play_idempotency_key_idx" ON "public"."proof_of_play" USING "btree" ("idempotency_key");


--
-- Name: proof_of_play_playback_instance_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "proof_of_play_playback_instance_idx" ON "public"."proof_of_play" USING "btree" ("playback_instance_id");


--
-- Name: proof_of_play_schedule_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "proof_of_play_schedule_id_idx" ON "public"."proof_of_play" USING "btree" ("schedule_id");


--
-- Name: proof_of_play_screen_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "proof_of_play_screen_id_idx" ON "public"."proof_of_play" USING "btree" ("screen_id");


--
-- Name: publish_targets_publish_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "publish_targets_publish_id_idx" ON "public"."publish_targets" USING "btree" ("publish_id");


--
-- Name: publish_targets_screen_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "publish_targets_screen_id_idx" ON "public"."publish_targets" USING "btree" ("screen_id");


--
-- Name: publishes_schedule_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "publishes_schedule_id_idx" ON "public"."publishes" USING "btree" ("schedule_id");


--
-- Name: publishes_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "publishes_status_idx" ON "public"."publishes" USING "btree" ("status");


--
-- Name: request_attachments_request_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "request_attachments_request_id_idx" ON "public"."request_attachments" USING "btree" ("request_id");


--
-- Name: request_messages_request_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "request_messages_request_id_idx" ON "public"."request_messages" USING "btree" ("request_id");


--
-- Name: request_status_history_request_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "request_status_history_request_id_idx" ON "public"."request_status_history" USING "btree" ("request_id");


--
-- Name: requests_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "requests_created_by_idx" ON "public"."requests" USING "btree" ("created_by");


--
-- Name: requests_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "requests_status_idx" ON "public"."requests" USING "btree" ("status");


--
-- Name: roles_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "roles_name_idx" ON "public"."roles" USING "btree" ("name");


--
-- Name: schedule_items_schedule_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "schedule_items_schedule_id_idx" ON "public"."schedule_items" USING "btree" ("schedule_id");


--
-- Name: schedule_items_start_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "schedule_items_start_at_idx" ON "public"."schedule_items" USING "btree" ("start_at");


--
-- Name: schedule_requests_requested_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "schedule_requests_requested_by_idx" ON "public"."schedule_requests" USING "btree" ("requested_by");


--
-- Name: schedule_requests_reservation_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "schedule_requests_reservation_state_idx" ON "public"."schedule_requests" USING "btree" ("reservation_state");


--
-- Name: schedule_requests_schedule_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "schedule_requests_schedule_id_idx" ON "public"."schedule_requests" USING "btree" ("schedule_id");


--
-- Name: schedule_requests_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "schedule_requests_status_idx" ON "public"."schedule_requests" USING "btree" ("status");


--
-- Name: schedule_reservations_publish_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "schedule_reservations_publish_idx" ON "public"."schedule_reservations" USING "btree" ("publish_id");


--
-- Name: schedule_reservations_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "schedule_reservations_request_idx" ON "public"."schedule_reservations" USING "btree" ("schedule_request_id");


--
-- Name: schedule_reservations_schedule_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "schedule_reservations_schedule_idx" ON "public"."schedule_reservations" USING "btree" ("schedule_id");


--
-- Name: schedule_reservations_screen_window_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "schedule_reservations_screen_window_idx" ON "public"."schedule_reservations" USING "btree" ("screen_id", "start_at", "end_at");


--
-- Name: schedule_reservations_state_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "schedule_reservations_state_expiry_idx" ON "public"."schedule_reservations" USING "btree" ("state", "hold_expires_at");


--
-- Name: schedule_snapshots_schedule_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "schedule_snapshots_schedule_id_idx" ON "public"."schedule_snapshots" USING "btree" ("schedule_id");


--
-- Name: schedules_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "schedules_created_by_idx" ON "public"."schedules" USING "btree" ("created_by");


--
-- Name: schedules_end_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "schedules_end_at_idx" ON "public"."schedules" USING "btree" ("end_at");


--
-- Name: schedules_is_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "schedules_is_active_idx" ON "public"."schedules" USING "btree" ("is_active");


--
-- Name: schedules_start_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "schedules_start_at_idx" ON "public"."schedules" USING "btree" ("start_at");


--
-- Name: screen_display_states_active_display_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "screen_display_states_active_display_idx" ON "public"."screen_display_states" USING "btree" ("active_display_key");


--
-- Name: screen_display_states_profile_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "screen_display_states_profile_updated_idx" ON "public"."screen_display_states" USING "btree" ("updated_at");


--
-- Name: screen_group_members_group_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "screen_group_members_group_id_idx" ON "public"."screen_group_members" USING "btree" ("group_id");


--
-- Name: screens_current_media_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "screens_current_media_idx" ON "public"."screens" USING "btree" ("current_media_id");


--
-- Name: screens_current_scene_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "screens_current_scene_idx" ON "public"."screens" USING "btree" ("current_scene_id");


--
-- Name: screens_current_schedule_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "screens_current_schedule_idx" ON "public"."screens" USING "btree" ("current_schedule_id");


--
-- Name: screens_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "screens_status_idx" ON "public"."screens" USING "btree" ("status");


--
-- Name: screenshots_screen_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "screenshots_screen_id_idx" ON "public"."screenshots" USING "btree" ("screen_id");


--
-- Name: screenshots_storage_object_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "screenshots_storage_object_id_idx" ON "public"."screenshots" USING "btree" ("storage_object_id");


--
-- Name: sessions_access_jti_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "sessions_access_jti_idx" ON "public"."sessions" USING "btree" ("access_jti");


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "sessions_user_id_idx" ON "public"."sessions" USING "btree" ("user_id");


--
-- Name: sso_configs_is_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "sso_configs_is_active_idx" ON "public"."sso_configs" USING "btree" ("is_active");


--
-- Name: storage_objects_bucket_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "storage_objects_bucket_key_idx" ON "public"."storage_objects" USING "btree" ("bucket", "object_key");


--
-- Name: system_logs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "system_logs_created_at_idx" ON "public"."system_logs" USING "btree" ("created_at");


--
-- Name: system_logs_level_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "system_logs_level_idx" ON "public"."system_logs" USING "btree" ("level");


--
-- Name: users_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "users_email_idx" ON "public"."users" USING "btree" ("email");


--
-- Name: users_role_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "users_role_id_idx" ON "public"."users" USING "btree" ("role_id");


--
-- Name: webhook_subscriptions_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "webhook_subscriptions_created_by_idx" ON "public"."webhook_subscriptions" USING "btree" ("created_by");


--
-- Name: webhook_subscriptions_is_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "webhook_subscriptions_is_active_idx" ON "public"."webhook_subscriptions" USING "btree" ("is_active");


--
-- PostgreSQL database dump complete
--
