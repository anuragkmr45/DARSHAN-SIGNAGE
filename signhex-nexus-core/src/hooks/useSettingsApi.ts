import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsApi } from "@/api/domains/settings";
import { queryKeys } from "@/api/queryKeys";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/api/apiClient";
import { useAppSelector } from "@/store/hooks";
import type {
  AppearanceSettings,
  BackupSettings,
  BrandingSettings,
  DefaultMediaSetting,
  DefaultMediaTargetsSetting,
  DefaultMediaVariantsSetting,
  GeneralSettings,
  SecuritySettings,
} from "@/api/types";

const useSettingsQueriesEnabled = () =>
  useAppSelector((state) => Boolean(state.auth.token || state.auth.user));

function useSettingsMutation<TPayload, TData>(
  mutationFn: (payload: TPayload) => Promise<TData>,
  queryKey: readonly unknown[],
  title: string,
  description: string,
) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      void queryClient.invalidateQueries({ queryKey });
      toast({ title, description });
    },
    onError: (error) => {
      toast({
        title: "Update failed",
        description: error instanceof ApiError ? error.message : "Unable to save settings.",
        variant: "destructive",
      });
    },
  });
}

export const useGeneralSettings = () =>
  {
    const enabled = useSettingsQueriesEnabled();
    return useQuery({
      queryKey: queryKeys.settingsGeneral,
      queryFn: settingsApi.getGeneral,
      staleTime: 60_000,
      enabled,
    });
  };

export const useUpdateGeneralSettings = () =>
  useSettingsMutation<GeneralSettings, GeneralSettings>(
    settingsApi.updateGeneral,
    queryKeys.settingsGeneral,
    "General settings updated",
    "General settings have been saved."
  );

export const useBrandingSettings = () =>
  {
    const enabled = useSettingsQueriesEnabled();
    return useQuery({
      queryKey: queryKeys.settingsBranding,
      queryFn: settingsApi.getBranding,
      staleTime: 60_000,
      enabled,
    });
  };

export const useUpdateBrandingSettings = () =>
  useSettingsMutation<
    Omit<BrandingSettings, "logo_url" | "icon_url" | "favicon_url">,
    BrandingSettings
  >(
    settingsApi.updateBranding,
    queryKeys.settingsBranding,
    "Branding updated",
    "Brand assets and app name have been saved."
  );

export const useSecuritySettings = () =>
  {
    const enabled = useSettingsQueriesEnabled();
    return useQuery({
      queryKey: queryKeys.settingsSecurity,
      queryFn: settingsApi.getSecurity,
      staleTime: 60_000,
      enabled,
    });
  };

export const useUpdateSecuritySettings = () =>
  useSettingsMutation<SecuritySettings, SecuritySettings>(
    settingsApi.updateSecurity,
    queryKeys.settingsSecurity,
    "Security settings updated",
    "Session timeout and password requirements have been saved."
  );

export const useAppearanceSettings = () =>
  {
    const enabled = useSettingsQueriesEnabled();
    return useQuery({
      queryKey: queryKeys.settingsAppearance,
      queryFn: settingsApi.getAppearance,
      staleTime: 60_000,
      enabled,
    });
  };

export const useUpdateAppearanceSettings = () =>
  useSettingsMutation<AppearanceSettings, AppearanceSettings>(
    settingsApi.updateAppearance,
    queryKeys.settingsAppearance,
    "Appearance updated",
    "Theme and sidebar preferences have been saved."
  );

export const useBackupSettings = () =>
  {
    const enabled = useSettingsQueriesEnabled();
    return useQuery({
      queryKey: queryKeys.settingsBackups,
      queryFn: settingsApi.getBackups,
      staleTime: 60_000,
      enabled,
    });
  };

export const useUpdateBackupSettings = () =>
  useSettingsMutation<BackupSettings, BackupSettings>(
    settingsApi.updateBackups,
    queryKeys.settingsBackups,
    "Advanced settings updated",
    "Backup and log settings have been saved."
  );

export const useBackupRuns = () =>
  {
    const enabled = useSettingsQueriesEnabled();
    return useQuery({
      queryKey: queryKeys.settingsBackupRuns,
      queryFn: settingsApi.listBackupRuns,
      refetchInterval: 30_000,
      enabled,
    });
  };

