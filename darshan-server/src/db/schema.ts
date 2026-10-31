import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  bigint,
  jsonb,
  uniqueIndex,
  index,
  check,
  foreignKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Enums
export const requestStatusEnum = pgEnum('request_status', [
  'OPEN',
  'IN_PROGRESS',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'COMPLETED',
]);
export const scheduleRequestStatusEnum = pgEnum('schedule_request_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'PUBLISHED',
  'TAKEN_DOWN',
  'EXPIRED',
]);
export const scheduleReservationStateEnum = pgEnum('schedule_reservation_state', [
  'HELD',
  'RESERVED',
  'PUBLISHED',
  'RELEASED',
  'EXPIRED',
  'CANCELLED',
]);
export const publishStatusEnum = pgEnum('publish_status', ['ACTIVE', 'TAKEN_DOWN']);
export const mediaTypeEnum = pgEnum('media_type', ['IMAGE', 'VIDEO', 'DOCUMENT', 'WEBPAGE']);
export const mediaStatusEnum = pgEnum('media_status', ['PENDING', 'PROCESSING', 'READY', 'FAILED']);
export const screenStatusEnum = pgEnum('screen_status', ['ACTIVE', 'INACTIVE', 'OFFLINE']);
export const commandTypeEnum = pgEnum('command_type', [
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
  'SET_ACTIVE_DISPLAY',
]);
export const commandStatusEnum = pgEnum('command_status', [
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
  'CANCELLED',
]);
export const chatConversationTypeEnum = pgEnum('chat_conversation_type', [
  'DM',
  'GROUP_CLOSED',
  'FORUM_OPEN',
]);
export const chatConversationStateEnum = pgEnum('chat_conversation_state', [
  'ACTIVE',
  'ARCHIVED',
  'DELETED',
]);
export const chatInvitePolicyEnum = pgEnum('chat_invite_policy', [
  'ANY_MEMBER_CAN_INVITE',
  'ADMINS_ONLY_CAN_INVITE',
  'INVITES_DISABLED',
]);
export const chatMemberRoleEnum = pgEnum('chat_member_role', [
  'OWNER',
  'CHAT_ADMIN',
  'MOD',
  'MEMBER',
]);
export const chatRevisionActionEnum = pgEnum('chat_revision_action', ['EDIT', 'DELETE']);
export const chatBookmarkTypeEnum = pgEnum('chat_bookmark_type', ['LINK', 'FILE', 'MESSAGE']);

// Users table
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull().unique(),
    description: text('description'),
    permissions: jsonb('permissions').notNull().default({}),
    is_system: boolean('is_system').notNull().default(false),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    nameIdx: uniqueIndex('roles_name_idx').on(table.name),
  })
);

// Departments must be declared before users because the user schema owns a
// database-enforced reference to this table.
export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    password_hash: text('password_hash').notNull(),
    first_name: varchar('first_name', { length: 100 }),
    last_name: varchar('last_name', { length: 100 }),
    role_id: uuid('role_id').notNull(),
    department_id: uuid('department_id'),
    is_active: boolean('is_active').notNull().default(true),
    deleted_at: timestamp('deleted_at'),
    deleted_by: uuid('deleted_by'),
    ext: jsonb('ext'),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    emailIdx: uniqueIndex('users_email_idx').on(table.email),
    roleIdx: index('users_role_id_idx').on(table.role_id),
    departmentIdx: index('users_department_id_idx').on(table.department_id),
    deletedAtIdx: index('users_deleted_at_idx').on(table.deleted_at),
    departmentFk: foreignKey({
      columns: [table.department_id],
      foreignColumns: [departments.id],
      name: 'users_department_id_fk',
    }).onDelete('restrict'),
    deletedByFk: foreignKey({
      columns: [table.deleted_by],
      foreignColumns: [table.id],
      name: 'users_deleted_by_fk',
    }).onDelete('restrict'),
  })
);

// Sessions table (for JWT JTI revocation)
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id').notNull(),
    access_jti: varchar('access_jti', { length: 255 }).notNull(),
    expires_at: timestamp('expires_at').notNull(),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('sessions_user_id_idx').on(table.user_id),
    jtiIdx: uniqueIndex('sessions_access_jti_idx').on(table.access_jti),
  })
);

// Storage objects (MinIO references)
export const storageObjects = pgTable(
  'storage_objects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bucket: varchar('bucket', { length: 255 }).notNull(),
    object_key: varchar('object_key', { length: 1024 }).notNull(),
    content_type: varchar('content_type', { length: 100 }),
    size: integer('size'),
    sha256: varchar('sha256', { length: 64 }),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    bucketKeyIdx: uniqueIndex('storage_objects_bucket_key_idx').on(table.bucket, table.object_key),
  })
);

// Media table
export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    type: mediaTypeEnum('type').notNull(),
    status: mediaStatusEnum('status').notNull().default('PENDING'),
    source_object_id: uuid('source_object_id'),
    source_bucket: varchar('source_bucket', { length: 255 }),
    source_object_key: varchar('source_object_key', { length: 1024 }),
    source_content_type: varchar('source_content_type', { length: 255 }),
    source_size: integer('source_size'),
    source_url: text('source_url'),
    ready_object_id: uuid('ready_object_id'),
    thumbnail_object_id: uuid('thumbnail_object_id'),
    status_reason: varchar('status_reason', { length: 120 }),
    duration_seconds: integer('duration_seconds'),
    width: integer('width'),
    height: integer('height'),
    page_count: integer('page_count'),
    webpage_preview_captured_at: timestamp('webpage_preview_captured_at'),
    webpage_preview_attempted_at: timestamp('webpage_preview_attempted_at'),
    webpage_preview_refresh_token: uuid('webpage_preview_refresh_token'),
    webpage_preview_last_error: varchar('webpage_preview_last_error', { length: 120 }),
    created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    owner_scope: varchar('owner_scope', { length: 16 }).notNull().default('RESTRICTED'),
    owner_department_id: uuid('owner_department_id').references(() => departments.id, {
      onDelete: 'restrict',
    }),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    createdByIdx: index('media_created_by_idx').on(table.created_by),
    ownerIdx: index('media_owner_idx').on(table.owner_scope, table.owner_department_id),
    statusIdx: index('media_status_idx').on(table.status),
    webpagePreviewDueIdx: index('media_webpage_preview_due_idx').on(
      table.type,
      table.status,
      table.webpage_preview_attempted_at
    ),
    ownerScopeCheck: check(
      'media_owner_scope_check',
      sql`(${table.owner_scope} = 'DEPARTMENT' AND ${table.owner_department_id} IS NOT NULL) OR (${table.owner_scope} IN ('ORGANIZATION', 'RESTRICTED') AND ${table.owner_department_id} IS NULL)`
    ),
  })
);

// Resumable browser-to-object-storage uploads. The final media record is kept
// PENDING until the staging object is verified and promoted to its immutable
// canonical key.
export const mediaUploadSessions = pgTable(
  'media_upload_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    media_id: uuid('media_id').notNull(),
    created_by: uuid('created_by').notNull(),
    idempotency_key: varchar('idempotency_key', { length: 255 }).notNull(),
    state: varchar('state', { length: 32 }).notNull().default('INITIALIZING'),
    strategy: varchar('strategy', { length: 16 }).notNull(),
    original_filename: varchar('original_filename', { length: 512 }).notNull(),
    display_name: varchar('display_name', { length: 255 }).notNull(),
    content_type: varchar('content_type', { length: 255 }).notNull(),
    expected_size: integer('expected_size').notNull(),
    checksum_sha256: varchar('checksum_sha256', { length: 64 }).notNull(),
    part_size: integer('part_size'),
    staging_bucket: varchar('staging_bucket', { length: 255 }).notNull(),
    staging_object_key: varchar('staging_object_key', { length: 1024 }).notNull(),
    canonical_bucket: varchar('canonical_bucket', { length: 255 }).notNull(),
    canonical_object_key: varchar('canonical_object_key', { length: 1024 }).notNull(),
    multipart_upload_id: text('multipart_upload_id'),
    expires_at: timestamp('expires_at').notNull(),
    completed_at: timestamp('completed_at'),
    aborted_at: timestamp('aborted_at'),
    failure_reason: varchar('failure_reason', { length: 120 }),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    mediaIdIdx: uniqueIndex('media_upload_sessions_media_id_idx').on(table.media_id),
    userIdempotencyIdx: uniqueIndex('media_upload_sessions_user_idempotency_idx').on(
      table.created_by,
      table.idempotency_key
    ),
    expiresAtIdx: index('media_upload_sessions_expires_at_idx').on(table.expires_at),
    stateExpiresIdx: index('media_upload_sessions_state_expires_at_idx').on(
      table.state,
      table.expires_at
    ),
  })
);

// Presentations table
export const presentations = pgTable(
  'presentations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    layout_id: uuid('layout_id'),
    created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    owner_scope: varchar('owner_scope', { length: 16 }).notNull().default('RESTRICTED'),
    owner_department_id: uuid('owner_department_id').references(() => departments.id, {
      onDelete: 'restrict',
    }),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    createdByIdx: index('presentations_created_by_idx').on(table.created_by),
    ownerIdx: index('presentations_owner_idx').on(table.owner_scope, table.owner_department_id),
    layoutIdx: index('presentations_layout_id_idx').on(table.layout_id),
    ownerScopeCheck: check(
      'presentations_owner_scope_check',
      sql`(${table.owner_scope} = 'DEPARTMENT' AND ${table.owner_department_id} IS NOT NULL) OR (${table.owner_scope} IN ('ORGANIZATION', 'RESTRICTED') AND ${table.owner_department_id} IS NULL)`
    ),
  })
);

// Presentation items table
export const presentationItems = pgTable(
  'presentation_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    presentation_id: uuid('presentation_id').notNull(),
    media_id: uuid('media_id').notNull(),
    order: integer('order').notNull(),
    duration_seconds: integer('duration_seconds'),
    page_number: integer('page_number'),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    presentationIdIdx: index('presentation_items_presentation_id_idx').on(table.presentation_id),
  })
);

