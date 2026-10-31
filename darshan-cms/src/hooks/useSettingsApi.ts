import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { settingsApi } from "@/api/domains/settings";
import { queryKeys } from "@/api/queryKeys";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/api/apiClient";
import { useAppSelector } from "@/store/hooks";
import type {
  AppearanceSettings,
  BackupDeleteResponse,
  BackupHistoryResponse,
  BackupOperation,
  BackupRecord,
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

const ACTIVE_BACKUP_EXECUTION_STATES = new Set(["PENDING", "RUNNING", "RETRY_WAIT"]);
const ACTIVE_BACKUP_OPERATION_STATES = new Set(["PREPARED", "RUNNING", "RETRY_WAIT", "PARTIAL", "UNCERTAIN"]);

export const backupRecordNeedsPolling = (backup: BackupRecord) =>
  ACTIVE_BACKUP_EXECUTION_STATES.has(backup.execution.status) ||
  Boolean(backup.operation?.status && ACTIVE_BACKUP_OPERATION_STATES.has(backup.operation.status));

export const backupOperationNeedsPolling = (status: string | null | undefined) =>
  Boolean(status && ACTIVE_BACKUP_OPERATION_STATES.has(status));

export const isBackupAuthorizationDenial = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);

export const clearBackupDataOnDenial = async (
  queryClient: QueryClient,
  error: unknown,
  userId?: string,
  currentQueryKey?: readonly unknown[],
) => {
  if (!isBackupAuthorizationDenial(error)) return;
  const currentQueryHash = currentQueryKey ? JSON.stringify(currentQueryKey) : null;
  // Fence every in-flight backup read before redaction. Without cancellation,
  // an older successful request can land after this denial and repopulate rows.
  await queryClient.cancelQueries(
    {
      queryKey: queryKeys.settingsBackupRoot,
      predicate: (query) => !currentQueryHash || JSON.stringify(query.queryKey) !== currentQueryHash,
    },
    { revert: false },
  );
  // Active QueryObservers retain their last successful result when a
  // background refetch fails. Redact every active backup result before
  // removing inactive entries so no observer can continue rendering rows.
  queryClient.setQueriesData({ queryKey: queryKeys.settingsBackupRoot }, () => null);
  queryClient.removeQueries({ queryKey: queryKeys.settingsBackupRoot, type: "inactive" });
  void queryClient.invalidateQueries({ queryKey: queryKeys.authorization(userId) });
};

const failClosedBackupResult = <T extends { data: unknown; error: unknown }>(query: T) => ({
  ...query,
  data: isBackupAuthorizationDenial(query.error) ? undefined : (query.data ?? undefined),
});

export type BackupDeletionRequest = { backupId: string; idempotencyKey: string };

export const shouldRetryBackupDeletion = (failureCount: number, error: unknown) =>
  failureCount < 1 && error instanceof ApiError && (error.status === 408 || error.status >= 500);

export const reconcileAndDeleteBackup = async (
  request: BackupDeletionRequest,
  dependencies: {
    getBackup: typeof settingsApi.getBackup;
    deleteBackupRun: typeof settingsApi.deleteBackupRun;
    onFresh?: (fresh: BackupRecord) => void;
  } = settingsApi,
) => {
  const fresh = await dependencies.getBackup(request.backupId);
  dependencies.onFresh?.(fresh);
  const hasDeletionEvidence = backupOperationNeedsPolling(fresh.operation?.status) ||
    fresh.operation?.status === "SUCCEEDED" || Boolean(fresh.tombstone);
  if (!fresh.permissions.can_delete && !hasDeletionEvidence) {
    throw new ApiError({
      status: 409,
      code: "BACKUP_DELETE_STALE",
      message: "Backup eligibility changed. Review the refreshed retention and protection details.",
      details: { protection_codes: fresh.retention.protection_codes },
    });
  }
  // An earlier request may have been durably admitted while its response was
  // lost. An active operation is replayed with the same idempotency key.
  return dependencies.deleteBackupRun(request.backupId, request.idempotencyKey);
};

const patchBackupInHistory = (
  queryClient: QueryClient,
  backupId: string,
  patch: (record: BackupRecord) => BackupRecord,
) => {
  queryClient.setQueriesData<BackupHistoryResponse>(
    { queryKey: ["settings", "backups", "history"] },
    (current) => current ? { ...current, items: current.items.map((item) => item.id === backupId ? patch(item) : item) } : current,
  );
};

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

export const useGeneralSettings = (authorized = true) =>
  {
    const enabled = useSettingsQueriesEnabled();
    return useQuery({
      queryKey: queryKeys.settingsGeneral,
      queryFn: settingsApi.getGeneral,
      staleTime: 60_000,
      enabled: enabled && authorized,
    });
  };

export const useUpdateGeneralSettings = () =>
  useSettingsMutation<GeneralSettings, GeneralSettings>(
    settingsApi.updateGeneral,
    queryKeys.settingsGeneral,
    "General settings updated",
    "General settings have been saved."
  );

