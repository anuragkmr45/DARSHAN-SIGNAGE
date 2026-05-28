import { apiClient } from "../apiClient";
import { endpoints } from "../endpoints";
import type {
  AppearanceSettings,
  BackupRun,
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
    apiClient.request<{ id: string; status: string; trigger_type: string }>({
      path: endpoints.settings.backupRun,
      method: "POST",
      body: {},
    }),

  deleteBackupRun: (backupId: string) =>
    apiClient.request<{ id: string; deleted: true }>({
      path: endpoints.settings.backupById(backupId),
      method: "DELETE",
    }),

  listBackupRuns: () =>
    apiClient.request<{ items: BackupRun[] }>({
      path: endpoints.settings.backupHistory,
      method: "GET",
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

  updateDefaultMediaTargets: (assignments: DefaultMediaTargetsSetting["assignments"]) =>
    apiClient.request<DefaultMediaTargetsSetting>({
      path: endpoints.settings.defaultMediaTargets,
      method: "PUT",
      body: { assignments },
    }),
};