// Presentation slot items table (layout-based playlists)
export const presentationSlotItems = pgTable(
  'presentation_slot_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    presentation_id: uuid('presentation_id').notNull(),
    slot_id: varchar('slot_id', { length: 255 }).notNull(),
    media_id: uuid('media_id').notNull(),
    order: integer('order').notNull().default(0),
    duration_seconds: integer('duration_seconds'),
    fit_mode: varchar('fit_mode', { length: 50 }),
    audio_enabled: boolean('audio_enabled').default(false),
    loop_enabled: boolean('loop_enabled').default(false),
    page_number: integer('page_number'),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    presentationSlotIdx: index('presentation_slot_items_presentation_id_idx').on(
      table.presentation_id
    ),
  })
);

// Schedules table
export const schedules = pgTable(
  'schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    timezone: varchar('timezone', { length: 100 }),
    start_at: timestamp('start_at').notNull(),
    end_at: timestamp('end_at').notNull(),
    revision: integer('revision').notNull().default(1),
    is_active: boolean('is_active').notNull().default(true),
    created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    owner_scope: varchar('owner_scope', { length: 16 }).notNull().default('RESTRICTED'),
    owner_department_id: uuid('owner_department_id').references(() => departments.id, {
      onDelete: 'restrict',
    }),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    createdByIdx: index('schedules_created_by_idx').on(table.created_by),
    ownerIdx: index('schedules_owner_idx').on(table.owner_scope, table.owner_department_id),
    isActiveIdx: index('schedules_is_active_idx').on(table.is_active),
    startAtIdx: index('schedules_start_at_idx').on(table.start_at),
    endAtIdx: index('schedules_end_at_idx').on(table.end_at),
    ownerScopeCheck: check(
      'schedules_owner_scope_check',
      sql`(${table.owner_scope} = 'DEPARTMENT' AND ${table.owner_department_id} IS NOT NULL) OR (${table.owner_scope} IN ('ORGANIZATION', 'RESTRICTED') AND ${table.owner_department_id} IS NULL)`
    ),
  })
);

// Schedule items table
export const scheduleItems = pgTable(
  'schedule_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schedule_id: uuid('schedule_id').notNull(),
    presentation_id: uuid('presentation_id').notNull(),
    start_at: timestamp('start_at').notNull(),
    end_at: timestamp('end_at').notNull(),
    priority: integer('priority').notNull().default(0),
    screen_ids: jsonb('screen_ids')
      .$type<string[]>()
      .notNull()
      .default([] as string[]),
    screen_group_ids: jsonb('screen_group_ids')
      .$type<string[]>()
      .notNull()
      .default([] as string[]),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    scheduleIdIdx: index('schedule_items_schedule_id_idx').on(table.schedule_id),
    startAtIdx: index('schedule_items_start_at_idx').on(table.start_at),
  })
);

// Schedule snapshots (immutable published versions)
export const scheduleSnapshots = pgTable(
  'schedule_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schedule_id: uuid('schedule_id').notNull(),
    payload: jsonb('payload').notNull(),
    storage_object_id: uuid('storage_object_id'),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    scheduleIdIdx: index('schedule_snapshots_schedule_id_idx').on(table.schedule_id),
  })
);

// Schedule requests (approval workflow for publishes)
// Publishes (schedule publication events)
export const publishes = pgTable(
  'publishes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schedule_id: uuid('schedule_id').notNull(),
    snapshot_id: uuid('snapshot_id').notNull(),
    published_by: uuid('published_by').notNull(),
    status: publishStatusEnum('status').notNull().default('ACTIVE'),
    taken_down_at: timestamp('taken_down_at'),
    taken_down_by: uuid('taken_down_by'),
    takedown_reason: text('takedown_reason'),
    published_at: timestamp('published_at').notNull().defaultNow(),
  },
  (table) => ({
    scheduleIdIdx: index('publishes_schedule_id_idx').on(table.schedule_id),
    statusIdx: index('publishes_status_idx').on(table.status),
  })
);

// Screens table
export const screens = pgTable(
  'screens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    location: varchar('location', { length: 255 }),
    aspect_ratio: varchar('aspect_ratio', { length: 50 }),
    width: integer('width'),
    height: integer('height'),
    orientation: varchar('orientation', { length: 50 }),
    device_info: jsonb('device_info'),
    status: screenStatusEnum('status').notNull().default('OFFLINE'),
    last_heartbeat_at: timestamp('last_heartbeat_at', { withTimezone: true }),
    current_schedule_id: uuid('current_schedule_id'),
    current_media_id: uuid('current_media_id'),
    current_scene_id: text('current_scene_id'),
    active_slots: jsonb('active_slots')
      .notNull()
      .default(sql`'[]'::jsonb`),
    screenshot_interval_seconds: integer('screenshot_interval_seconds'),
    screenshot_enabled: boolean('screenshot_enabled').notNull().default(false),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('screens_status_idx').on(table.status),
    currentScheduleIdx: index('screens_current_schedule_idx').on(table.current_schedule_id),
    currentMediaIdx: index('screens_current_media_idx').on(table.current_media_id),
    currentSceneIdx: index('screens_current_scene_idx').on(table.current_scene_id),
  })
);

// Bounded per-screen evidence used to govern the legacy-to-signature device
// authentication rollout. These are successful authentication observations,
// not a high-cardinality request log: each screen has one continuously updated
// row for HTTP and realtime channels.
export const deviceAuthRolloutObservations = pgTable(
  'device_auth_rollout_observations',
  {
    screen_id: uuid('screen_id')
      .primaryKey()
      .references(() => screens.id, { onDelete: 'cascade' }),
    last_signed_http_at: timestamp('last_signed_http_at'),
    last_signed_socket_at: timestamp('last_signed_socket_at'),
    last_legacy_http_at: timestamp('last_legacy_http_at'),
    last_legacy_socket_at: timestamp('last_legacy_socket_at'),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    updatedAtIdx: index('device_auth_rollout_observations_updated_idx').on(table.updated_at),
  })
);

/**
 * Device-observed display state and the operator's desired selection.  The
 * legacy geometry columns on `screens` remain populated for older consumers;
 * this table is the authoritative V1 record.
 */
export const screenDisplayStates = pgTable(
  'screen_display_states',
  {
    screen_id: uuid('screen_id').primaryKey(),
    desired_selection: jsonb('desired_selection')
      .notNull()
      .default(sql`'{"mode":"PRIMARY","preferred_key":null}'::jsonb`),
    selection_version: integer('selection_version').notNull().default(1),
    active_display_key: varchar('active_display_key', { length: 255 }),
    placement: varchar('placement', { length: 32 }).notNull().default('UNVERIFIED'),
    display_profile: jsonb('display_profile'),
    profile_hash: varchar('profile_hash', { length: 64 }),
    profile_revision: integer('profile_revision').notNull().default(0),
    runtime_session_id: varchar('runtime_session_id', { length: 64 }),
    observation_seq: bigint('observation_seq', { mode: 'number' }).notNull().default(0),
    observed_at: timestamp('observed_at'),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    profileUpdatedIdx: index('screen_display_states_profile_updated_idx').on(table.updated_at),
    activeDisplayIdx: index('screen_display_states_active_display_idx').on(
      table.active_display_key
    ),
  })
);

// Screen groups table
export const screenGroups = pgTable('screen_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

// Layouts (screen mosaics)
export const layouts = pgTable(
  'layouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    aspect_ratio: varchar('aspect_ratio', { length: 50 }).notNull(),
    spec: jsonb('spec').notNull(), // normalized slots: [{id,x,y,w,h,z,fit,audio_enabled}]
    created_by: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    owner_scope: varchar('owner_scope', { length: 16 }).notNull().default('RESTRICTED'),
    owner_department_id: uuid('owner_department_id').references(() => departments.id, {
      onDelete: 'restrict',
    }),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    aspectIdx: index('layouts_aspect_ratio_idx').on(table.aspect_ratio),
    creatorIdx: index('layouts_created_by_idx').on(table.created_by),
    ownerIdx: index('layouts_owner_idx').on(table.owner_scope, table.owner_department_id),
    ownerScopeCheck: check(
      'layouts_owner_scope_check',
      sql`(${table.owner_scope} = 'DEPARTMENT' AND ${table.owner_department_id} IS NOT NULL) OR (${table.owner_scope} IN ('ORGANIZATION', 'RESTRICTED') AND ${table.owner_department_id} IS NULL)`
    ),
  })
);

// Schedule requests (draft/approval)
export const scheduleRequests = pgTable(
  'schedule_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schedule_id: uuid('schedule_id').notNull(),
    schedule_payload: jsonb('schedule_payload').notNull(),
    status: scheduleRequestStatusEnum('status').notNull().default('PENDING'),
    review_notes: text('review_notes'),
    notes: text('notes'),
    reservation_token: uuid('reservation_token'),
    reservation_version: integer('reservation_version'),
    reservation_state: varchar('reservation_state', { length: 50 }),
    hold_expires_at: timestamp('hold_expires_at'),
    published_at: timestamp('published_at'),
    taken_down_at: timestamp('taken_down_at'),
    taken_down_by: uuid('taken_down_by'),
    takedown_reason: text('takedown_reason'),
    requested_by: uuid('requested_by').notNull(),
    reviewed_by: uuid('reviewed_by'),
    reviewed_at: timestamp('reviewed_at'),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('schedule_requests_status_idx').on(table.status),
    scheduleIdx: index('schedule_requests_schedule_id_idx').on(table.schedule_id),
    requesterIdx: index('schedule_requests_requested_by_idx').on(table.requested_by),
    reservationStateIdx: index('schedule_requests_reservation_state_idx').on(
      table.reservation_state
    ),
  })
);

export const scheduleReservations = pgTable(
  'schedule_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    screen_id: uuid('screen_id').notNull(),
    schedule_id: uuid('schedule_id').notNull(),
    schedule_item_id: uuid('schedule_item_id').notNull(),
    schedule_request_id: uuid('schedule_request_id'),
    owner_user_id: uuid('owner_user_id').notNull(),
    state: scheduleReservationStateEnum('state').notNull(),
    start_at: timestamp('start_at').notNull(),
    end_at: timestamp('end_at').notNull(),
    hold_expires_at: timestamp('hold_expires_at'),
    reservation_token: uuid('reservation_token').notNull(),
    reservation_version: integer('reservation_version').notNull().default(1),
    publish_id: uuid('publish_id'),
    approved_at: timestamp('approved_at'),
    published_at: timestamp('published_at'),
    released_at: timestamp('released_at'),
    release_reason: text('release_reason'),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    screenWindowIdx: index('schedule_reservations_screen_window_idx').on(
      table.screen_id,
      table.start_at,
      table.end_at
    ),
    requestIdx: index('schedule_reservations_request_idx').on(table.schedule_request_id),
    scheduleIdx: index('schedule_reservations_schedule_idx').on(table.schedule_id),
    publishIdx: index('schedule_reservations_publish_idx').on(table.publish_id),
    stateExpiryIdx: index('schedule_reservations_state_expiry_idx').on(
      table.state,
      table.hold_expires_at
    ),
  })
);

