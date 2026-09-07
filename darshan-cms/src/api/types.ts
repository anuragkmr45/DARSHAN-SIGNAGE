export type RoleId = string;
export type RoleName = string;

export interface RolePermissionGrant {
  action: string;
  subject: string;
}

export interface RolePermissions {
  inherits: RoleId[];
  grants: RolePermissionGrant[];
}

export interface Role {
  id: RoleId;
  name: RoleName;
  description: string | null;
  permissions: RolePermissions;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface PermissionsMetadata {
  actions: string[];
  subjects: string[];
}

export interface User {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  role_id: RoleId;
  role: RoleName;
  department_id?: string | null;
  is_active?: boolean;
}

export interface AuthResponse {
  token?: string;
  csrf_token?: string;
  expiresAt?: string;
  user: User;
}

export interface PaginationParams extends Record<string, string | number | boolean | undefined | null> {
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export interface PaginationEnvelope {
  page: number;
  limit: number;
  total: number;
}

export interface PaginatedApiResponse<T> {
  items: T[];
  pagination: PaginationEnvelope;
}

export interface ApiKey {
  id: string;
  name: string;
  roles?: RoleName[];
  scopes?: string[];
  expires_at?: string | null;
  secret?: string;
  created_at?: string;
  revoked_at?: string | null;
}

export interface LayoutSlot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
}

export interface LayoutSpec {
  slots: LayoutSlot[];
}

export interface LayoutItem {
  id: string;
  name: string;
  description: string;
  aspect_ratio: string;
  spec: LayoutSpec;
  created_by?: string | null;
  is_shared?: boolean;
  created_at: string;
  updated_at: string;
}

export interface LayoutSummary {
  id: string;
  name: string;
  description?: string | null;
  aspect_ratio?: string;
  spec: LayoutSlot[] | LayoutSpec;
  created_by?: string | null;
  is_shared?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface LayoutPagination {
  page: number;
  limit: number;
  total: number;
}

export interface LayoutListResponse {
  items: LayoutItem[];
  pagination: LayoutPagination;
}

export interface LayoutListParams extends PaginationParams {
  search?: string;
  aspect_ratio?: string;
}

export interface LayoutCreatePayload {
  name: string;
  description?: string;
  aspect_ratio: string;
  spec: LayoutSpec;
}

export type LayoutUpdatePayload = LayoutCreatePayload;

export interface Webhook {
  id: string;
  name: string;
  event_types: string[];
  target_url: string;
  headers?: Record<string, string>;
  is_active?: boolean;
  last_status?: string | null;
  last_status_at?: string | null;
  created_at?: string;
}

export interface SsoConfig {
  id: string;
  provider: string;
  issuer: string;
  client_id: string;
  client_secret?: string;
  authorization_url?: string;
  token_url?: string;
  jwks_url?: string;
  redirect_uri?: string;
  scopes?: string[];
  is_active?: boolean;
}

export interface OrgSetting {
  key: string;
  value: unknown;
}

export interface GeneralSettings {
  company_name: string;
  timezone: string;
  language: string;
}

export interface BrandingSettings {
  app_name: string;
  logo_media_id: string | null;
  icon_media_id: string | null;
  favicon_media_id: string | null;
  logo_url: string | null;
  icon_url: string | null;
  favicon_url: string | null;
}

export interface PasswordPolicySettings {
  min_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_number: boolean;
  require_special: boolean;
}

export interface SecuritySettings {
  idle_timeout_minutes: number;
  password_policy: PasswordPolicySettings;
}

export interface AppearanceSettings {
  theme_mode: "light" | "dark" | "system";
  accent_preset: "crimson" | "blue" | "emerald" | "amber" | "slate";
  sidebar_mode: "expanded" | "collapsed" | "auto";
}

export interface BackupSettings {
  automatic_enabled: boolean;
  interval_hours: number;
  log_level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  schedule_managed_by_deployment?: boolean;
  off_host_copy_required?: boolean;
  retention_days?: number | null;
}

export interface BackupRunDownload {
  bucket: string;
  object_key: string;
  name: string;
  size: number;
  content_type: string;
  storage_object_id: string;
  url: string;
}

export interface BackupRun {
  id: string;
  trigger_type: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  error_message: string | null;
  downloads: BackupRunDownload[];
}

export interface RecentAppLog {
  id: string;
  timestamp: string;
  logger: string;
  level: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface DefaultMediaSetting {
  media_id: string | null;
  media?: MediaAsset | null;
}

export interface DefaultMediaVariantSetting {
  aspect_ratio: string;
  media_id: string | null;
  media?: MediaAsset | null;
}

export interface DefaultMediaVariantsSetting {
  global_media_id: string | null;
  global_media?: MediaAsset | null;
  variants: DefaultMediaVariantSetting[];
}

export type DefaultMediaTargetType = "SCREEN" | "GROUP";

export interface DefaultMediaTargetAssignment {
  target_type: DefaultMediaTargetType;
  target_id: string;
  media_id: string;
  aspect_ratio: string;
  media?: MediaAsset | null;
}

export interface DefaultMediaTargetsSetting {
  assignments: DefaultMediaTargetAssignment[];
}

export interface Conversation {
  id: string;
  participant_id: string;
}

export interface ConversationMessage {
  id: string;
  content: string;
  created_at: string;
  author_id: string;
  attachments?: string[];
}

export interface ProofOfPlay {
  id: string;
  screen_id: string;
  media_id: string;
  schedule_id?: string;
  presentation_id?: string;
  status: "COMPLETED" | "INCOMPLETE";
  played_at: string;
  started_at?: string | null;
  ended_at?: string | null;
  created_at?: string;
  url?: string | null;
}

export interface ProofOfPlayPagination {
  page: number;
  limit: number;
  total: number;
}

export interface ProofOfPlayListResponse {
  items: ProofOfPlay[];
  pagination: ProofOfPlayPagination | null;
}

export interface ProofOfPlayFilters extends PaginationParams {
  screen_id?: string;
  media_id?: string;
  schedule_id?: string;
  start?: string;
  end?: string;
  status?: "COMPLETED" | "INCOMPLETE";
  include_url?: boolean;
  group_by?: "day" | "screen" | "media";
}

export interface ReportExportParams {
  resource_type?: string;
  action?: string;
  user_id?: string;
  start_date?: string;
  end_date?: string;
}

export interface ReportSummary {
  uptime?: number;
  total_media?: number;
  open_requests?: number;
  completed_requests?: number;
  active_screens?: number;
  offline_screens?: number;
}

export interface ScheduleReportEntry {
  publish_id: string;
  schedule_id: string;
  schedule_name: string;
  target_id: string;
  target_name: string;
  target_type: "screen" | "group";
  published_at?: string | null;
  taken_down_at?: string | null;
  schedule_start_at?: string | null;
  schedule_end_at?: string | null;
  lifecycle_status: string;
  target_status: string;
  target_error?: string | null;
}

export interface ScheduleReportGroup {
  target_id: string;
  target_name: string;
  target_type: "screen" | "group";
  latest_activity_at?: string | null;
  entries: ScheduleReportEntry[];
}

export interface ScheduleActivityReport {
  range_start: string;
  range_end: string;
  summary: {
    schedules: number;
    target_events: number;
    successful_targets: number;
    failed_targets: number;
    screens: number;
    groups: number;
  };
  by_screen: ScheduleReportGroup[];
  by_group: ScheduleReportGroup[];
}

export interface MetricsOverview {
  totals?: {
    users?: number;
    media?: number;
    screens?: number;
    requests?: number;
    [key: string]: number | undefined;
  };
  screens?: {
    total?: number;
    online_last_5m?: number;
    online?: number;
  };
  storage?: {
    media_bytes?: number;
  };
  schedules?: {
    active?: number;
    active_screens_now?: number;
  };
  proof_of_play?: Record<string, number>;
  system_health?: {
    status?: string;
    heartbeats?: {
      last_5m?: number;
      last_1h?: number;
    };
    last_heartbeat_at?: string | null;
    health_endpoint?: string;
  };
}

export interface HealthStatus {
  status: string;
  timestamp?: string;
}

export interface ObservabilityGrafanaLink {
  label: string;
  url: string;
}

export interface ObservabilityMachineSummary {
  id: string;
  name: string;
  role: "data" | "valkey" | "backend" | "cms" | "observability" | "development";
  status: "healthy" | "degraded" | "critical" | "unknown" | "unconfigured";
  scrape_status: {
    reachable_targets: number;
    expected_targets: number;
  };
  resources: {
    cpu_percent: number | null;
    memory_percent: number | null;
    disk_percent: number | null;
  };
  services: Array<{
    id: string;
    label: string;
    status: "up" | "down" | "unknown";
  }>;
  grafana: {
    dashboard_url: string | null;
  };
}

export interface ObservabilityOverview {
  generated_at: string;
  deployment_mode: "development" | "qa" | "production";
  current_state_source: "backend_and_prometheus";
  fleet: {
    total_players: number | null;
    active_players: number | null;
    inactive_players: number | null;
    offline_players: number | null;
    reachable_players: number | null;
    configured_player_targets: number | null;
  };
  alerts: {
    available: boolean;
    firing: number;
    highest_severity: "critical" | "warning" | "info" | "none" | "unknown";
    status: "healthy" | "degraded" | "critical" | "unknown" | "unconfigured";
  };
  machines: ObservabilityMachineSummary[];
  grafana: {
    enabled: boolean;
    embed_enabled: boolean;
    base_path: string;
    links: {
      backend_service: string | null;
      players_fleet: string | null;
      machines: Record<string, string | null>;
    };
  };
}

export interface ScreenObservabilitySummary {
  generated_at: string;
  screen: {
    id: string;
    name: string;
    status: string;
    health_state: string | null;
    health_reason: string | null;
    last_backend_heartbeat_at: string | null;
  };
  player_scrape: {
    configured: boolean;
    status: "up" | "down" | "unknown";
    last_successful_player_heartbeat_at: string | null;
  };
  latest_player_metrics: {
    cpu_percent: number | null;
    memory_used_bytes: number | null;
    memory_total_bytes: number | null;
    disk_used_bytes: number | null;
    disk_total_bytes: number | null;
    temperature_celsius: number | null;
    battery_percent: number | null;
    power_connected: boolean | null;
    request_queue_items: number | null;
    request_queue_oldest_age_seconds: number | null;
    cache_used_bytes: number | null;
    cache_total_bytes: number | null;
    last_schedule_sync_at: string | null;
    display_count: number | null;
  };
  latest_backend_telemetry: Record<string, unknown> | null;
  grafana: {
    enabled: boolean;
    embed_enabled: boolean;
    links: ObservabilityGrafanaLink[];
    embed_url: string | null;
  };
}

export interface DepartmentRequestsReport {
  department_id: string | null;
  department_name: string | null;
  requests: Array<{
    id: string;
    title: string;
    status: string;
    created_at: string;
  }>;
}

export interface OfflineScreensReport {
  count: number;
  screens: Array<{
    id: string;
    name: string;
    location?: string | null;
    last_heartbeat_at?: string | null;
    offline_hours?: number;
  }>;
}

export interface StorageReport {
  storage: {
    media_bytes: number;
    quota_bytes: number | null;
    quota_percent: number | null;
  };
  expiring_media?: {
    supported: boolean;
  };
}

export interface SystemHealthReport {
  transcode_queue?: {
    pending?: number;
  };
  publishes?: {
    last_published_at?: string | null;
  };
  jobs?: {
    failed_last_24h?: number;
  };
  operators?: {
    active?: number;
  };
}

export interface Department {
  id: string;
  name: string;
  description?: string | null;
  operators?: User[];
  created_at?: string;
  updated_at?: string;
}

export interface AuditLog {
  id: string;
  user_id?: string | null;
  user?: {
    id: string;
    email: string;
    first_name?: string | null;
    last_name?: string | null;
    role_id?: string;
    department_id?: string | null;
    is_active?: boolean;
  } | null;
  resource_type?: string | null;
  resource_id?: string | null;
  action?: string | null;
  changes?: Record<string, unknown> | null;
  ip_address?: string | null;
  user_agent?: string | null;
  storage_object_id?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface Notification {
  id: string;
  type?: string;
  title?: string;
  body?: string;
  read?: boolean;
  read_at?: string | null;
  data?: Record<string, unknown> | ChatNotificationData;
  created_at?: string;
}

export interface NotificationUnreadCountResponse {
  unread_total: number;
}

export interface Presentation {
  id: string;
  name: string;
  description?: string | null;
  layout_id?: string;
  layout?: LayoutSummary;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

export type PresentationFitMode = "cover" | "contain";

export interface PresentationSlotPayload {
  slot_id: string;
  media_id: string;
  order: number;
  duration_seconds: number;
  fit_mode: PresentationFitMode;
  audio_enabled: boolean;
  loop_enabled: boolean;
}

export interface PresentationSlot {
  id: string;
  presentation_id: string;
  slot_id: string;
  media_id: string;
  order: number;
  duration_seconds: number;
  fit_mode: PresentationFitMode;
  audio_enabled: boolean;
  loop_enabled: boolean;
  created_at?: string;
  media?: MediaAsset;
}

export interface Screen {
  id: string;
  name: string;
  location?: string | null;
  aspect_ratio?: string | null;
  width?: number | null;
  height?: number | null;
  status?: string;
  is_active?: boolean;
  last_heartbeat_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface DisplayOutputV1 {
  key: string;
  label?: string | null;
  electron_id: string;
  identity_confidence: "PLATFORM" | "SIGNATURE" | "SESSION";
  primary: boolean;
  detected: boolean;
  bounds_dip: { x: number; y: number; width: number; height: number };
  work_area_dip: { x: number; y: number; width: number; height: number };
  scale_factor: number;
  estimated_backing_px: { width: number; height: number };
  rotation_degrees: number;
  refresh_rate_hz?: number | null;
  orientation: "LANDSCAPE" | "PORTRAIT" | "SQUARE";
  aspect: { exact_key: string; match_key: string; numeric_value: number; relative_error: number };
}

export interface DisplayProfileV1 {
  schema_version: 1;
  runtime_session_id: string;
  observation_seq: number;
  observed_at: string;
  selection: {
    mode: "PRIMARY" | "PINNED";
    preferred_key?: string | null;
    active_key?: string | null;
    fallback_used: boolean;
    fallback_reason?: "TARGET_MISSING" | "AMBIGUOUS_IDENTITY" | "WAYLAND_UNVERIFIED" | null;
  };
  placement: "VERIFIED" | "UNVERIFIED" | "HEADLESS";
  output: DisplayOutputV1 | null;
  inventory: DisplayOutputV1[];
  viewport: {
    width_css_px: number;
    height_css_px: number;
    device_pixel_ratio: number;
    density: "FULL" | "COMPACT" | "MINIMAL";
    conformant: boolean;
    omitted_regions: string[];
  } | null;
}

export interface ScreenDisplayState {
  screen_id: string;
  desired_selection: { mode: "PRIMARY" | "PINNED"; preferred_key?: string | null };
  selection_version: number;
  active_display_key?: string | null;
  placement: "VERIFIED" | "UNVERIFIED" | "HEADLESS" | string;
  profile: DisplayProfileV1 | null;
  profile_revision: number;
  observed_at?: string | null;
  command?: { id: string; status: string; type: string };
}

export interface DisplayPreflightResponse {
  target_screen_ids: string[];
  compatible: boolean;
  issue_hash: string | null;
  issues: Array<{
    screen_id: string;
    presentation_id: string;
    layout_aspect_ratio: string;
    screen_aspect_ratio: number | null;
    usable_area_fraction: number | null;
    profile_revision: number | null;
  }>;
}

export interface ScreenFleetSummary {
  server_time?: string;
  total: number;
  online: number;
  recovery: number;
  stale: number;
  offline: number;
  error: number;
}

export interface ScreenAspectRatio {
  id: string | null;
  name: string;
  aspect_ratio: string | null;
  aspect_ratio_name?: string | null;
  is_fallback?: boolean;
}

export interface ScreenAspectRatioListResponse {
  items: ScreenAspectRatio[];
  defaults?: ScreenAspectRatio[];
}

export interface ScreenStatus {
  id: string;
  name?: string;
  status: "ACTIVE" | "OFFLINE" | "INACTIVE";
  last_heartbeat_at?: string | null;
  current_schedule_id?: string | null;
  current_media_id?: string | null;
  health_state?: "ONLINE" | "OFFLINE" | "STALE" | "ERROR" | "RECOVERY_REQUIRED" | string | null;
  health_reason?: string | null;
  auth_diagnostics?: ScreenOverviewItem["auth_diagnostics"];
  active_pairing?: ScreenOverviewItem["active_pairing"];
  latest_heartbeat?: {
    id: string;
    status?: string | null;
    created_at?: string | null;
    payload?: {
      uptime?: number;
      memory_usage?: number;
      cpu_usage?: number;
      temperature?: number;
      memory_total_mb?: number;
      memory_used_mb?: number;
      memory_free_mb?: number;
      cpu_cores?: number;
      cpu_load_1m?: number;
      cpu_load_5m?: number;
      cpu_load_15m?: number;
      cpu_temp_c?: number;
      gpu_usage?: number;
      gpu_temp_c?: number;
      disk_total_gb?: number;
      disk_used_gb?: number;
      disk_free_gb?: number;
      disk_usage_percent?: number;
      network_ip?: string;
      network_interface?: string;
      network_rtt_ms?: number;
      network_packet_loss_percent?: number;
      network_up_mbps?: number;
      network_down_mbps?: number;
      display_count?: number;
      displays?: Array<{
        id?: string;
        width: number;
        height: number;
        refresh_rate_hz?: number;
        orientation?: "portrait" | "landscape";
        connected?: boolean;
        model?: string;
      }>;
      audio_output?: string;
      volume?: number;
      muted?: boolean;
      app_version?: string;
      os_version?: string;
      hostname?: string;
      device_model?: string;
      device_serial?: string;
      player_uptime_seconds?: number;
      last_error?: string;
      crash_count?: number;
      battery_percent?: number;
      is_charging?: boolean;
      power_source?: "AC" | "BATTERY" | "USB" | "UNKNOWN";
      metrics?: Record<string, unknown>;
    } | null;
  } | null;
  uptime_seconds?: number;
}

export interface ScreenCommandHistoryEntry {
  old_status?: string | null;
  new_status: string;
  reason?: string | null;
  attempt_count?: number | null;
  created_at?: string | null;
}

export interface ScreenCommandDeliveryItem {
  id: string;
  type: string;
  status: string;
  lifecycle_status: string;
  reason?: string | null;
  priority?: number | null;
  attempt_count?: number | null;
  max_attempts?: number | null;
  delivery_attempts?: number | null;
  last_error?: string | null;
  result_payload?: unknown;
  desired_snapshot_id?: string | null;
  desired_default_media_version?: string | null;
  desired_emergency_version?: string | null;
  claimed_at?: string | null;
  lease_expires_at?: string | null;
  acknowledged_at?: string | null;
  completed_at?: string | null;
  expires_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  status_history?: ScreenCommandHistoryEntry[];
}

export interface ScreenOutboxDeliveryItem {
  id: string;
  command_id?: string | null;
  event_type: string;
  reason?: string | null;
  status: string;
  priority?: number | null;
  attempt_count?: number | null;
  max_attempts?: number | null;
  next_attempt_at?: string | null;
  dispatched_at?: string | null;
  last_error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ScreenDeliverySummary {
  total_recent: number;
  pending: number;
  leased: number;
  succeeded: number;
  failed: number;
  latest_status?: string | null;
  latest_lifecycle_status?: string | null;
  latest_command_id?: string | null;
  latest_error?: string | null;
}

export interface ScreenDeliveryStatus {
  screen_id: string;
  server_time?: string;
  desired_state?: {
    screen_id: string;
    state_version: number;
    command_version: number;
    snapshot_id?: string | null;
    default_media_version?: string | null;
    emergency_version?: string | null;
    last_command_id?: string | null;
    last_command_type?: string | null;
    last_command_reason?: string | null;
    last_changed_reason?: string | null;
    updated_at?: string | null;
  } | null;
  publish?: {
    publish_id?: string | null;
    schedule_id?: string | null;
    schedule_name?: string | null;
    snapshot_id?: string | null;
    published_at?: string | null;
    delivery: ScreenDeliverySummary;
  } | null;
  emergency?: {
    active: boolean;
    id?: string | null;
    severity?: string | null;
    media_id?: string | null;
    created_at?: string | null;
    delivery: ScreenDeliverySummary;
  };
  commands: {
    total: number;
    by_status: Record<string, number>;
    by_lifecycle: Record<string, number>;
    pending: number;
    leased: number;
    succeeded: number;
    failed: number;
    expired: number;
    dead_letter: number;
    cancelled: number;
    recent: ScreenCommandDeliveryItem[];
  };
  outbox: {
    total: number;
    by_status: Record<string, number>;
    pending: number;
    dispatching: number;
    dispatched: number;
    failed: number;
    recent: ScreenOutboxDeliveryItem[];
  };
}

export interface ScreenMediaCacheReport {
  id: string;
  media_id?: string | null;
  event_type: string;
  severity: "INFO" | "WARN" | "ERROR" | "CRITICAL" | string;
  source?: string | null;
  status: string;
  error_code?: string | null;
  http_status?: number | null;
  message?: string | null;
  cache_key?: string | null;
  url_host?: string | null;
  url_path_hash?: string | null;
  snapshot_id?: string | null;
  schedule_id?: string | null;
  default_media_version?: string | null;
  playback_mode?: string | null;
  attempt_count?: number | null;
  metadata?: Record<string, unknown> | null;
  reported_at?: string | null;
  received_at?: string | null;
  resolved_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ScreenMediaCacheReportsResponse {
  screen_id: string;
  reports: ScreenMediaCacheReport[];
}

export type ScreenPlaybackSource =
  | "EMERGENCY"
  | "HEARTBEAT"
  | "SCHEDULE"
  | "DEFAULT"
  | "UNKNOWN"
  | string;

export interface ScreenPublishSummary {
  publish_id?: string | null;
  schedule_id?: string | null;
  snapshot_id?: string | null;
  published_at?: string | null;
  schedule_name?: string | null;
  reservation_version?: number | null;
  selection_reason?: string | null;
  schedule_start_at?: string | null;
  schedule_end_at?: string | null;
}

export interface ScreenScheduleSummary {
  id?: string | null;
  name?: string | null;
}

export interface ScreenPlaybackItemMediaSummary {
  id: string;
  name?: string | null;
  type?: string | null;
  thumbnail_url?: string | null;
}

export interface ScreenPlaybackItemSummary {
  item_id: string;
  start_at?: string | null;
  end_at?: string | null;
  presentation_id?: string | null;
  presentation_name?: string | null;
  layout_id?: string | null;
  layout_name?: string | null;
  media: ScreenPlaybackItemMediaSummary[];
}

export interface ScreenPlaybackSummary {
  source?: ScreenPlaybackSource;
  is_live?: boolean;
  current_media_id?: string | null;
  current_schedule_id?: string | null;
  current_scene_id?: string | null;
  active_slots?: Array<{
    scene_id: string;
    slot_id: string;
    item_id: string;
    media_id?: string | null;
    schedule_id?: string | null;
    playback_instance_id: string;
    started_at: string;
  }>;
  current_item_id?: string | null;
  started_at?: string | null;
  ends_at?: string | null;
  heartbeat_received_at?: string | null;
  last_proof_of_play_at?: string | null;
  current_media?: MediaAsset | null;
}

export interface ScreenEmergencySummary {
  media_url?: string | null;
  [key: string]: unknown;
}

export interface ScreenPreviewSummary {
  storage_object_id?: string | null;
  captured_at?: string | null;
  screenshot_url?: string | null;
  stale?: boolean;
}

export interface ScreenOverviewItem extends Screen {
  health_state?: "ONLINE" | "OFFLINE" | "STALE" | "ERROR" | "RECOVERY_REQUIRED" | string;
  health_reason?: string | null;
  auth_diagnostics?: {
    state?: string;
    reason?: string;
    latest_certificate_expires_at?: string | null;
    latest_certificate_revoked_at?: string | null;
    latest_certificate_serial?: string | null;
  } | null;
  active_pairing?: {
    id?: string;
    pairing_code?: string | null;
    created_at?: string | null;
    expires_at?: string | null;
    confirmed?: boolean;
    mode?: "PAIRING" | "RECOVERY" | string | null;
  } | null;
  current_schedule_id?: string | null;
  current_media_id?: string | null;
  current_scene_id?: string | null;
  active_slots?: ScreenPlaybackSummary["active_slots"];
  active_items?: ScheduleItem[];
  upcoming_items?: ScheduleItem[];
  booked_until?: string | null;
  publish?: ScreenPublishSummary | null;
  playback?: ScreenPlaybackSummary | null;
  emergency?: ScreenEmergencySummary | null;
  preview?: ScreenPreviewSummary | null;
}

export interface NowPlaying {
  screen_id: string;
  media_id?: string;
  media_name?: string;
  started_at?: string;
  schedule_id?: string;
}

export interface ScreenNowPlayingResponse {
  server_time?: string;
  screen_id: string;
  status?: string;
  health_state?: "ONLINE" | "OFFLINE" | "STALE" | "ERROR" | "RECOVERY_REQUIRED" | string;
  health_reason?: string | null;
  auth_diagnostics?: ScreenOverviewItem["auth_diagnostics"];
  active_pairing?: ScreenOverviewItem["active_pairing"];
  last_heartbeat_at?: string | null;
  current_schedule_id?: string | null;
  current_media_id?: string | null;
  current_scene_id?: string | null;
  active_slots?: ScreenPlaybackSummary["active_slots"];
  current_schedule?: ScreenScheduleSummary | null;
  publish?: ScreenPublishSummary | null;
  active_items?: ScheduleItem[];
  active_item_summaries?: ScreenPlaybackItemSummary[];
  upcoming_items?: ScheduleItem[];
  upcoming_item_summaries?: ScreenPlaybackItemSummary[];
  booked_until?: string | null;
  playback?: ScreenPlaybackSummary | null;
  emergency?: ScreenEmergencySummary | null;
  preview?: ScreenPreviewSummary | null;
}

export interface ScreenScheduleTimelineItem {
  id: string;
  presentation_id?: string | null;
  presentation_name?: string | null;
  start_at: string;
  end_at: string;
  priority?: number | null;
  is_current?: boolean;
}

export interface ScreenScheduleTimelineRow {
  id: string;
  name: string;
  location?: string | null;
  health_state?: "ONLINE" | "OFFLINE" | "STALE" | "ERROR" | "RECOVERY_REQUIRED" | string;
  health_reason?: string | null;
  playback?: ScreenPlaybackSummary | null;
  publish?: ScreenPublishSummary | null;
  timeline_items: ScreenScheduleTimelineItem[];
}

export interface ScreenScheduleTimelineResponse {
  server_time?: string;
  window_start: string;
  window_end: string;
  screens: ScreenScheduleTimelineRow[];
}

export interface ScreenAvailability {
  screen_id: string;
  is_available_now?: boolean;
  publish?: ScreenPublishSummary | null;
  current_items?: ScheduleItem[];
  current_item_summaries?: ScreenPlaybackItemSummary[];
  next_item?: ScheduleItem | null;
  next_item_summary?: ScreenPlaybackItemSummary | null;
  upcoming_items?: ScheduleItem[];
  upcoming_item_summaries?: ScreenPlaybackItemSummary[];
  booked_until?: string | null;
}

export interface ScreenSnapshotScheduleItem extends ScheduleItem {
  presentation?: Presentation & {
    items?: Array<{ id: string; media_id: string; duration_seconds?: number }>;
    slots?: Array<{
      id: string;
      slot_id: string;
      media_id: string;
      duration_seconds?: number;
      fit_mode?: PresentationFitMode;
      audio_enabled?: boolean;
      loop_enabled?: boolean;
      media?: MediaAsset | null;
    }>;
  };
}

export interface ScreenSnapshot {
  server_time?: string;
  screen_id?: string;
  group_id?: string;
  name?: string;
  description?: string;
  screen_ids?: string[];
  publish?: {
    publish_id?: string;
    schedule_id?: string;
    snapshot_id?: string;
    published_at?: string;
  } | null;
  snapshot?: {
    schedule?: {
      id?: string;
      name?: string;
      description?: string | null;
      start_at?: string;
      end_at?: string;
      items?: ScreenSnapshotScheduleItem[];
    };
    presentations?: Presentation[];
    layouts?: LayoutSummary[];
  } | null;
  media_urls?: Record<string, string>;
  preview?: ScreenPreviewSummary | null;
  emergency?: unknown;
  default_media?: unknown;
  snapshot_at?: string;
  current_media?: {
    id: string;
    name: string;
    url?: string;
  };
  schedule?: {
    id: string;
    name: string;
  };
}

export interface ScreenGroup {
  id: string;
  name: string;
  description?: string | null;
  screen_ids?: string[];
  active_items?: ScheduleItem[];
  upcoming_items?: ScheduleItem[];
  booked_until?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ScreenGroupAvailability {
  group_id: string;
  available_count: number;
  total_count: number;
  screens: Array<{
    screen_id: string;
    is_available: boolean;
  }>;
}

export interface ScreenGroupNowPlaying {
  group_id: string;
  screens: Array<{
    screen_id: string;
    media_id?: string;
    media_name?: string;
  }>;
}

export interface ScreensOverview {
  server_time?: string;
  screens: ScreenOverviewItem[];
  groups: ScreenGroup[];
  now_playing: NowPlaying[];
  stats?: {
    total_screens: number;
    active_screens: number;
    offline_screens: number;
    total_groups: number;
  };
}

export interface ScreenListSummaryResponse extends PaginatedApiResponse<ScreenOverviewItem> {
  server_time?: string;
}

export interface ScreenGroupListSummaryResponse extends PaginatedApiResponse<ScreenGroup> {
  server_time?: string;
}

export interface ScreensSubscribeAck {
  subscribed_all?: boolean;
  subscribed?: string[];
  rejected?: string[];
}

export interface ScreensSyncAck {
  server_time?: string;
  screens: ScreenOverviewItem[];
  groups?: ScreenGroup[];
}

export interface ScreenStateUpdateEvent {
  server_time?: string;
  screen: ScreenOverviewItem;
}

export interface ScreenPreviewUpdateEvent {
  screenId: string;
  captured_at?: string | null;
  screenshot_url?: string | null;
  stale?: boolean;
  storage_object_id?: string | null;
}

export interface ScreenRefreshRequiredEvent {
  reason?: "PUBLISH" | "EMERGENCY" | "GROUP_MEMBERSHIP" | string;
  screen_ids?: string[];
  group_ids?: string[];
}

export interface DevicePairing {
  id: string;
  device_id?: string;
  pairing_code?: string;
  status?: "pending" | "used" | "expired";
  used_at?: string | null;
  expires_at?: string;
  confirmed_at?: string;
  created_at?: string;
  recovery?: {
    mode?: "PAIRING" | "RECOVERY" | string | null;
    recommended_action?: string | null;
  } | null;
  specs?: {
    width?: number | null;
    height?: number | null;
    aspect_ratio?: string | null;
    orientation?: string | null;
    model?: string | null;
    codecs?: string[] | null;
    device_info?: Record<string, unknown> | null;
  } | null;
}

export interface PairingStatusResponse {
  device_id: string;
  paired: boolean;
  confirmed: boolean;
  active_pairing?: {
    id?: string;
    created_at?: string | null;
    expires_at?: string | null;
    confirmed?: boolean;
    mode?: "PAIRING" | "RECOVERY" | string | null;
    confirmed_at?: string | null;
    screen_name?: string | null;
    screen_location?: string | null;
  } | null;
  screen?: {
    id: string;
    name?: string;
    status?: string;
  } | null;
  diagnostics?: {
    auth_state?: string;
    reason?: string;
    recommended_action?: string;
  } | null;
  certificate?: {
    id?: string;
    serial?: string | null;
    expires_at?: string | null;
    revoked_at?: string | null;
    is_revoked?: boolean;
  } | null;
}

export interface DevicePairingServerIdentity {
  environment: string;
  deploymentId: string;
  serverId: string;
  serverTime?: string;
}

export interface DevicePairingOrphanReport {
  generated_at: string;
  limit: number;
  server_identity?: DevicePairingServerIdentity;
  counts: {
    device_certificates: number;
    device_pairings: number;
    heartbeats: number;
    device_commands: number;
    duplicate_identity_conflicts?: number;
  };
  orphans: {
    device_certificates: Array<{
      reason: "ORPHANED_CERTIFICATE";
      id: string;
      screen_id: string;
      serial_suffix: string | null;
      is_revoked: boolean;
      created_at: string | null;
      expires_at: string | null;
      revoked_at: string | null;
    }>;
    device_pairings: Array<{
      reason: "ORPHANED_PAIRING";
      id: string;
      device_id: string;
      used: boolean;
      created_at: string | null;
      expires_at: string | null;
    }>;
    heartbeats: Array<{
      reason: "ORPHANED_HEARTBEAT";
      screen_id: string;
      row_count: number;
      latest_created_at: string | null;
    }>;
    device_commands: Array<{
      reason: "ORPHANED_COMMAND";
      screen_id: string;
      row_count: number;
      latest_created_at: string | null;
    }>;
  };
  duplicate_identity?: {
    conflicts: Array<{
      conflictId: string;
      deviceId: string;
      screenId: string;
      screenName: string | null;
      status: "OPEN" | "RESOLVED" | string;
      severity: "WARN" | "BLOCK" | string;
      activeSessionCount: number;
      firstSeenAt: string | null;
      lastSeenAt: string | null;
      recommendedAction: string;
      sessions: Array<{
        installInstanceSuffix: string | null;
        runtimeSessionSuffix: string | null;
        machineHash: string | null;
        ipHash: string | null;
        userAgentHash: string | null;
        playerVersion: string | null;
        source: string;
        firstSeenAt: string;
        lastSeenAt: string;
        leaseExpiresAt: string;
      }>;
    }>;
  };
}

export interface DevicePairingRevokeResponse {
  device_id: string;
  screen: {
    id: string;
    name?: string | null;
  } | null;
  status: "PAIRING_REVOKED" | "NO_ACTIVE_CREDENTIAL" | string;
  revoked_certificates: number;
  invalidated_pairings: number;
  recommended_action: "PAIR_AGAIN" | string;
  server_identity?: DevicePairingServerIdentity;
}

export interface DevicePairingRequest {
  device_label: string;
  width: number;
  height: number;
  aspect_ratio: string;
  orientation: "landscape" | "portrait";
  model?: string;
  codecs?: string[];
  device_info?: Record<string, unknown>;
}

export interface DeviceCommand {
  id: string;
  type: string;
  payload?: Record<string, unknown>;
  status?: string;
  created_at?: string;
}

export interface EmergencyStatus {
  active: boolean;
  active_count?: number;
  emergency: EmergencyRecord | null;
  active_emergencies?: EmergencyRecord[];
}

export interface EmergencyRecord {
  id: string;
  triggered_by?: string | null;
  message: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | string;
  created_at: string;
  triggered_at?: string | null;
  cleared_at?: string | null;
  cleared_by?: string | null;
  expires_at?: string | null;
  clear_reason?: string | null;
  audit_note?: string | null;
  emergency_type_id?: string | null;
  media_id?: string | null;
  media_url?: string | null;
  screen_ids?: string[];
  screen_group_ids?: string[];
  target_all?: boolean;
  scope?: "GLOBAL" | "GROUP" | "SCREEN" | "MIXED" | string;
  is_active?: boolean;
}

export type MediaType = "IMAGE" | "VIDEO" | "DOCUMENT" | "WEBPAGE";

export interface MediaListParams extends PaginationParams {
  type?: MediaType;
  status?: string;
}

export interface MediaAsset {
  id: string;
  filename: string;
  name?: string;
  display_name?: string;
  type?: MediaType;
  content_type?: string;
  source_content_type?: string;
  source_size?: number;
  size?: number;
  source_url?: string | null;
  status?: string;
  status_reason?: string | null;
  duration_seconds?: number;
  width?: number;
  height?: number;
  ready_object_id?: string | null;
  thumbnail_object_id?: string | null;
  source_bucket?: string;
  source_key?: string;
  media_url?: string | null;
  fallback_media_url?: string | null;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Schedule {
  id: string;
  name: string;
  description?: string | null;
  timezone?: string | null;
  start_at: string;
  end_at: string;
  is_active?: boolean;
  created_by?: string;
}

export interface ScheduleItemPayload {
  presentation_id: string;
  start_at: string;
  end_at: string;
  priority: number;
  screen_ids?: string[];
  screen_group_ids?: string[];
}

export interface ScheduleItem {
  id: string;
  schedule_id: string;
  presentation_id: string;
  start_at: string;
  end_at: string;
  priority: number;
  screen_ids?: string[];
  screen_group_ids?: string[];
  created_at?: string;
}

export interface ScheduleRequestPayload {
  schedule_id: string;
  notes?: string;
}

export interface ReservationSummary {
  state: string | null;
  token: string | null;
  version: number | null;
  hold_expires_at: string | null;
  published_at: string | null;
}

export interface ReservationConflictItem {
  screen_id: string;
  screen_name: string;
  start_at: string;
  end_at: string;
  conflict_start_at: string;
  conflict_end_at: string;
  state: string;
  hold_expires_at: string | null;
  owned_by_current_user: boolean;
  schedule_request_id?: string | null;
  schedule_id?: string | null;
}

export interface ScheduleReservationPreviewPayload {
  schedule_id?: string;
  start_at?: string;
  end_at?: string;
  screen_ids?: string[];
  screen_group_ids?: string[];
}

export interface ScheduleReservationPreviewResponse {
  server_time: string;
  resolved_screen_ids: string[];
  reservation_conflicts: ReservationConflictItem[];
}

export interface ScheduleRequest {
  id: string;
  schedule_id: string;
  notes?: string | null;
  status?: ScheduleRequestStatus;
  reservation_summary?: ReservationSummary | null;
  taken_down_at?: string | null;
  taken_down_by?: string | null;
  takedown_reason?: string | null;
  created_at?: string;
}

export type ScheduleRequestStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "PUBLISHED"
  | "TAKEN_DOWN"
  | "EXPIRED"
  | string;

export interface ScheduleRequestUser {
  id: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  role_id?: string;
  department_id?: string | null;
  department?: Department | null;
}

export interface ScheduleTimeStatus {
  now?: string;
  status?: string;
  is_expired?: boolean;
}

export interface ScheduleRequestListItem {
  id: string;
  status: ScheduleRequestStatus;
  notes?: string | null;
  review_notes?: string | null;
  reviewed_at?: string | null;
  created_at?: string;
  updated_at?: string;
  requested_by_user?: ScheduleRequestUser | null;
  reviewed_by_user?: ScheduleRequestUser | null;
  schedule?: Schedule | null;
  schedule_time_status?: ScheduleTimeStatus | null;
  schedule_items?: ScheduleItem[];
  presentations?: Presentation[];
  presentation_slots?: PresentationSlot[];
  media?: MediaAsset[];
  screens?: Screen[];
  screen_groups?: ScreenGroup[];
  reservation_summary?: ReservationSummary | null;
  taken_down_at?: string | null;
  taken_down_by?: string | null;
  takedown_reason?: string | null;
}

export interface ScheduleRequestPagination {
  page: number;
  limit: number;
  total: number;
}

export interface ScheduleRequestListResponse {
  items: ScheduleRequestListItem[];
  pagination: ScheduleRequestPagination;
}

export interface ScheduleRequestListParams extends PaginationParams {
  status?: ScheduleRequestStatus;
  include?: string;
  q?: string;
  date_field?: "created_at" | "schedule_window";
  date_from?: string;
  date_to?: string;
  sort_direction?: "asc" | "desc";
}

export interface ScheduleRequestStatusSummary {
  counts: {
    pending: number;
    approved: number;
    rejected: number;
    published: number;
    taken_down: number;
    expired: number;
  };
}

export interface DeviceScheduleItem {
  id: string;
  media_id: string;
  type: "image" | "video" | "pdf" | string;
  display_ms?: number;
  fit?: "cover" | "contain" | string;
  media_url?: string;
  preview_url?: string;
  name?: string;
  sha256?: string;
  muted?: boolean;
  loop?: boolean;
  [key: string]: unknown;
}

export interface DeviceScheduleSnapshot {
  id: string;
  version?: number;
  generated_at?: string;
  fetched_at?: string;
  schedule?: {
    id?: string;
    version?: number;
    items?: DeviceScheduleItem[];
  };
  media_urls?: Record<string, string>;
  media_assets?: Record<string, {
    id: string;
    name: string;
    type: string;
    playback_url?: string | null;
    preview_url?: string | null;
    content_type?: string | null;
    source_content_type?: string | null;
    status?: string | null;
    source_url?: string | null;
  }>;
  media?: Array<{
    media_id: string;
    url?: string;
    type?: string;
  }>;
  emergency?: unknown;
  default_media?: unknown;
}

export interface ScheduleRequestReviewResponse {
  id: string;
  status: ScheduleRequestStatus;
  reviewed_by?: string;
  reviewed_at?: string;
  review_notes?: string | null;
  reservation_summary?: ReservationSummary | null;
  taken_down_at?: string | null;
  taken_down_by?: string | null;
  takedown_reason?: string | null;
  resolved_screen_ids?: string[];
  message?: string;
}

export interface ScheduleRequestPublishResponse {
  message?: string;
  schedule_request_id?: string;
  schedule_id?: string;
  publish_id?: string;
  snapshot_id?: string;
  resolved_screen_ids?: string[];
  targets?: number;
  reservation_summary?: ReservationSummary | null;
}

export interface Publish {
  id: string;
  schedule_id: string;
  snapshot_id?: string;
  status?: "ACTIVE" | "TAKEN_DOWN";
  published_at?: string;
  taken_down_at?: string | null;
  taken_down_by?: string | null;
  takedown_reason?: string | null;
  targets?: Array<{
    id: string;
    status: string;
    error?: string | null;
    screen_id?: string | null;
    screen_group_id?: string | null;
  }>;
}

export interface RequestTicket {
  id: string;
  title: string;
  description?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  status?: string;
  assigned_to?: string | null;
}

export type ChatConversationType = "DM" | "GROUP_CLOSED" | "FORUM_OPEN";
export type ChatConversationState = "ACTIVE" | "ARCHIVED" | "DELETED";
export type ChatInvitePolicy =
  | "ANY_MEMBER_CAN_INVITE"
  | "ADMINS_ONLY_CAN_INVITE"
  | "INVITES_DISABLED";
export type ChatViewerRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" | null;
export type ChatMentionAudience = "everyone" | "channel" | "here";
export type ChatMentionRule = "ANY_MEMBER" | "ADMINS_ONLY" | "DISABLED";
export type ChatEditDeletePolicy = "OWN" | "ADMINS_ONLY" | "DISABLED";

export interface ChatMentionPolicy {
  everyone: ChatMentionRule;
  channel: ChatMentionRule;
  here: ChatMentionRule;
}

export interface ChatConversationSettings {
  mention_policy: ChatMentionPolicy;
  edit_policy: ChatEditDeletePolicy;
  delete_policy: ChatEditDeletePolicy;
}

export interface ChatConversationSummary {
  id: string;
  type: ChatConversationType;
  dm_pair_key?: string | null;
  state: ChatConversationState;
  invite_policy?: ChatInvitePolicy;
  last_seq?: number;
  title?: string | null;
  topic?: string | null;
  purpose?: string | null;
  settings?: ChatConversationSettings;
  metadata?: {
    settings?: ChatConversationSettings;
  } | null;
}

export interface ChatConversationMeta {
  id: string;
  type: ChatConversationType;
  state: ChatConversationState;
  title?: string | null;
  topic?: string | null;
  purpose?: string | null;
  invite_policy?: ChatInvitePolicy;
  last_seq?: number;
}

export interface ChatConversationListItem extends ChatConversationSummary {
  unread_count?: number;
  viewer_role?: ChatViewerRole;
  viewer_is_member?: boolean;
  last_message?: {
    id: string;
    seq: number;
    body_text?: string | null;
  } | null;
}

export interface ChatMessageAttachment {
  media_id?: string;
  mediaId?: string;
  media_url?: string | null;
  filename?: string;
  content_type?: string;
  size?: number;
}

export interface ChatReaction {
  message_id: string;
  user_id: string;
  emoji: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  seq: number;
  sender_id: string;
  body_text: string | null;
  body_rich?: { mentions?: string[] } | null;
  reply_to_message_id?: string | null;
  thread_root_id?: string | null;
  thread_reply_count?: number;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  attachments?: Array<string | ChatMessageAttachment>;
  reactions?: ChatReaction[];
  also_to_channel?: boolean;
  alsoToChannel?: boolean;
}

export interface ChatPin {
  id: string;
  conversation_id: string;
  message_id: string;
  pinned_by: string;
  pinned_at: string;
  message?: Partial<ChatMessage>;
}

export type ChatBookmarkType = "LINK" | "FILE" | "MESSAGE";

export interface ChatBookmark {
  id: string;
  conversation_id: string;
  type: ChatBookmarkType;
  label: string;
  emoji?: string | null;
  url?: string | null;
  media_asset_id?: string | null;
  message_id?: string | null;
  created_by: string;
  metadata?: unknown;
  created_at: string;
}

export interface ChatReadReceipt {
  conversation_id: string;
  user_id: string;
  last_read_seq: number;
  last_delivered_seq: number;
  updated_at: string;
}

export interface ChatModerationRecord {
  conversation_id: string;
  user_id: string;
  muted_until?: string | null;
  banned_until?: string | null;
  reason?: string | null;
}

export interface ChatConversationMember {
  user_id: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  is_system?: boolean;
}

export interface ChatErrorEnvelope {
  success?: boolean;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
    traceId?: string;
  };
}

export interface ChatNormalizedError {
  code?: string;
  message: string;
  details?: unknown;
  httpStatus?: number;
  traceId?: string;
}

export interface ChatNotificationData {
  conversationId: string;
  messageId?: string;
  notificationType: "DM" | "MENTION" | "THREAD_REPLY";
  snippet?: string;
}

export interface ChatListConversationsResponse {
  items: ChatConversationListItem[];
}

export interface ChatListMessagesResponse {
  items: ChatMessage[];
}

export interface ChatThreadResponse {
  threadRootId: string;
  items: ChatMessage[];
}

export interface ChatSendMessageResponse {
  message: ChatMessage;
}

export interface ChatUpdateMessageResponse {
  message: ChatMessage;
}

export interface ChatDeleteMessageResponse {
  message: ChatMessage;
}

export interface ChatReactionsResponse {
  message: { id: string };
  reactions: ChatReaction[];
}

export interface ChatMarkReadResponse {
  receipt: ChatReadReceipt;
}

export interface ChatConversationResponse {
  conversation: ChatConversationSummary;
}

export interface ChatResolveViewer {
  is_member: boolean;
  role: string | null;
}

export interface ChatResolveResponse {
  conversation: ChatConversationMeta;
  viewer: ChatResolveViewer;
}

export interface ChatShareLinkResponse {
  path: string;
  url?: string;
}

export interface ChatModerationResponse {
  moderation: ChatModerationRecord;
}

export interface ChatPinResponse {
  pin: ChatPin;
}

export interface ChatPinsListResponse {
  items: ChatPin[];
}

export interface ChatBookmarkResponse {
  bookmark: ChatBookmark;
}

export interface ChatBookmarksListResponse {
  items: ChatBookmark[];
}

export interface ChatSubscribeAck {
  subscribed: string[];
  rejected: string[];
}

export interface ChatMessageNewEvent {
  conversationId: string;
  seq: number;
  message: ChatMessage;
}

export interface ChatMessageUpdatedEvent {
  conversationId: string;
  messageId: string;
  patch: Partial<ChatMessage>;
}

export interface ChatMessageDeletedEvent {
  conversationId: string;
  messageId: string;
  seq: number;
}

export interface ChatConversationUpdatedEvent {
  conversationId: string;
  patch: Partial<ChatConversationListItem> & {
    settings?: ChatConversationSettings;
  };
}

export interface ChatTypingEvent {
  conversationId: string;
  userId: string;
  isTyping: boolean;
  ttlSeconds?: number;
}

export interface ChatPinUpdateEvent {
  conversationId: string;
  messageId: string;
  pinned: boolean;
  pin?: ChatPin;
}

export interface ChatBookmarkUpdateEvent {
  conversationId: string;
  bookmarkId: string;
  op: "add" | "remove";
}
