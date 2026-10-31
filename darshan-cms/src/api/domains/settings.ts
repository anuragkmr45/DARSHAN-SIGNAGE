import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type {
  AppearanceSettings,
  BackupDeleteResponse,
  BackupHistoryResponse,
  BackupOperationDetail,
  BackupRecord,
  BackupRunResponse,
  BackupSettings,
  BrandingSettings,
  DefaultMediaSetting,
  DefaultMediaTargetsSetting,
  DefaultMediaVariantsSetting,
  GeneralSettings,
  OrgSetting,
  RecentAppLog,
  SecuritySettings,
} from "../types";

export const settingsApi = {
  list: () =>
    apiClient.request<{ items: OrgSetting[] }>({
      path: endpoints.settings.base,
      method: "GET",
    }),

  upsert: (payload: OrgSetting) =>
    apiClient.request<OrgSetting>({
      path: endpoints.settings.base,
      method: "POST",
      body: payload,
    }),

  getGeneral: () =>
    apiClient.request<GeneralSettings>({
      path: endpoints.settings.general,
      method: "GET",
    }),

  updateGeneral: (payload: GeneralSettings) =>
    apiClient.request<GeneralSettings>({
      path: endpoints.settings.general,
      method: "PUT",
      body: payload,
    }),

  getBranding: () =>
    apiClient.request<BrandingSettings>({
      path: endpoints.settings.branding,
      method: "GET",
    }),

  updateBranding: (payload: Omit<BrandingSettings, "logo_url" | "icon_url" | "favicon_url">) =>
    apiClient.request<BrandingSettings>({
      path: endpoints.settings.branding,
      method: "PUT",
      body: payload,
    }),

  getSecurity: () =>
    apiClient.request<SecuritySettings>({
      path: endpoints.settings.security,
      method: "GET",
    }),

  updateSecurity: (payload: SecuritySettings) =>
    apiClient.request<SecuritySettings>({
      path: endpoints.settings.security,
      method: "PUT",
      body: payload,
    }),

  getAppearance: () =>
    apiClient.request<AppearanceSettings>({
      path: endpoints.settings.appearance,
      method: "GET",
    }),

  updateAppearance: (payload: AppearanceSettings) =>
    apiClient.request<AppearanceSettings>({
      path: endpoints.settings.appearance,
      method: "PUT",
      body: payload,
    }),

  getBackups: () =>
    apiClient.request<BackupSettings>({
      path: endpoints.settings.backups,
      method: "GET",
    }),

  updateBackups: (payload: BackupSettings) =>
    apiClient.request<BackupSettings>({
      path: endpoints.settings.backups,
      method: "PUT",
      body: payload,
    }),

  runBackup: () =>
    apiClient.request<BackupRunResponse>({
      path: endpoints.settings.backupRun,
      method: "POST",
      body: {},
    }),

  deleteBackupRun: (backupId: string, idempotencyKey: string) =>
    apiClient.request<BackupDeleteResponse>({
      path: endpoints.settings.backupById(backupId),
      method: "DELETE",
      headers: { "Idempotency-Key": idempotencyKey },
    }),

  listBackupRuns: (params?: { limit?: number; cursor?: string }) =>
    apiClient.request<BackupHistoryResponse>({
      path: endpoints.settings.backupHistory,
      method: "GET",
      query: params,
    }),

  getBackup: (backupId: string) =>
    apiClient.request<BackupRecord>({
      path: endpoints.settings.backupById(backupId),
      method: "GET",
    }),

  getBackupOperation: (operationId: string) =>
    apiClient.request<BackupOperationDetail>({
      path: endpoints.settings.backupOperation(operationId),
      method: "GET",
    }),

  downloadBackupArtifact: (backupId: string, artifact: "DATABASE" | "OBJECTS" | "CONFIGURATION") =>
    apiClient.request<Blob>({
      path: endpoints.settings.backupDownload(backupId),
      method: "GET",
      query: { artifact },
      responseType: "blob",
      timeoutMs: 30 * 60_000,
    }),

  listLogs: (params?: { level?: string; limit?: number }) =>
    apiClient.request<{ items: RecentAppLog[] }>({
      path: endpoints.settings.logs,
      method: "GET",
      query: params,
    }),

  getDefaultMedia: () =>
    apiClient.request<DefaultMediaSetting>({
      path: endpoints.settings.defaultMedia,
      method: "GET",
    }),

  updateDefaultMedia: (mediaId: string | null) =>
    apiClient.request<DefaultMediaSetting>({
      path: endpoints.settings.defaultMedia,
      method: "PUT",
      body: { media_id: mediaId },
    }),

  getDefaultMediaVariants: () =>
    apiClient.request<DefaultMediaVariantsSetting>({
      path: endpoints.settings.defaultMediaVariants,
      method: "GET",
    }),

  updateDefaultMediaVariants: (variants: Record<string, string | null>) =>
    apiClient.request<DefaultMediaVariantsSetting>({
      path: endpoints.settings.defaultMediaVariants,
      method: "PUT",
      body: { variants },
    }),

  getDefaultMediaTargets: () =>
    apiClient.request<DefaultMediaTargetsSetting>({
      path: endpoints.settings.defaultMediaTargets,
      method: "GET",
    }),

  updateDefaultMediaTargets: (assignments: DefaultMediaTargetsSetting["assignments"], expectedRevision?: string) =>
    apiClient.request<DefaultMediaTargetsSetting>({
      path: endpoints.settings.defaultMediaTargets,
      method: "PUT",
      body: { assignments, expected_revision: expectedRevision },
    }),
};