// Screen group members table
export const screenGroupMembers = pgTable(
  'screen_group_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    group_id: uuid('group_id').notNull(),
    screen_id: uuid('screen_id').notNull(),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    groupIdIdx: index('screen_group_members_group_id_idx').on(table.group_id),
  })
);

// Device certificates (mTLS)
export const deviceCertificates = pgTable(
  'device_certificates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    screen_id: uuid('screen_id').notNull(),
    serial: varchar('serial', { length: 255 }).notNull().unique(),
    certificate_pem: text('certificate_pem').notNull(),
    public_key_pem: text('public_key_pem'),
    auth_version: varchar('auth_version', { length: 32 }).notNull().default('legacy'),
    is_revoked: boolean('is_revoked').notNull().default(false),
    expires_at: timestamp('expires_at').notNull(),
    created_at: timestamp('created_at').notNull().defaultNow(),
    revoked_at: timestamp('revoked_at'),
  },
  (table) => ({
    screenIdIdx: index('device_certificates_screen_id_idx').on(table.screen_id),
    serialIdx: uniqueIndex('device_certificates_serial_idx').on(table.serial),
    expiresAtIdx: index('device_certificates_expires_at_idx').on(table.expires_at),
  })
);

// Device commands
export const deviceCommands = pgTable(
  'device_commands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    screen_id: uuid('screen_id').notNull(),
    recovery_generation: uuid('recovery_generation'),
    type: commandTypeEnum('type').notNull(),
    status: commandStatusEnum('status').notNull().default('PENDING'),
    payload: jsonb('payload'),
    delivery_token: uuid('delivery_token'),
    claimed_at: timestamp('claimed_at'),
    acknowledged_at: timestamp('acknowledged_at'),
    delivery_attempts: integer('delivery_attempts').notNull().default(0),
    priority: integer('priority').notNull().default(0),
    expires_at: timestamp('expires_at'),
    lease_expires_at: timestamp('lease_expires_at'),
    attempt_count: integer('attempt_count').notNull().default(0),
    max_attempts: integer('max_attempts').notNull().default(5),
    last_error: text('last_error'),
    result_payload: jsonb('result_payload'),
    correlation_id: uuid('correlation_id'),
    idempotency_key: text('idempotency_key'),
    desired_snapshot_id: uuid('desired_snapshot_id'),
    desired_default_media_version: text('desired_default_media_version'),
    desired_emergency_version: text('desired_emergency_version'),
    completed_at: timestamp('completed_at'),
    cancelled_at: timestamp('cancelled_at'),
    dead_lettered_at: timestamp('dead_lettered_at'),
    created_by: uuid('created_by').notNull(),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    screenIdIdx: index('device_commands_screen_id_idx').on(table.screen_id),
    statusIdx: index('device_commands_status_idx').on(table.status),
    deliveryTokenIdx: index('device_commands_delivery_token_idx').on(table.delivery_token),
    claimStateIdx: index('device_commands_claim_state_idx').on(
      table.screen_id,
      table.status,
      table.claimed_at
    ),
    lifecycleClaimIdx: index('device_commands_lifecycle_claim_idx').on(
      table.screen_id,
      table.status,
      table.priority,
      table.created_at
    ),
    expiresAtIdx: index('device_commands_expires_at_idx').on(table.expires_at),
    leaseExpiresAtIdx: index('device_commands_lease_expires_at_idx').on(table.lease_expires_at),
    correlationIdIdx: index('device_commands_correlation_id_idx').on(table.correlation_id),
    idempotencyKeyIdx: uniqueIndex('device_commands_screen_idempotency_key_idx')
      .on(table.screen_id, table.idempotency_key)
      .where(sql`idempotency_key IS NOT NULL`),
  })
);

export const deviceCommandStatusHistory = pgTable(
  'device_command_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    command_id: uuid('command_id').notNull(),
    screen_id: uuid('screen_id').notNull(),
    old_status: commandStatusEnum('old_status'),
    new_status: commandStatusEnum('new_status').notNull(),
    reason: text('reason'),
    attempt_count: integer('attempt_count'),
    delivery_token: uuid('delivery_token'),
    metadata: jsonb('metadata'),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    commandIdIdx: index('device_command_status_history_command_id_idx').on(
      table.command_id,
      table.created_at
    ),
    screenIdIdx: index('device_command_status_history_screen_id_idx').on(
      table.screen_id,
      table.created_at
    ),
  })
);

export const commandOutbox = pgTable(
  'command_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    screen_id: uuid('screen_id').notNull(),
    command_id: uuid('command_id'),
    event_type: varchar('event_type', { length: 80 }).notNull(),
    reason: text('reason'),
    payload: jsonb('payload'),
    status: varchar('status', { length: 40 }).notNull().default('PENDING'),
    priority: integer('priority').notNull().default(0),
    available_at: timestamp('available_at').notNull().defaultNow(),
    next_attempt_at: timestamp('next_attempt_at'),
    attempt_count: integer('attempt_count').notNull().default(0),
    max_attempts: integer('max_attempts').notNull().default(5),
    dispatched_at: timestamp('dispatched_at'),
    last_error: text('last_error'),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    pendingIdx: index('command_outbox_pending_idx').on(
      table.status,
      table.available_at,
      table.priority,
      table.created_at
    ),
    screenIdx: index('command_outbox_screen_id_idx').on(table.screen_id, table.created_at),
    commandIdx: index('command_outbox_command_id_idx').on(table.command_id),
    nextAttemptIdx: index('command_outbox_next_attempt_idx').on(
      table.status,
      table.next_attempt_at
    ),
  })
);

export const deviceDesiredState = pgTable(
  'device_desired_state',
  {
    screen_id: uuid('screen_id').primaryKey(),
    recovery_generation: uuid('recovery_generation'),
    snapshot_id: uuid('snapshot_id'),
    default_media_version: text('default_media_version'),
    emergency_version: text('emergency_version'),
    command_version: bigint('command_version', { mode: 'number' }).notNull().default(0),
    state_version: bigint('state_version', { mode: 'number' }).notNull().default(1),
    last_command_id: uuid('last_command_id'),
    last_command_type: varchar('last_command_type', { length: 80 }),
    last_command_reason: text('last_command_reason'),
    last_changed_reason: text('last_changed_reason'),
    metadata: jsonb('metadata'),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    updatedAtIdx: index('device_desired_state_updated_at_idx').on(table.updated_at),
    snapshotIdx: index('device_desired_state_snapshot_id_idx').on(table.snapshot_id),
  })
);

export const deviceDesiredStateHistory = pgTable(
  'device_desired_state_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    screen_id: uuid('screen_id').notNull(),
    recovery_generation: uuid('recovery_generation'),
    state_version: bigint('state_version', { mode: 'number' }).notNull(),
    command_version: bigint('command_version', { mode: 'number' }).notNull(),
    snapshot_id: uuid('snapshot_id'),
    default_media_version: text('default_media_version'),
    emergency_version: text('emergency_version'),
    command_id: uuid('command_id'),
    reason: text('reason'),
    metadata: jsonb('metadata'),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    screenVersionIdx: index('device_desired_state_history_screen_version_idx').on(
      table.screen_id,
      table.state_version
    ),
    commandIdx: index('device_desired_state_history_command_id_idx').on(table.command_id),
    createdAtIdx: index('device_desired_state_history_created_at_idx').on(table.created_at),
  })
);

export const mediaCacheReports = pgTable(
  'media_cache_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    screen_id: uuid('screen_id').notNull(),
    media_id: text('media_id'),
    event_type: varchar('event_type', { length: 80 }).notNull(),
    severity: varchar('severity', { length: 20 }).notNull().default('ERROR'),
    source: varchar('source', { length: 80 }),
    status: varchar('status', { length: 40 }).notNull().default('OPEN'),
    error_code: varchar('error_code', { length: 80 }),
    http_status: integer('http_status'),
    message: text('message'),
    cache_key: text('cache_key'),
    url_host: text('url_host'),
    url_path_hash: text('url_path_hash'),
    snapshot_id: uuid('snapshot_id'),
    schedule_id: uuid('schedule_id'),
    default_media_version: text('default_media_version'),
    playback_mode: varchar('playback_mode', { length: 40 }),
    attempt_count: integer('attempt_count').notNull().default(1),
    metadata: jsonb('metadata'),
    reported_at: timestamp('reported_at').notNull(),
    received_at: timestamp('received_at').notNull().defaultNow(),
    resolved_at: timestamp('resolved_at'),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    screenReportedIdx: index('media_cache_reports_screen_reported_idx').on(
      table.screen_id,
      table.reported_at
    ),
    mediaReportedIdx: index('media_cache_reports_media_reported_idx').on(
      table.media_id,
      table.reported_at
    ),
    statusSeverityReportedIdx: index('media_cache_reports_status_severity_reported_idx').on(
      table.status,
      table.severity,
      table.reported_at
    ),
    eventReportedIdx: index('media_cache_reports_event_reported_idx').on(
      table.event_type,
      table.reported_at
    ),
  })
);

// Heartbeats (device telemetry)
export const heartbeats = pgTable(
  'heartbeats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    screen_id: uuid('screen_id').notNull(),
    status: varchar('status', { length: 20 }),
    storage_object_id: uuid('storage_object_id'),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    screenIdIdx: index('heartbeats_screen_id_idx').on(table.screen_id),
    createdAtIdx: index('heartbeats_created_at_idx').on(table.created_at),
    storageObjectIdx: uniqueIndex('heartbeats_storage_object_id_idx').on(table.storage_object_id),
  })
);