export const useBrandingSettings = (authorized = true) =>
  {
    const enabled = useSettingsQueriesEnabled();
    return useQuery({
      queryKey: queryKeys.settingsBranding,
      queryFn: settingsApi.getBranding,
      staleTime: 60_000,
      enabled: enabled && authorized,
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

export const useSecuritySettings = (authorized = true) =>
  {
    const enabled = useSettingsQueriesEnabled();
    return useQuery({
      queryKey: queryKeys.settingsSecurity,
      queryFn: settingsApi.getSecurity,
      staleTime: 60_000,
      enabled: enabled && authorized,
    });
  };

export const useUpdateSecuritySettings = () =>
  useSettingsMutation<SecuritySettings, SecuritySettings>(
    settingsApi.updateSecurity,
    queryKeys.settingsSecurity,
    "Security settings updated",
    "Session timeout and password requirements have been saved."
  );

export const useAppearanceSettings = (authorized = true) =>
  {
    const enabled = useSettingsQueriesEnabled();
    return useQuery({
      queryKey: queryKeys.settingsAppearance,
      queryFn: settingsApi.getAppearance,
      staleTime: 60_000,
      enabled: enabled && authorized,
    });
  };

export const useUpdateAppearanceSettings = () =>
  useSettingsMutation<AppearanceSettings, AppearanceSettings>(
    settingsApi.updateAppearance,
    queryKeys.settingsAppearance,
    "Appearance updated",
    "Theme and sidebar preferences have been saved."
  );

export const useBackupSettings = (authorized = true) =>
  {
    const enabled = useSettingsQueriesEnabled();
    const queryClient = useQueryClient();
    const userId = useAppSelector((state) => state.auth.user?.id);
    const query = useQuery({
      queryKey: queryKeys.settingsBackups,
      queryFn: async () => {
        try {
          return await settingsApi.getBackups();
        } catch (error) {
          await clearBackupDataOnDenial(queryClient, error, userId, queryKeys.settingsBackups);
          throw error;
        }
      },
      staleTime: 60_000,
      enabled: enabled && authorized,
    });
    return failClosedBackupResult(query);
  };

export const useUpdateBackupSettings = () =>
  useSettingsMutation<BackupSettings, BackupSettings>(
    settingsApi.updateBackups,
    queryKeys.settingsBackups,
    "Advanced settings updated",
    "Backup and log settings have been saved."
  );

export const useBackupRuns = (params: { limit?: number; cursor?: string } = {}, authorized = true) => {
  const enabled = useSettingsQueriesEnabled();
  const queryClient = useQueryClient();
  const userId = useAppSelector((state) => state.auth.user?.id);
  const query = useQuery({
    queryKey: queryKeys.settingsBackupHistory(params),
    queryFn: async () => {
      try {
        return await settingsApi.listBackupRuns(params);
      } catch (error) {
        await clearBackupDataOnDenial(queryClient, error, userId, queryKeys.settingsBackupHistory(params));
        throw error;
      }
    },
    refetchInterval: (query) => query.state.data?.items.some(backupRecordNeedsPolling) ? 5_000 : false,
    enabled: enabled && authorized,
  });
  return failClosedBackupResult(query);
};

export const useBackupDetail = (backupId?: string, authorized = true) => {
  const queryClient = useQueryClient();
  const userId = useAppSelector((state) => state.auth.user?.id);
  const query = useQuery({
    queryKey: queryKeys.settingsBackupDetail(backupId),
    queryFn: async () => {
      try {
        return await settingsApi.getBackup(backupId!);
      } catch (error) {
        await clearBackupDataOnDenial(queryClient, error, userId, queryKeys.settingsBackupDetail(backupId));
        throw error;
      }
    },
    enabled: Boolean(backupId && authorized),
    refetchInterval: (query) => query.state.data && backupRecordNeedsPolling(query.state.data) ? 5_000 : false,
  });
  return failClosedBackupResult(query);
};

export const useBackupOperation = (operationId?: string, authorized = true) => {
  const queryClient = useQueryClient();
  const userId = useAppSelector((state) => state.auth.user?.id);
  const query = useQuery({
    queryKey: queryKeys.settingsBackupOperation(operationId),
    queryFn: async () => {
      try {
        return await settingsApi.getBackupOperation(operationId!);
      } catch (error) {
        await clearBackupDataOnDenial(queryClient, error, userId, queryKeys.settingsBackupOperation(operationId));
        throw error;
      }
    },
    enabled: Boolean(operationId && authorized),
    refetchInterval: (query) => backupOperationNeedsPolling(query.state.data?.status) ? 5_000 : false,
  });
  return failClosedBackupResult(query);
};

export const useRunBackupNow = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const userId = useAppSelector((state) => state.auth.user?.id);

  return useMutation({
    mutationFn: settingsApi.runBackup,
    retry: false,
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: ["settings", "backups", "history"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.settingsBackupDetail(run.id) });
      toast({
        title: "Backup queued",
        description: "A full backup job has been queued.",
      });
    },
    onError: async (error) => {
      await clearBackupDataOnDenial(queryClient, error, userId);
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
  const userId = useAppSelector((state) => state.auth.user?.id);

  return useMutation({
    mutationFn: (request: BackupDeletionRequest) => reconcileAndDeleteBackup(request, {
      getBackup: settingsApi.getBackup,
      deleteBackupRun: settingsApi.deleteBackupRun,
      onFresh: (fresh) => {
        queryClient.setQueryData(queryKeys.settingsBackupDetail(request.backupId), fresh);
        patchBackupInHistory(queryClient, request.backupId, () => fresh);
      },
    }),
    retry: shouldRetryBackupDeletion,
    onSuccess: (result: BackupDeleteResponse, request) => {
      const backupId = request.backupId;
      if (result.disposition === "ACCEPTED") {
        const operation: BackupOperation = {
          id: result.operation_id, kind: "MANUAL_DELETE", status: result.status,
          requested_at: new Date().toISOString(), started_at: null, completed_at: null,
          retry_at: null, error_code: null, progress: [],
        };
        const patch = (record: BackupRecord): BackupRecord => ({
          ...record,
          lifecycle: { ...record.lifecycle, state: "DELETE_REQUESTED" },
          operation,
          permissions: { ...record.permissions, can_delete: false },
        });
        patchBackupInHistory(queryClient, backupId, patch);
        queryClient.setQueryData<BackupRecord>(queryKeys.settingsBackupDetail(backupId), (current) => current ? patch(current) : current);
        void queryClient.invalidateQueries({ queryKey: queryKeys.settingsBackupOperation(result.operation_id) });
      }
      void queryClient.invalidateQueries({ queryKey: ["settings", "backups", "history"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.settingsBackupDetail(backupId) });
      toast({
        title: result.disposition === "ACCEPTED" ? "Deletion accepted" : "Artifacts already deleted",
        description: "The backup remains in history while artifact deletion is recorded.",
      });
    },
    onError: async (error) => {
      await clearBackupDataOnDenial(queryClient, error, userId);
      toast({
        title: "Delete failed",
        description: error instanceof ApiError ? error.message : "Unable to delete backup.",
        variant: "destructive",
      });
    },
  });
};

export const useDownloadBackupArtifact = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const userId = useAppSelector((state) => state.auth.user?.id);
  return useMutation({
    mutationFn: async (request: { backupId: string; artifact: "DATABASE" | "OBJECTS" | "CONFIGURATION" }) => ({
      ...request,
      blob: await settingsApi.downloadBackupArtifact(request.backupId, request.artifact),
    }),
    retry: false,
    onSuccess: ({ backupId, artifact, blob }) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `darshan-${backupId}-${artifact.toLowerCase()}.age`;
      link.click();
      URL.revokeObjectURL(url);
      toast({ title: "Encrypted artifact downloaded", description: `${artifact} ciphertext was downloaded without decryption.` });
    },
    onError: async (error) => {
      await clearBackupDataOnDenial(queryClient, error, userId);
      toast({ title: "Download failed", description: error instanceof ApiError ? error.message : "Unable to download encrypted artifact.",
        variant: "destructive" });
    },
  });
};

export const useRecentLogs = (filters?: { level?: string; limit?: number }, authorized = true) =>
  {
    const enabled = useSettingsQueriesEnabled();
    return useQuery({
      queryKey: queryKeys.settingsLogs(filters),
      queryFn: () => settingsApi.listLogs(filters),
      refetchInterval: 15_000,
      enabled: enabled && authorized,
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
    mutationFn: (assignments: DefaultMediaTargetsSetting["assignments"]) => {
      const current = queryClient.getQueryData<DefaultMediaTargetsSetting>(queryKeys.defaultMediaTargets);
      return settingsApi.updateDefaultMediaTargets(assignments, current?.revision);
    },
    onSuccess: (data) => {
      const nextData: DefaultMediaTargetsSetting = {
        assignments: data?.assignments ?? [],
        revision: data?.revision ?? "",
      };

      queryClient.setQueryData(queryKeys.defaultMediaTargets, nextData);
      void queryClient.invalidateQueries({ queryKey: queryKeys.defaultMediaTargets });
      toast({
        title: "Default media assignments updated",
        description: "Screen and group default media assignments have been saved.",
      });
    },
    onError: (error) => {
      const reason = error instanceof ApiError && error.details && typeof error.details === "object"
        ? (error.details as { reason?: string }).reason
        : undefined;
      if (error instanceof ApiError && error.status === 409 && reason === "DEFAULT_MEDIA_TARGETS_STALE") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.defaultMediaTargets });
        return;
      }
      const message = error instanceof ApiError ? error.message : "Unable to update default media assignments.";
      toast({
        title: "Update failed",
        description: message,
        variant: "destructive",
      });
    },
  });
};
