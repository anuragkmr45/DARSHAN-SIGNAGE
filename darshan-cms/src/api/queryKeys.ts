export const queryKeys = {
  departments: ["departments"] as const,
  screens: ["screens"] as const,
  screensList: (filters?: {
    page?: number;
    limit?: number;
    status?: string;
    q?: string;
    includeSummary?: boolean;
    includeMedia?: boolean;
    includePreview?: boolean;
  }) =>
    [
      "screens",
      "list",
      filters?.page ?? 1,
      filters?.limit ?? 20,
      filters?.status ?? null,
      filters?.q ?? null,
      Boolean(filters?.includeSummary),
      Boolean(filters?.includeMedia),
      Boolean(filters?.includePreview),
    ] as const,
  screensSummary: () => ["screens", "summary"] as const,
  screensOverview: (filters?: { includeMedia?: boolean; includePreview?: boolean; onlineOnly?: boolean }) =>
    [
      "screens",
      "overview",
      Boolean(filters?.includeMedia),
      Boolean(filters?.includePreview),
      Boolean(filters?.onlineOnly),
    ] as const,
  screensScheduleTimeline: (filters?: {
    windowStart?: string;
    windowHours?: number;
    onlyActiveNow?: boolean;
  }) =>
    [
      "screens",
      "schedule-timeline",
      filters?.windowStart ?? null,
      filters?.windowHours ?? 24,
      Boolean(filters?.onlyActiveNow),
    ] as const,
  screenNowPlaying: (
    screenId?: string,
    filters?: { includeMedia?: boolean; includeUrls?: boolean; includePreview?: boolean },
  ) =>
    [
      "screens",
      "now-playing",
      screenId,
      Boolean(filters?.includeMedia),
      Boolean(filters?.includeUrls),
      Boolean(filters?.includePreview),
    ] as const,
  screenGroups: ["screen-groups"] as const,
  screenGroupsList: (filters?: {
    page?: number;
    limit?: number;
    q?: string;
    includeSummary?: boolean;
  }) =>
    [
      "screen-groups",
      "list",
      filters?.page ?? 1,
      filters?.limit ?? 20,
      filters?.q ?? null,
      Boolean(filters?.includeSummary),
    ] as const,
  screenSnapshot: (screenId?: string) => ["screens", "snapshot", screenId] as const,
  screenDeliveryStatus: (screenId?: string) => ["screens", "delivery-status", screenId] as const,
  screenMediaCacheReports: (screenId?: string) => ["screens", "media-cache-reports", screenId] as const,
  screenGroupSnapshot: (groupId?: string) => ["screen-groups", "snapshot", groupId] as const,
  devicePairingOrphans: (limit?: number) => ["device-pairing", "orphans", limit ?? null] as const,
  media: ["media"] as const,
  mediaById: (mediaId?: string) => ["media", "by-id", mediaId] as const,
  presentations: ["presentations"] as const,
  users: ["users"] as const,
  settings: ["settings"] as const,
  observabilityOverview: ["observability", "overview"] as const,
  observabilityScreen: (screenId?: string) => ["observability", "screen", screenId] as const,
  settingsGeneral: ["settings", "general"] as const,
  settingsBranding: ["settings", "branding"] as const,
  settingsSecurity: ["settings", "security"] as const,
  settingsAppearance: ["settings", "appearance"] as const,
  settingsBackups: ["settings", "backups"] as const,
  settingsBackupRuns: ["settings", "backups", "history"] as const,
  settingsLogs: (filters?: { level?: string; limit?: number }) =>
    ["settings", "logs", filters?.level ?? null, filters?.limit ?? null] as const,
  defaultMedia: ["settings", "default-media"] as const,
  defaultMediaScreens: ["settings", "default-media", "screens"] as const,
  defaultMediaScreenGroups: ["settings", "default-media", "screen-groups"] as const,
  defaultMediaVariants: ["settings", "default-media-variants"] as const,
  defaultMediaTargets: ["settings", "default-media-targets"] as const,
  roles: (filters?: { page?: number; limit?: number; search?: string }) =>
    ["roles", filters?.page, filters?.limit, filters?.search] as const,
  role: (roleId?: string) => ["role", roleId] as const,
  permissionsMetadata: ["permissions-metadata"] as const,
  auditLogs: (resource?: string, action?: string) => ["audit-logs", resource, action] as const,
  notifications: ["notifications"] as const,
  scheduleRequests: (filters?: {
    page?: number;
    limit?: number;
    status?: string;
    include?: string;
    q?: string;
    date_field?: string;
    date_from?: string;
    date_to?: string;
    sort_direction?: string;
  }) =>
    [
      "schedule-requests",
      filters?.status,
      filters?.page,
      filters?.limit,
      filters?.include,
      filters?.q ?? null,
      filters?.date_field ?? null,
      filters?.date_from ?? null,
      filters?.date_to ?? null,
      filters?.sort_direction ?? null,
    ] as const,
  scheduleRequestSummary: (filters?: {
    q?: string;
    date_field?: string;
    date_from?: string;
    date_to?: string;
  }) =>
    [
      "schedule-requests",
      "status-summary",
      filters?.q ?? null,
      filters?.date_field ?? null,
      filters?.date_from ?? null,
      filters?.date_to ?? null,
    ] as const,
  scheduleReservationsPreview: (payload?: {
    schedule_id?: string | null;
    start_at?: string | null;
    end_at?: string | null;
    screen_ids?: string[];
    screen_group_ids?: string[];
  }) =>
    [
      "schedule-reservations",
      "preview",
      payload?.schedule_id ?? null,
      payload?.start_at ?? null,
      payload?.end_at ?? null,
      (payload?.screen_ids ?? []).join(","),
      (payload?.screen_group_ids ?? []).join(","),
    ] as const,
  emergencyStatus: ["emergency-status"] as const,
  layouts: (filters?: {
    page?: number;
    limit?: number;
    search?: string;
    aspect_ratio?: string;
  }) =>
    [
      "layouts",
      filters?.page,
      filters?.limit,
      filters?.search,
      filters?.aspect_ratio,
    ] as const,
};