// Proof of Play (PoP)
export const proofOfPlay = pgTable(
  'proof_of_play',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    screen_id: uuid('screen_id').notNull(),
    media_id: uuid('media_id'),
    presentation_id: uuid('presentation_id'),
    schedule_id: uuid('schedule_id'),
    scene_id: text('scene_id'),
    slot_id: varchar('slot_id', { length: 255 }),
    item_id: text('item_id'),
    page_number: integer('page_number'),
    playback_instance_id: uuid('playback_instance_id'),
    started_at: timestamp('started_at').notNull(),
    ended_at: timestamp('ended_at'),
    storage_object_id: uuid('storage_object_id'),
    idempotency_key: varchar('idempotency_key', { length: 64 }).notNull(),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    screenIdIdx: index('proof_of_play_screen_id_idx').on(table.screen_id),
    createdAtIdx: index('proof_of_play_created_at_idx').on(table.created_at),
    playbackInstanceIdx: index('proof_of_play_playback_instance_idx').on(
      table.playback_instance_id
    ),
    scheduleIdx: index('proof_of_play_schedule_id_idx').on(table.schedule_id),
    idempotencyIdx: uniqueIndex('proof_of_play_idempotency_key_idx').on(table.idempotency_key),
  })
);

// Screenshots
export const screenshots = pgTable(
  'screenshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    screen_id: uuid('screen_id').notNull(),
    storage_object_id: uuid('storage_object_id').notNull(),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    screenIdIdx: index('screenshots_screen_id_idx').on(table.screen_id),
    storageObjectIdx: uniqueIndex('screenshots_storage_object_id_idx').on(table.storage_object_id),
  })
);

// Requests (Kanban)
export const requests = pgTable(
  'requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    status: requestStatusEnum('status').notNull().default('OPEN'),
    priority: varchar('priority', { length: 20 }).default('MEDIUM'),
    created_by: uuid('created_by').notNull(),
    assigned_to: uuid('assigned_to'),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    createdByIdx: index('requests_created_by_idx').on(table.created_by),
    statusIdx: index('requests_status_idx').on(table.status),
  })
);

// Request status history
export const requestStatusHistory = pgTable(
  'request_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    request_id: uuid('request_id').notNull(),
    old_status: requestStatusEnum('old_status'),
    new_status: requestStatusEnum('new_status').notNull(),
    changed_by: uuid('changed_by').notNull(),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    requestIdIdx: index('request_status_history_request_id_idx').on(table.request_id),
  })
);

// Request messages (chat)
export const requestMessages = pgTable(
  'request_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    request_id: uuid('request_id').notNull(),
    author_id: uuid('author_id').notNull(),
    content: text('content').notNull(),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    requestIdIdx: index('request_messages_request_id_idx').on(table.request_id),
  })
);

// Request attachments
export const requestAttachments = pgTable(
  'request_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    request_id: uuid('request_id').notNull(),
    message_id: uuid('message_id'),
    storage_object_id: uuid('storage_object_id').notNull(),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    requestIdIdx: index('request_attachments_request_id_idx').on(table.request_id),
  })
);

// Notifications
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id').notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    message: text('message'),
    type: varchar('type', { length: 32 }).notNull().default('INFO'),
    data: jsonb('data'),
    is_read: boolean('is_read').notNull().default(false),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('notifications_user_id_idx').on(table.user_id),
    isReadIdx: index('notifications_is_read_idx').on(table.is_read),
    createdAtIdx: index('notifications_created_at_idx').on(table.created_at),
    userUnreadIdx: index('notifications_user_unread_idx')
      .on(table.user_id)
      .where(sql`${table.is_read} = false`),
  })
);

export const userNotificationCounters = pgTable(
  'user_notification_counters',
  {
    user_id: uuid('user_id').primaryKey().notNull(),
    unread_total: integer('unread_total').notNull().default(0),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  () => ({})
);

// Audit logs
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id'),
    action: varchar('action', { length: 100 }).notNull(),
    entity_type: varchar('entity_type', { length: 100 }).notNull(),
    entity_id: uuid('entity_id'),
    ip_address: varchar('ip_address', { length: 45 }),
    storage_object_id: uuid('storage_object_id'),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('audit_logs_user_id_idx').on(table.user_id),
    createdAtIdx: index('audit_logs_created_at_idx').on(table.created_at),
  })
);

// System logs
export const systemLogs = pgTable(
  'system_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    level: varchar('level', { length: 20 }).notNull(),
    message: text('message').notNull(),
    context: jsonb('context'),
    storage_object_id: uuid('storage_object_id'),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    levelIdx: index('system_logs_level_idx').on(table.level),
    createdAtIdx: index('system_logs_created_at_idx').on(table.created_at),
  })
);

// Login attempts
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull(),
    success: boolean('success').notNull(),
    ip_address: varchar('ip_address', { length: 45 }),
    storage_object_id: uuid('storage_object_id'),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    emailIdx: index('login_attempts_email_idx').on(table.email),
    createdAtIdx: index('login_attempts_created_at_idx').on(table.created_at),
  })
);

// Log archives
export const logArchives = pgTable(
  'log_archives',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    log_type: varchar('log_type', { length: 50 }).notNull(),
    window_start: timestamp('window_start').notNull(),
    window_end: timestamp('window_end').notNull(),
    record_count: integer('record_count').notNull(),
    storage_object_id: uuid('storage_object_id').notNull(),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    logTypeIdx: index('log_archives_log_type_idx').on(table.log_type),
  })
);