export const useRunBackupNow = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: settingsApi.runBackup,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settingsBackupRuns });
      toast({
        title: "Backup queued",
        description: "A full backup job has been queued.",
      });
    },
    onError: (error) => {
      toast({
        title: "Backup failed",
        description: error instanceof ApiError ? error.message : "Unable to queue backup.",
        variant: "destructive",
      });
    },
  });
};

export const useDeleteBackupRun = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (backupId: string) => settingsApi.deleteBackupRun(backupId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settingsBackupRuns });
      toast({
        title: "Backup deleted",
        description: "Backup archives and history were removed.",
      });
    },
    onError: (error) => {
      toast({
        title: "Delete failed",
        description: error instanceof ApiError ? error.message : "Unable to delete backup.",
        variant: "destructive",
      });
    },
  });
};

export const useRecentLogs = (filters?: { level?: string; limit?: number }) =>
  {
    const enabled = useSettingsQueriesEnabled();
    return useQuery({
      queryKey: queryKeys.settingsLogs(filters),
      queryFn: () => settingsApi.listLogs(filters),
      refetchInterval: 15_000,
      enabled,
    });
  };

export const useDefaultMedia = () =>
  {
    const enabled = useSettingsQueriesEnabled();
    return useQuery({
      queryKey: queryKeys.defaultMedia,
      queryFn: settingsApi.getDefaultMedia,
      staleTime: 60_000,
      enabled,
    });
  };

export const useDefaultMediaVariants = () =>
  {
    const enabled = useSettingsQueriesEnabled();
    return useQuery({
      queryKey: queryKeys.defaultMediaVariants,
      queryFn: settingsApi.getDefaultMediaVariants,
      staleTime: 60_000,
      enabled,
    });
  };

export const useUpdateDefaultMedia = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (mediaId: string | null) => settingsApi.updateDefaultMedia(mediaId),
    onSuccess: (data, mediaId) => {
      const resolvedMediaId = data?.media_id ?? mediaId ?? null;
      const nextData: DefaultMediaSetting = {
        media_id: resolvedMediaId,
        media: data?.media ?? null,
      };
      queryClient.setQueryData(queryKeys.defaultMedia, nextData);
      void queryClient.invalidateQueries({ queryKey: queryKeys.defaultMedia });
      toast({
        title: resolvedMediaId ? "Default media updated" : "Default media cleared",
        description: resolvedMediaId
          ? "New default media has been saved."
          : "Default media has been removed.",
      });
    },
    onError: (error) => {
      const message = error instanceof ApiError ? error.message : "Unable to update default media.";
      toast({
        title: "Update failed",
        description: message,
        variant: "destructive",
      });
    },
  });
};

export const useUpdateDefaultMediaVariants = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variants: Record<string, string | null>) => settingsApi.updateDefaultMediaVariants(variants),
    onSuccess: (data) => {
      const nextData: DefaultMediaVariantsSetting = {
        global_media_id: data?.global_media_id ?? null,
        global_media: data?.global_media ?? null,
        variants: data?.variants ?? [],
      };

      queryClient.setQueryData(queryKeys.defaultMediaVariants, nextData);
      void queryClient.invalidateQueries({ queryKey: queryKeys.defaultMediaVariants });
      toast({
        title: "Default media variants updated",
        description: "Aspect-ratio fallback media has been saved.",
      });
    },
    onError: (error) => {
      const message = error instanceof ApiError ? error.message : "Unable to update default media variants.";
      toast({
        title: "Update failed",
        description: message,
        variant: "destructive",
      });
    },
  });
};

export const useDefaultMediaTargets = () =>
  {
    const enabled = useSettingsQueriesEnabled();
    return useQuery({
      queryKey: queryKeys.defaultMediaTargets,
      queryFn: settingsApi.getDefaultMediaTargets,
      staleTime: 60_000,
      enabled,
    });
  };

export const useUpdateDefaultMediaTargets = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: settingsApi.updateDefaultMediaTargets,
    onSuccess: (data) => {
      const nextData: DefaultMediaTargetsSetting = {
        assignments: data?.assignments ?? [],
      };

      queryClient.setQueryData(queryKeys.defaultMediaTargets, nextData);
      void queryClient.invalidateQueries({ queryKey: queryKeys.defaultMediaTargets });
      toast({
        title: "Default media assignments updated",
        description: "Screen and group default media assignments have been saved.",
      });
    },
    onError: (error) => {
      const message = error instanceof ApiError ? error.message : "Unable to update default media assignments.";
      toast({
        title: "Update failed",
        description: message,
        variant: "destructive",
      });
    },
  });
};