// Emergency status
export const emergencyStatus = pgTable('emergency_status', {
  id: uuid('id').primaryKey().defaultRandom(),
  is_active: boolean('is_active').notNull().default(false),
  triggered_by: uuid('triggered_by'),
  triggered_at: timestamp('triggered_at'),
  cleared_by: uuid('cleared_by'),
  cleared_at: timestamp('cleared_at'),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

// Production deployment lifecycle state. This is intentionally separate from
// application settings so an installer can make a deterministic decision
// about whether a database is fresh, adopted, or already bootstrapped.
export const productionBootstrapStates = pgTable('production_bootstrap_states', {
  id: varchar('id', { length: 64 }).primaryKey(),
  bootstrap_version: varchar('bootstrap_version', { length: 64 }).notNull(),
  admin_user_id: uuid('admin_user_id').notNull(),
  release_id: varchar('release_id', { length: 128 }).notNull(),
  completed_at: timestamp('completed_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

// Immutable migration history for production deployment. The deployment
// runner owns writes to this table; application code only exposes its shape
// for diagnostics and operational tooling.
export const schemaMigrations = pgTable('darshan_schema_migrations', {
  migration_id: varchar('migration_id', { length: 255 }).primaryKey(),
  checksum_sha256: varchar('checksum_sha256', { length: 64 }).notNull(),
  release_id: varchar('release_id', { length: 128 }).notNull(),
  applied_method: varchar('applied_method', { length: 16 }).notNull().default('APPLIED'),
  approval_ticket: varchar('approval_ticket', { length: 128 }),
  execution_state: varchar('execution_state', { length: 16 }).notNull().default('SUCCEEDED'),
  duration_ms: integer('duration_ms').notNull().default(0),
  applied_at: timestamp('applied_at').notNull().defaultNow(),
});

// Recovery authority is application-visible but is advanced only by the
// controlled operator workflow. It fences restored runtime state without
// revoking the retained device certificate.
export const siteRecoveryGenerations = pgTable('site_recovery_generations', {
  site_id: varchar('site_id', { length: 63 }).primaryKey(),
  generation: uuid('generation').notNull().unique(),
  operation_id: uuid('operation_id').notNull().unique(),
  source_run_id: uuid('source_run_id').notNull(),
  source_manifest_sha256: varchar('source_manifest_sha256', { length: 64 }).notNull(),
  state: varchar('state', { length: 40 }).notNull().default('APPLICATION_RECONCILED'),
  reconciliation_completed_at: timestamp('reconciliation_completed_at', { withTimezone: true }),
  reconciliation_receipt_sha256: varchar('reconciliation_receipt_sha256', { length: 64 }),
  reconciliation_action_counts: jsonb('reconciliation_action_counts').$type<Record<string, string>>(),
  write_freeze: boolean('write_freeze').notNull().default(true),
  promoted_at: timestamp('promoted_at', { withTimezone: true }),
  accepted_at: timestamp('accepted_at', { withTimezone: true }),
  rolled_back_at: timestamp('rolled_back_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const recoveryPairingReviews = pgTable(
  'recovery_pairing_reviews',
  {
    generation: uuid('generation').notNull(),
    certificate_id: uuid('certificate_id').notNull(),
    screen_id: uuid('screen_id').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('PENDING'),
    actor_id: uuid('actor_id'),
    reason: text('reason'),
    reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    identity: uniqueIndex('recovery_pairing_reviews_identity_idx').on(table.generation, table.certificate_id),
    screenStatus: index('recovery_pairing_reviews_screen_idx').on(table.generation, table.screen_id, table.status),
  })
);

export const recoveryGenerationChallenges = pgTable(
  'recovery_generation_challenges',
  {
    id: uuid('id').primaryKey(),
    generation: uuid('generation').notNull(),
    screen_id: uuid('screen_id').notNull(),
    certificate_id: uuid('certificate_id').notNull(),
    client_nonce: varchar('client_nonce', { length: 172 }).notNull(),
    server_challenge: varchar('server_challenge', { length: 172 }).notNull().unique(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumed_at: timestamp('consumed_at', { withTimezone: true }),
    receipt_sha256: varchar('receipt_sha256', { length: 64 }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    identity: uniqueIndex('recovery_generation_challenges_identity_idx')
      .on(table.generation, table.screen_id, table.certificate_id, table.client_nonce),
    expiry: index('recovery_generation_challenges_expiry_idx').on(table.expires_at, table.consumed_at),
  })
);

export const controlledRecoveryReportProjections = pgTable(
  'controlled_recovery_report_projections',
  {
    operation_id: uuid('operation_id').primaryKey(),
    site_id: varchar('site_id', { length: 63 }).notNull(),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    report_sha256: varchar('report_sha256', { length: 64 }).notNull(),
    envelope_sha256: varchar('envelope_sha256', { length: 64 }).notNull().unique(),
    source_run_id: uuid('source_run_id').notNull(),
    source_manifest_sha256: varchar('source_manifest_sha256', { length: 64 }).notNull(),
    profile_sha256: varchar('profile_sha256', { length: 64 }).notNull(),
    configuration_sha256: varchar('configuration_sha256', { length: 64 }).notNull(),
    release_id: varchar('release_id', { length: 64 }).notNull(),
    schema_migration_id: varchar('schema_migration_id', { length: 128 }).notNull(),
    target_id: varchar('target_id', { length: 128 }).notNull(),
    recovery_generation: uuid('recovery_generation'),
    state: varchar('state', { length: 40 }).notNull(),
    data_result: varchar('data_result', { length: 64 }).notNull(),
    application_result: varchar('application_result', { length: 64 }).notNull(),
    promotion_result: varchar('promotion_result', { length: 64 }).notNull(),
    rollback_result: varchar('rollback_result', { length: 64 }).notNull(),
    report_created_at: timestamp('report_created_at', { withTimezone: true }).notNull(),
    imported_at: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
    unexecuted_gates: jsonb('unexecuted_gates').$type<string[]>().notNull().default([]),
  },
  (table) => ({
    siteSequenceIdx: uniqueIndex('controlled_recovery_report_site_sequence_idx').on(table.site_id, table.sequence),
    latestIdx: index('controlled_recovery_report_latest_idx').on(table.site_id, table.sequence, table.imported_at),
  }),
);

// One row per worker identity keeps readiness data bounded while allowing an
// API process to reject a deployment whose worker is stale or from another release.
export const workerRuntimeHeartbeats = pgTable(
  'worker_runtime_heartbeats',
  {
    id: varchar('id', { length: 256 }).primaryKey(),
    deployment_id: varchar('deployment_id', { length: 128 }).notNull(),
    server_id: varchar('server_id', { length: 128 }).notNull(),
    release_id: varchar('release_id', { length: 128 }).notNull(),
    observed_at: timestamp('observed_at').notNull().defaultNow(),
    started_at: timestamp('started_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    deploymentUpdatedIdx: index('worker_runtime_heartbeats_deployment_updated_idx').on(
      table.deployment_id,
      table.updated_at
    ),
  })
);

// Emergency types (admin-defined templates)
export const emergencyTypes = pgTable(
  'emergency_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    message: text('message').notNull(),
    severity: varchar('severity', { length: 20 }).notNull().default('HIGH'),
    media_id: uuid('media_id'),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    nameIdx: uniqueIndex('emergency_types_name_idx').on(table.name),
    severityIdx: index('emergency_types_severity_idx').on(table.severity),
  })
);

// Settings
export const settings = pgTable('settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: varchar('key', { length: 255 }).notNull().unique(),
  value: jsonb('value'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const backupRuns = pgTable(
  'backup_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trigger_type: varchar('trigger_type', { length: 20 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    repository_kind: varchar('repository_kind', { length: 32 }).notNull().default('LEGACY_OFF_HOST'),
    coordination_key: varchar('coordination_key', { length: 100 }).notNull().default('site-backup'),
    schedule_identity: varchar('schedule_identity', { length: 10 }),
    stage: varchar('stage', { length: 32 }).notNull().default('QUEUED'),
    attempt_id: uuid('attempt_id'),
    attempt_number: integer('attempt_number').notNull().default(0),
    queue_job_id: uuid('queue_job_id'),
    heartbeat_at: timestamp('heartbeat_at', { withTimezone: true }),
    lease_expires_at: timestamp('lease_expires_at', { withTimezone: true }),
    deadline_at: timestamp('deadline_at', { withTimezone: true }),
    retry_at: timestamp('retry_at', { withTimezone: true }),
    cancellation_requested_at: timestamp('cancellation_requested_at', { withTimezone: true }),
    error_code: varchar('error_code', { length: 100 }),
    captured_at: timestamp('captured_at', { withTimezone: true }),
    verified_at: timestamp('verified_at', { withTimezone: true }),
    repository_id: uuid('repository_id'),
    manifest_sha256: varchar('manifest_sha256', { length: 64 }),
    repository_manifest: jsonb('repository_manifest').$type<Record<string, unknown>>(),
    triggered_by: uuid('triggered_by'),
    started_at: timestamp('started_at', { withTimezone: true }),
    completed_at: timestamp('completed_at', { withTimezone: true }),
    error_message: text('error_message'),
    files: jsonb('files').$type<
      Array<{
        bucket: string;
        object_key: string;
        name: string;
        size: number;
        content_type: string;
        storage_object_id: string;
      }>
    >(),
    // The independently operated repository is the authoritative disaster
    // recovery copy. Keep only its non-secret, checksummed manifest metadata
    // in Postgres; the actual archive bytes do not live on this VM.
    off_host_manifest: jsonb('off_host_manifest').$type<{
      version: 1;
      run_id: string;
      created_at: string;
      release_id: string;
      off_host_uri: string;
      off_host_endpoint: string;
      backup_interval_hours: number;
      retention_days: number;
      manifest_key: string;
      files: Array<{
        name: string;
        object_key: string;
        size: number;
        sha256: string;
        content_type: string;
      }>;
    }>(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('backup_runs_status_idx').on(table.status),
    activeCoordinationIdx: uniqueIndex('backup_runs_one_active_execution_idx')
      .on(table.coordination_key)
      .where(sql`${table.status} in ('PENDING', 'RUNNING', 'RETRY_WAIT')`),
    scheduledIdentityIdx: uniqueIndex('backup_runs_automatic_schedule_identity_idx')
      .on(table.coordination_key, table.schedule_identity)
      .where(sql`${table.trigger_type} = 'AUTOMATIC' and ${table.schedule_identity} is not null`),
    createdAtIdx: index('backup_runs_created_at_idx').on(table.created_at),
  })
);

/**
 * The single PostgreSQL-authoritative coordination row for a logical site.
 * Every admission, capture transition, seal, expiry and emergency preemption
 * linearizes by locking this row.
 */
export const maintenanceSiteState = pgTable(
  'maintenance_site_state',
  {
    site_key: varchar('site_key', { length: 100 }).primaryKey(),
    admission_open: boolean('admission_open').notNull().default(true),
    generation: bigint('generation', { mode: 'number' }).notNull().default(0),
    current_capture_id: uuid('current_capture_id').references(
      (): AnyPgColumn => backupCaptures.id,
      { onDelete: 'restrict' }
    ),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }
);

export const backupCaptures = pgTable(
  'backup_captures',
  {
    id: uuid('id').primaryKey(),
    site_key: varchar('site_key', { length: 100 }).notNull().references(() => maintenanceSiteState.site_key, { onDelete: 'restrict' }),
    generation: bigint('generation', { mode: 'number' }).notNull(),
    backup_run_id: uuid('backup_run_id').notNull().references(() => backupRuns.id, { onDelete: 'restrict' }),
    backup_attempt_id: uuid('backup_attempt_id').notNull(),
    capture_owner: varchar('capture_owner', { length: 160 }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    started_at: timestamp('started_at', { withTimezone: true }).notNull(),
    deadline_at: timestamp('deadline_at', { withTimezone: true }).notNull(),
    staging_inventory_digest: varchar('staging_inventory_digest', { length: 64 }),
    sealed_at: timestamp('sealed_at', { withTimezone: true }),
    reopened_at: timestamp('reopened_at', { withTimezone: true }),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    siteGenerationUnique: uniqueIndex('backup_captures_site_generation_unique').on(table.site_key, table.generation),
    attemptUnique: uniqueIndex('backup_captures_attempt_unique').on(table.backup_run_id, table.backup_attempt_id),
    siteStatusIdx: index('backup_captures_site_status_idx').on(table.site_key, table.status, table.started_at),
    statusCheck: check(
      'backup_captures_status_check',
      sql`${table.status} in ('DRAINING', 'COPYING', 'SEALED', 'ABORTED', 'EXPIRED', 'PREEMPTED')`
    ),
    digestCheck: check(
      'backup_captures_digest_check',
      sql`${table.staging_inventory_digest} is null or ${table.staging_inventory_digest} ~ '^[a-f0-9]{64}$'`
    ),
    exactDeadlineCheck: check(
      'backup_captures_exact_deadline_check',
      sql`${table.deadline_at} = ${table.started_at} + interval '300 seconds'`
    ),
    terminalEvidenceCheck: check(
      'backup_captures_terminal_evidence_check',
      sql`(${table.status} in ('DRAINING', 'COPYING') and ${table.staging_inventory_digest} is null and ${table.sealed_at} is null and ${table.reopened_at} is null)
        or (${table.status} = 'SEALED' and ${table.staging_inventory_digest} is not null and ${table.sealed_at} is not null and ${table.reopened_at} is not null)
        or (${table.status} in ('ABORTED', 'EXPIRED', 'PREEMPTED') and ${table.staging_inventory_digest} is null and ${table.sealed_at} is null and ${table.reopened_at} is not null)`
    ),
  })
);

/**
 * Durable intent and evidence for the filesystem publication side of a local
 * backup. A directory rename and the backup_runs completion update cannot be
 * one transaction; this row lets restart reconciliation determine whether the
 * exact current attempt published bytes without granting a stale attempt new
 * authority.
 */
export const backupPublications = pgTable(
  'backup_publications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    backup_run_id: uuid('backup_run_id').notNull().references(() => backupRuns.id, { onDelete: 'restrict' }),
    backup_attempt_id: uuid('backup_attempt_id').notNull(),
    capture_id: uuid('capture_id').notNull().references(() => backupCaptures.id, { onDelete: 'restrict' }),
    repository_id: uuid('repository_id').notNull(),
    manifest_sha256: varchar('manifest_sha256', { length: 64 }).notNull(),
    incomplete_relative_path: varchar('incomplete_relative_path', { length: 512 }).notNull(),
    published_relative_path: varchar('published_relative_path', { length: 512 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('PREPARED'),
    prepared_at: timestamp('prepared_at', { withTimezone: true }).notNull().defaultNow(),
    published_at: timestamp('published_at', { withTimezone: true }),
    verified_at: timestamp('verified_at', { withTimezone: true }),
    error_code: varchar('error_code', { length: 100 }),
    error_message: text('error_message'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    attemptUnique: uniqueIndex('backup_publications_run_attempt_unique')
      .on(table.backup_run_id, table.backup_attempt_id),
    repositoryManifestUnique: uniqueIndex('backup_publications_repository_manifest_unique')
      .on(table.repository_id, table.manifest_sha256),
    statusIdx: index('backup_publications_status_idx').on(table.status, table.updated_at),
    statusCheck: check(
      'backup_publications_status_check',
      sql`${table.status} in ('PREPARED', 'PUBLISHED', 'VERIFIED', 'UNCERTAIN', 'QUARANTINED')`
    ),
    digestCheck: check(
      'backup_publications_manifest_digest_check',
      sql`${table.manifest_sha256} ~ '^[a-f0-9]{64}$'`
    ),
    evidenceCheck: check(
      'backup_publications_evidence_check',
      sql`(${table.status} = 'PREPARED' and ${table.published_at} is null and ${table.verified_at} is null)
        or (${table.status} in ('PUBLISHED', 'UNCERTAIN', 'QUARANTINED') and ${table.verified_at} is null)
        or (${table.status} = 'VERIFIED' and ${table.published_at} is not null and ${table.verified_at} is not null)`
    ),
  })
);

/**
 * Immutable terminal execution evidence. Artifact deletion mutates the
 * lifecycle row below and never rewrites whether the backup execution
 * succeeded or how a verified-good determination was proven.
 */
export const backupExecutionOutcomes = pgTable(
  'backup_execution_outcomes',
  {
    backup_run_id: uuid('backup_run_id').primaryKey().references(() => backupRuns.id, { onDelete: 'restrict' }),
    site_key: varchar('site_key', { length: 100 }).notNull(),
    repository_id: uuid('repository_id'),
    outcome: varchar('outcome', { length: 32 }).notNull(),
    completed_at: timestamp('completed_at', { withTimezone: true }).notNull(),
    captured_at: timestamp('captured_at', { withTimezone: true }),
    verification_provenance: varchar('verification_provenance', { length: 32 }).notNull().default('NONE'),
    publication_id: uuid('publication_id').references(() => backupPublications.id, { onDelete: 'restrict' }),
    verified_good_at: timestamp('verified_good_at', { withTimezone: true }),
    manifest_sha256: varchar('manifest_sha256', { length: 64 }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    publicationUnique: uniqueIndex('backup_execution_outcomes_publication_unique')
      .on(table.publication_id)
      .where(sql`${table.publication_id} is not null`),
    identityUnique: uniqueIndex('backup_execution_outcomes_identity_unique')
      .on(table.backup_run_id, table.site_key, table.repository_id, table.manifest_sha256),
    retentionOrderIdx: index('backup_execution_outcomes_retention_order_idx')
      .on(table.site_key, table.repository_id, table.captured_at, table.backup_run_id)
      .where(sql`${table.verification_provenance} = 'PUBLICATION_READ_BACK'`),
    outcomeCheck: check(
      'backup_execution_outcomes_outcome_check',
      sql`${table.outcome} in ('SUCCEEDED', 'FAILED', 'CANCELLED')`
    ),
    provenanceCheck: check(
      'backup_execution_outcomes_provenance_check',
      sql`(${table.verification_provenance} = 'PUBLICATION_READ_BACK'
          and ${table.outcome} = 'SUCCEEDED'
          and ${table.repository_id} is not null
          and ${table.publication_id} is not null
          and ${table.captured_at} is not null
          and ${table.verified_good_at} is not null
          and ${table.manifest_sha256} ~ '^[a-f0-9]{64}$')
        or (${table.verification_provenance} = 'LEGACY_UNVERIFIED'
          and ${table.outcome} = 'SUCCEEDED'
          and ${table.publication_id} is null
          and ${table.verified_good_at} is null)
        or (${table.verification_provenance} = 'NONE'
          and ${table.outcome} in ('FAILED', 'CANCELLED')
          and ${table.publication_id} is null
          and ${table.verified_good_at} is null)`
    ),
  })
);

export const backupArtifactLifecycles = pgTable(
  'backup_artifact_lifecycles',
  {
    backup_run_id: uuid('backup_run_id').primaryKey().references(() => backupExecutionOutcomes.backup_run_id, { onDelete: 'restrict' }),
    state: varchar('state', { length: 32 }).notNull().default('UNCERTAIN'),
    state_version: integer('state_version').notNull().default(0),
    last_error_code: varchar('last_error_code', { length: 100 }),
    last_error_message: text('last_error_message'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    stateIdx: index('backup_artifact_lifecycles_state_idx').on(table.state, table.updated_at),
    stateCheck: check(
      'backup_artifact_lifecycles_state_check',
      sql`${table.state} in ('AVAILABLE', 'DELETE_REQUESTED', 'DELETING', 'PARTIALLY_DELETED', 'DELETED', 'UNCERTAIN', 'QUARANTINED')`
    ),
    versionCheck: check('backup_artifact_lifecycles_version_check', sql`${table.state_version} >= 0`),
    errorCheck: check(
      'backup_artifact_lifecycles_error_check',
      sql`(${table.last_error_code} is null) = (${table.last_error_message} is null)`
    ),
  })
);

export const backupRetentionOperations = pgTable(
  'backup_retention_operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    backup_run_id: uuid('backup_run_id').notNull().references(() => backupArtifactLifecycles.backup_run_id, { onDelete: 'restrict' }),
    operation_kind: varchar('operation_kind', { length: 32 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('PREPARED'),
    requested_by: uuid('requested_by').references(() => users.id, { onDelete: 'restrict' }),
    request_action: varchar('request_action', { length: 32 }),
    idempotency_key: varchar('idempotency_key', { length: 200 }),
    owner_token: uuid('owner_token').notNull().defaultRandom(),
    fence_token: uuid('fence_token').notNull(),
    expected_lifecycle_version: integer('expected_lifecycle_version').notNull(),
    requested_at: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    started_at: timestamp('started_at', { withTimezone: true }),
    completed_at: timestamp('completed_at', { withTimezone: true }),
    retry_at: timestamp('retry_at', { withTimezone: true }),
    error_code: varchar('error_code', { length: 100 }),
    error_message: text('error_message'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    unresolvedUnique: uniqueIndex('backup_retention_operations_one_unresolved_idx')
      .on(table.backup_run_id)
      .where(sql`${table.status} in ('PREPARED', 'RUNNING', 'RETRY_WAIT', 'PARTIAL', 'UNCERTAIN')`),
    retryIdx: index('backup_retention_operations_retry_idx')
      .on(table.retry_at)
      .where(sql`${table.status} in ('RETRY_WAIT', 'PARTIAL')`),
    ownerIdx: index('backup_retention_operations_owner_idx').on(table.owner_token, table.fence_token),
    requestIdempotencyUnique: uniqueIndex('backup_retention_operations_request_idempotency_unique')
      .on(table.requested_by, table.request_action, table.idempotency_key)
      .where(sql`${table.idempotency_key} is not null`),
    kindCheck: check(
      'backup_retention_operations_kind_check',
      sql`${table.operation_kind} in ('AUTOMATIC_RETENTION', 'MANUAL_DELETE')`
    ),
    requestMetadataCheck: check(
      'backup_retention_operations_request_metadata_check',
      sql`(${table.operation_kind} = 'MANUAL_DELETE'
          and ${table.requested_by} is not null and ${table.request_action} = 'delete')
        or (${table.operation_kind} = 'AUTOMATIC_RETENTION'
          and ${table.requested_by} is null and ${table.request_action} is null and ${table.idempotency_key} is null)`
    ),
    statusCheck: check(
      'backup_retention_operations_status_check',
      sql`${table.status} in ('PREPARED', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'UNCERTAIN')`
    ),
    versionCheck: check('backup_retention_operations_version_check', sql`${table.expected_lifecycle_version} >= 0`),
    terminalCheck: check(
      'backup_retention_operations_terminal_check',
      sql`(${table.status} = 'SUCCEEDED' and ${table.completed_at} is not null) or (${table.status} <> 'SUCCEEDED')`
    ),
  })
);

export const backupRetentionRequestIdempotency = pgTable(
  'backup_retention_request_idempotency',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requested_by: uuid('requested_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    request_action: varchar('request_action', { length: 32 }).notNull(),
    backup_run_id: uuid('backup_run_id').notNull().references(() => backupRuns.id, { onDelete: 'restrict' }),
    operation_id: uuid('operation_id').notNull().references(() => backupRetentionOperations.id, { onDelete: 'restrict' }),
    idempotency_key: varchar('idempotency_key', { length: 200 }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    actorKeyUnique: uniqueIndex('backup_retention_request_idempotency_actor_key_unique')
      .on(table.requested_by, table.request_action, table.idempotency_key),
    operationIdx: index('backup_retention_request_idempotency_operation_idx').on(table.operation_id),
    actionCheck: check('backup_retention_request_idempotency_action_check', sql`${table.request_action} = 'delete'`),
  })
);

export const backupRetentionArtifactProgress = pgTable(
  'backup_retention_artifact_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    operation_id: uuid('operation_id').notNull().references(() => backupRetentionOperations.id, { onDelete: 'restrict' }),
    artifact_key: varchar('artifact_key', { length: 1024 }).notNull(),
    artifact_kind: varchar('artifact_kind', { length: 32 }).notNull(),
    expected_sha256: varchar('expected_sha256', { length: 64 }),
    expected_size_bytes: varchar('expected_size_bytes', { length: 40 }),
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    attempt_count: integer('attempt_count').notNull().default(0),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
    error_code: varchar('error_code', { length: 100 }),
    error_message: text('error_message'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    identityUnique: uniqueIndex('backup_retention_artifact_progress_identity_unique')
      .on(table.operation_id, table.artifact_key),
    statusIdx: index('backup_retention_artifact_progress_status_idx')
      .on(table.operation_id, table.status, table.artifact_key),
    kindCheck: check(
      'backup_retention_artifact_progress_kind_check',
      sql`${table.artifact_kind} in ('DATABASE', 'OBJECTS', 'CONFIGURATION', 'MANIFEST', 'SIGNATURE', 'OTHER')`
    ),
    statusCheck: check(
      'backup_retention_artifact_progress_status_check',
      sql`${table.status} in ('PENDING', 'DELETING', 'DELETED', 'FAILED', 'UNCERTAIN')`
    ),
    digestCheck: check(
      'backup_retention_artifact_progress_digest_check',
      sql`${table.expected_sha256} is null or ${table.expected_sha256} ~ '^[a-f0-9]{64}$'`
    ),
    sizeCheck: check(
      'backup_retention_artifact_progress_size_check',
      sql`${table.expected_size_bytes} is null or ${table.expected_size_bytes} ~ '^(0|[1-9][0-9]*)$'`
    ),
    attemptCheck: check('backup_retention_artifact_progress_attempt_check', sql`${table.attempt_count} >= 0`),
    deletedCheck: check(
      'backup_retention_artifact_progress_deleted_check',
      sql`(${table.status} = 'DELETED' and ${table.deleted_at} is not null)
        or (${table.status} <> 'DELETED' and ${table.deleted_at} is null)`
    ),
  })
);

export const backupRestoreHoldProjections = pgTable(
  'backup_restore_hold_projections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    backup_run_id: uuid('backup_run_id').notNull().references(() => backupArtifactLifecycles.backup_run_id, { onDelete: 'restrict' }),
    restore_operation_id: uuid('restore_operation_id').notNull(),
    site_key: varchar('site_key', { length: 100 }).notNull(),
    repository_id: uuid('repository_id').notNull(),
    manifest_sha256: varchar('manifest_sha256', { length: 64 }).notNull(),
    capture_generation: bigint('capture_generation', { mode: 'bigint' }).notNull(),
    owner_token: uuid('owner_token').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    projection_version: integer('projection_version').notNull().default(0),
    acquired_at: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
    released_at: timestamp('released_at', { withTimezone: true }),
    uncertain_at: timestamp('uncertain_at', { withTimezone: true }),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    restoreUnique: uniqueIndex('backup_restore_hold_projections_restore_unique').on(table.restore_operation_id),
    identityFk: foreignKey({
      columns: [table.backup_run_id, table.site_key, table.repository_id, table.manifest_sha256],
      foreignColumns: [
        backupExecutionOutcomes.backup_run_id,
        backupExecutionOutcomes.site_key,
        backupExecutionOutcomes.repository_id,
        backupExecutionOutcomes.manifest_sha256,
      ],
      name: 'backup_restore_hold_projections_identity_fk',
    }).onDelete('restrict'),
    protectionIdx: index('backup_restore_hold_projections_protection_idx')
      .on(
        table.site_key,
        table.repository_id,
        table.manifest_sha256,
        table.capture_generation,
        table.backup_run_id,
        table.status
      )
      .where(sql`${table.status} in ('ACTIVE', 'UNCERTAIN')`),
    statusCheck: check(
      'backup_restore_hold_projections_status_check',
      sql`${table.status} in ('ACTIVE', 'RELEASED', 'UNCERTAIN')`
    ),
    siteCheck: check(
      'backup_restore_hold_projections_site_check',
      sql`${table.site_key} ~ '^[a-z0-9][a-z0-9_-]{0,62}$'`
    ),
    digestCheck: check(
      'backup_restore_hold_projections_digest_check',
      sql`${table.manifest_sha256} ~ '^[a-f0-9]{64}$'`
    ),
    generationCheck: check(
      'backup_restore_hold_projections_generation_check',
      sql`${table.capture_generation} > 0`
    ),
    versionCheck: check('backup_restore_hold_projections_version_check', sql`${table.projection_version} >= 0`),
    evidenceCheck: check(
      'backup_restore_hold_projections_evidence_check',
      sql`(${table.status} = 'ACTIVE' and ${table.released_at} is null and ${table.uncertain_at} is null)
        or (${table.status} = 'RELEASED' and ${table.released_at} is not null)
        or (${table.status} = 'UNCERTAIN' and ${table.released_at} is null and ${table.uncertain_at} is not null)`
    ),
  })
);

export const backupRetentionTombstones = pgTable(
  'backup_retention_tombstones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    backup_run_id: uuid('backup_run_id').notNull().references(() => backupExecutionOutcomes.backup_run_id, { onDelete: 'restrict' }),
    operation_id: uuid('operation_id').notNull().references(() => backupRetentionOperations.id, { onDelete: 'restrict' }),
    site_key: varchar('site_key', { length: 100 }).notNull(),
    repository_id: uuid('repository_id'),
    manifest_sha256: varchar('manifest_sha256', { length: 64 }),
    disposition: varchar('disposition', { length: 20 }).notNull(),
    artifact_summary: jsonb('artifact_summary').$type<Record<string, unknown>>().notNull(),
    reason_code: varchar('reason_code', { length: 100 }).notNull(),
    recorded_at: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runUnique: uniqueIndex('backup_retention_tombstones_run_unique').on(table.backup_run_id),
    repositoryIdx: index('backup_retention_tombstones_repository_idx')
      .on(table.site_key, table.repository_id, table.recorded_at),
    dispositionCheck: check(
      'backup_retention_tombstones_disposition_check',
      sql`${table.disposition} in ('PARTIAL', 'DELETED')`
    ),
    digestCheck: check(
      'backup_retention_tombstones_digest_check',
      sql`${table.manifest_sha256} is null or ${table.manifest_sha256} ~ '^[a-f0-9]{64}$'`
    ),
  })
);

export const maintenanceOperations = pgTable(
  'maintenance_operations',
  {
    id: uuid('id').primaryKey(),
    site_key: varchar('site_key', { length: 100 }).notNull().references(() => maintenanceSiteState.site_key, { onDelete: 'restrict' }),
    generation: bigint('generation', { mode: 'number' }).notNull(),
    owner_token: uuid('owner_token').notNull(),
    operation_kind: varchar('operation_kind', { length: 80 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    admitted_at: timestamp('admitted_at', { withTimezone: true }).notNull().defaultNow(),
    lease_expires_at: timestamp('lease_expires_at', { withTimezone: true }).notNull(),
    completed_at: timestamp('completed_at', { withTimezone: true }),
    uncertain_at: timestamp('uncertain_at', { withTimezone: true }),
    resolved_at: timestamp('resolved_at', { withTimezone: true }),
    resolution: varchar('resolution', { length: 32 }),
    resolution_note: text('resolution_note'),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    unresolvedIdx: index('maintenance_operations_unresolved_idx')
      .on(table.site_key, table.status, table.admitted_at)
      .where(sql`${table.status} in ('ACTIVE', 'UNCERTAIN')`),
    leaseIdx: index('maintenance_operations_lease_idx')
      .on(table.lease_expires_at)
      .where(sql`${table.status} = 'ACTIVE'`),
    statusCheck: check(
      'maintenance_operations_status_check',
      sql`${table.status} in ('ACTIVE', 'COMPLETED', 'UNCERTAIN')`
    ),
    resolutionCheck: check(
      'maintenance_operations_resolution_check',
      sql`${table.resolution} is null or ${table.resolution} in ('CONFIRMED_COMPLETED', 'CONFIRMED_ABORTED')`
    ),
  })
);

// API Keys
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    scopes: text('scopes').array(),
    roles: text('roles').array(),
    token_prefix: varchar('token_prefix', { length: 12 }).notNull(),
    secret_hash: varchar('secret_hash', { length: 255 }).notNull(),
    created_by: uuid('created_by').notNull(),
    expires_at: timestamp('expires_at'),
    is_revoked: boolean('is_revoked').notNull().default(false),
    last_used_at: timestamp('last_used_at'),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    prefixIdx: uniqueIndex('api_keys_token_prefix_idx').on(table.token_prefix),
    createdByIdx: index('api_keys_created_by_idx').on(table.created_by),
    expiresAtIdx: index('api_keys_expires_at_idx').on(table.expires_at),
  })
);

// Webhook subscriptions
export const webhookSubscriptions = pgTable(
  'webhook_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    event_types: text('event_types').array().notNull(),
    target_url: varchar('target_url', { length: 2048 }).notNull(),
    secret: varchar('secret', { length: 255 }).notNull(),
    headers: jsonb('headers').$type<Record<string, string> | null>(),
    is_active: boolean('is_active').notNull().default(true),
    last_status: varchar('last_status', { length: 50 }),
    last_status_at: timestamp('last_status_at'),
    created_by: uuid('created_by').notNull(),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    createdByIdx: index('webhook_subscriptions_created_by_idx').on(table.created_by),
    activeIdx: index('webhook_subscriptions_is_active_idx').on(table.is_active),
  })
);

// SSO configuration (single active record)
export const ssoConfigs = pgTable(
  'sso_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: varchar('provider', { length: 50 }).notNull().default('oidc'),
    issuer: varchar('issuer', { length: 255 }).notNull(),
    client_id: varchar('client_id', { length: 255 }).notNull(),
    client_secret: varchar('client_secret', { length: 255 }).notNull(),
    authorization_url: varchar('authorization_url', { length: 512 }),
    token_url: varchar('token_url', { length: 512 }),
    jwks_url: varchar('jwks_url', { length: 512 }),
    redirect_uri: varchar('redirect_uri', { length: 512 }),
    scopes: text('scopes').array(),
    is_active: boolean('is_active').notNull().default(false),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    activeIdx: index('sso_configs_is_active_idx').on(table.is_active),
  })
);

// Conversations (1:1 threads)
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    participant_a: uuid('participant_a').notNull(),
    participant_b: uuid('participant_b').notNull(),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    participantsIdx: uniqueIndex('conversations_participants_idx').on(
      table.participant_a,
      table.participant_b
    ),
  })
);

export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversation_id: uuid('conversation_id').notNull(),
    author_id: uuid('author_id').notNull(),
    content: text('content').notNull(),
    attachments: jsonb('attachments'),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    conversationIdx: index('conversation_messages_conversation_idx').on(table.conversation_id),
    authorIdx: index('conversation_messages_author_idx').on(table.author_id),
  })
);

export const conversationReads = pgTable(
  'conversation_reads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversation_id: uuid('conversation_id').notNull(),
    user_id: uuid('user_id').notNull(),
    last_read_at: timestamp('last_read_at'),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    conversationUserIdx: uniqueIndex('conversation_reads_conversation_user_idx').on(
      table.conversation_id,
      table.user_id
    ),
  })
);

export const chatConversations = pgTable(
  'chat_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: chatConversationTypeEnum('type').notNull(),
    dm_pair_key: varchar('dm_pair_key', { length: 255 }),
    title: varchar('title', { length: 255 }),
    topic: text('topic'),
    purpose: text('purpose'),
    created_by: uuid('created_by').notNull(),
    state: chatConversationStateEnum('state').notNull().default('ACTIVE'),
    invite_policy: chatInvitePolicyEnum('invite_policy').notNull().default('ANY_MEMBER_CAN_INVITE'),
    last_seq: bigint('last_seq', { mode: 'number' }).notNull().default(0),
    metadata: jsonb('metadata').notNull().default({}),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
    archived_at: timestamp('archived_at'),
    deleted_at: timestamp('deleted_at'),
  },
  (table) => ({
    // Keep DM pair uniqueness for non-deleted rows; DELETED tombstones may coexist for audit/history.
    dmPairIdx: uniqueIndex('chat_conversations_dm_pair_key_active_idx')
      .on(table.dm_pair_key)
      .where(sql`"type" = 'DM' AND "state" <> 'DELETED'`),
    stateTypeIdx: index('chat_conversations_state_type_idx').on(table.state, table.type),
    updatedAtIdx: index('chat_conversations_updated_at_idx').on(table.updated_at),
  })
);

export const chatMembers = pgTable(
  'chat_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversation_id: uuid('conversation_id').notNull(),
    user_id: uuid('user_id').notNull(),
    role: chatMemberRoleEnum('role').notNull().default('MEMBER'),
    is_system: boolean('is_system').notNull().default(false),
    joined_at: timestamp('joined_at').notNull().defaultNow(),
    left_at: timestamp('left_at'),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    conversationUserIdx: uniqueIndex('chat_members_conversation_user_idx').on(
      table.conversation_id,
      table.user_id
    ),
    userIdx: index('chat_members_user_idx').on(table.user_id),
    conversationIdx: index('chat_members_conversation_idx').on(table.conversation_id),
  })
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversation_id: uuid('conversation_id').notNull(),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    sender_id: uuid('sender_id').notNull(),
    body_text: text('body_text'),
    body_rich: jsonb('body_rich'),
    also_to_channel: boolean('also_to_channel').notNull().default(false),
    reply_to_message_id: uuid('reply_to_message_id'),
    thread_root_id: uuid('thread_root_id'),
    thread_reply_count: integer('thread_reply_count').notNull().default(0),
    created_at: timestamp('created_at').notNull().defaultNow(),
    edited_at: timestamp('edited_at'),
    deleted_at: timestamp('deleted_at'),
  },
  (table) => ({
    conversationSeqUniqueIdx: uniqueIndex('chat_messages_conversation_seq_idx').on(
      table.conversation_id,
      table.seq
    ),
    conversationIdx: index('chat_messages_conversation_idx').on(table.conversation_id),
    replyToIdx: index('chat_messages_reply_to_idx').on(table.reply_to_message_id),
    threadRootIdx: index('chat_messages_thread_root_idx').on(table.thread_root_id),
  })
);

export const chatPins = pgTable(
  'chat_pins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversation_id: uuid('conversation_id').notNull(),
    message_id: uuid('message_id').notNull(),
    pinned_by: uuid('pinned_by').notNull(),
    pinned_at: timestamp('pinned_at').notNull().defaultNow(),
  },
  (table) => ({
    conversationMessageIdx: uniqueIndex('chat_pins_conversation_message_idx').on(
      table.conversation_id,
      table.message_id
    ),
    conversationIdx: index('chat_pins_conversation_idx').on(table.conversation_id),
    messageIdx: index('chat_pins_message_idx').on(table.message_id),
  })
);

export const chatAttachments = pgTable(
  'chat_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    message_id: uuid('message_id').notNull(),
    media_asset_id: uuid('media_asset_id').notNull(),
    kind: varchar('kind', { length: 50 }),
    ord: integer('ord').notNull().default(0),
    metadata: jsonb('metadata'),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    messageMediaIdx: uniqueIndex('chat_attachments_message_media_idx').on(
      table.message_id,
      table.media_asset_id
    ),
    mediaIdx: index('chat_attachments_media_idx').on(table.media_asset_id),
    messageIdx: index('chat_attachments_message_idx').on(table.message_id),
  })
);

export const chatBookmarks = pgTable(
  'chat_bookmarks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversation_id: uuid('conversation_id').notNull(),
    type: chatBookmarkTypeEnum('type').notNull(),
    label: varchar('label', { length: 255 }).notNull(),
    emoji: varchar('emoji', { length: 32 }),
    url: text('url'),
    media_asset_id: uuid('media_asset_id'),
    message_id: uuid('message_id'),
    created_by: uuid('created_by').notNull(),
    metadata: jsonb('metadata'),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    conversationIdx: index('chat_bookmarks_conversation_idx').on(table.conversation_id),
    messageIdx: index('chat_bookmarks_message_idx').on(table.message_id),
    mediaIdx: index('chat_bookmarks_media_idx').on(table.media_asset_id),
    creatorIdx: index('chat_bookmarks_created_by_idx').on(table.created_by),
  })
);

export const chatReactions = pgTable(
  'chat_reactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    message_id: uuid('message_id').notNull(),
    user_id: uuid('user_id').notNull(),
    emoji: varchar('emoji', { length: 64 }).notNull(),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    messageUserEmojiIdx: uniqueIndex('chat_reactions_message_user_emoji_idx').on(
      table.message_id,
      table.user_id,
      table.emoji
    ),
    messageIdx: index('chat_reactions_message_idx').on(table.message_id),
  })
);

export const chatReceipts = pgTable(
  'chat_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversation_id: uuid('conversation_id').notNull(),
    user_id: uuid('user_id').notNull(),
    last_read_seq: bigint('last_read_seq', { mode: 'number' }).notNull().default(0),
    last_delivered_seq: bigint('last_delivered_seq', { mode: 'number' }).notNull().default(0),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    conversationUserIdx: uniqueIndex('chat_receipts_conversation_user_idx').on(
      table.conversation_id,
      table.user_id
    ),
    userIdx: index('chat_receipts_user_idx').on(table.user_id),
  })
);

export const chatModeration = pgTable(
  'chat_moderation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversation_id: uuid('conversation_id').notNull(),
    user_id: uuid('user_id').notNull(),
    muted_until: timestamp('muted_until'),
    banned_until: timestamp('banned_until'),
    reason: text('reason'),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    conversationUserIdx: uniqueIndex('chat_moderation_conversation_user_idx').on(
      table.conversation_id,
      table.user_id
    ),
    userIdx: index('chat_moderation_user_idx').on(table.user_id),
  })
);

export const chatMessageRevisions = pgTable(
  'chat_message_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    message_id: uuid('message_id').notNull(),
    editor_id: uuid('editor_id').notNull(),
    action: chatRevisionActionEnum('action').notNull(),
    old_body_text: text('old_body_text'),
    old_body_rich: jsonb('old_body_rich'),
    new_body_text: text('new_body_text'),
    new_body_rich: jsonb('new_body_rich'),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    messageIdx: index('chat_message_revisions_message_idx').on(table.message_id, table.created_at),
    editorIdx: index('chat_message_revisions_editor_idx').on(table.editor_id, table.created_at),
  })
);

// Publish targets for schedule publishes
export const publishTargets = pgTable(
  'publish_targets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publish_id: uuid('publish_id').notNull(),
    screen_id: uuid('screen_id'),
    screen_group_id: uuid('screen_group_id'),
    status: varchar('status', { length: 50 }).notNull().default('PENDING'),
    error: text('error'),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    publishIdx: index('publish_targets_publish_id_idx').on(table.publish_id),
    screenIdx: index('publish_targets_screen_id_idx').on(table.screen_id),
  })
);

// Device pairings (for backward compatibility with repositories)
export const devicePairings = pgTable(
  'device_pairings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    device_id: uuid('device_id'),
    pairing_code: varchar('pairing_code', { length: 255 }).notNull(),
    used: boolean('used').notNull().default(false),
    used_at: timestamp('used_at'),
    expires_at: timestamp('expires_at').notNull(),
    width: integer('width'),
    height: integer('height'),
    aspect_ratio: varchar('aspect_ratio', { length: 50 }),
    orientation: varchar('orientation', { length: 50 }),
    model: varchar('model', { length: 255 }),
    codecs: varchar('codecs', { length: 255 }).array(),
    device_info: jsonb('device_info'),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    activeCodeIdx: uniqueIndex('device_pairings_active_code_idx')
      .on(table.pairing_code)
      .where(sql`${table.used} = false`),
  })
);

// Emergencies (for backward compatibility with repositories)
export const emergencies = pgTable('emergencies', {
  id: uuid('id').primaryKey().defaultRandom(),
  emergency_type_id: uuid('emergency_type_id'),
  message: text('message').notNull(),
  priority: varchar('priority', { length: 20 }).notNull().default('HIGH'),
  media_id: uuid('media_id'),
  screen_ids: jsonb('screen_ids')
    .$type<string[]>()
    .notNull()
    .default([] as string[]),
  screen_group_ids: jsonb('screen_group_ids')
    .$type<string[]>()
    .notNull()
    .default([] as string[]),
  target_all: boolean('target_all').notNull().default(false),
  idempotency_key: varchar('idempotency_key', { length: 255 }),
  request_fingerprint: varchar('request_fingerprint', { length: 64 }),
  transition_version: integer('transition_version').notNull().default(1),
  expires_at: timestamp('expires_at'),
  audit_note: text('audit_note'),
  is_active: boolean('is_active').notNull().default(true),
  triggered_by: uuid('triggered_by'),
  triggered_at: timestamp('triggered_at').notNull().defaultNow(),
  cleared_by: uuid('cleared_by'),
  cleared_at: timestamp('cleared_at'),
  clear_reason: text('clear_reason'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  triggerIdempotencyIdx: uniqueIndex('emergencies_trigger_user_idempotency_idx')
    .on(table.triggered_by, table.idempotency_key)
    .where(sql`${table.idempotency_key} IS NOT NULL`),
}));

export const emergencyTransitionOutbox = pgTable(
  'emergency_transition_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    emergency_id: uuid('emergency_id').notNull(),
    transition: varchar('transition', { length: 16 }).notNull(),
    transition_version: integer('transition_version').notNull(),
    selector: jsonb('selector')
      .$type<{ target_all: boolean; screen_ids: string[]; screen_group_ids: string[] }>()
      .notNull(),
    actor_id: uuid('actor_id'),
    status: varchar('status', { length: 16 }).notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    max_attempts: integer('max_attempts').notNull().default(20),
    available_at: timestamp('available_at').notNull().defaultNow(),
    claimed_at: timestamp('claimed_at'),
    completed_at: timestamp('completed_at'),
    last_error: text('last_error'),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    transitionIdx: uniqueIndex('emergency_transition_outbox_transition_idx').on(
      table.emergency_id,
      table.transition_version
    ),
    pendingIdx: index('emergency_transition_outbox_pending_idx').on(
      table.status,
      table.available_at,
      table.created_at
    ),
  })
);
