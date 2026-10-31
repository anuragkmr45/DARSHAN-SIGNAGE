import { describe, expect, it } from "vitest";
import { MutationObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import { ApiError } from "@/api/apiClient";
import { queryKeys } from "@/api/queryKeys";
import type { BackupRecord } from "@/api/types";
import { formatDecimalBytes, presentBackupAlert } from "@/lib/backupPresentation";
import { actionsForPermissionSubject } from "@/lib/permissionMetadata";
import {
  backupOperationNeedsPolling,
  backupRecordNeedsPolling,
  clearBackupDataOnDenial,
  reconcileAndDeleteBackup,
  shouldRetryBackupDeletion,
} from "@/hooks/useSettingsApi";

const backup = (executionStatus: string, operationStatus?: string): BackupRecord => ({
  id: "00000000-0000-4000-8000-000000000001",
  trigger_type: "MANUAL",
  repository: { kind: "LOCAL_FILESYSTEM", id: null },
  stage: "COMPLETE",
  attempt: { id: null, number: 1, heartbeat_at: null, lease_expires_at: null, retry_at: null, deadline_at: null },
  capture: null,
  verification: { provenance: "NONE", publication_id: null, publication_status: null, verified_at: null, manifest_sha256: null },
  execution: { status: executionStatus, outcome: null, error_code: null, started_at: null, completed_at: null, captured_at: null },
  lifecycle: { state: "AVAILABLE", version: 1, error_code: null },
  artifacts: [],
  retention: { eligible: false, expires_at: null, protection_codes: [], restore_hold: "NONE", runtime_supported: true, runtime_reason_code: null },
  permissions: { can_delete: false, can_download: false, download_unavailable_code: "BACKUP_DOWNLOAD_NOT_SUPPORTED", download_unavailable_reason: "BACKUP_STREAMING_RELAY_NOT_IMPLEMENTED" },
  operation: operationStatus ? { id: "op", kind: "MANUAL_DELETE", status: operationStatus, requested_at: null, started_at: null, completed_at: null, retry_at: null, error_code: null, progress: [] } : null,
  tombstone: null,
  created_at: null,
  updated_at: null,
});

describe("backup CMS helpers", () => {
  it("maps stable backup alerts to bounded operator text", () => {
    expect(presentBackupAlert("BACKUP_ACTIVE_ATTEMPT_STUCK")).toMatchObject({
      code: "BACKUP_ACTIVE_ATTEMPT_STUCK", message: expect.stringContaining("heartbeat"),
    });
    expect(presentBackupAlert("BACKUP_UNKNOWN").message).toContain("operator review");
  });
  it("formats arbitrarily large decimal byte strings without Number precision loss", () => {
    expect(formatDecimalBytes("999")).toBe("999 B");
    expect(formatDecimalBytes("123456789012345678901234")).toBe("123456789.01 PB");
    expect(formatDecimalBytes("12.5")).toBe("Size unavailable");
  });

  it("polls only active execution or deletion states", () => {
    expect(backupRecordNeedsPolling(backup("RUNNING"))).toBe(true);
    expect(backupRecordNeedsPolling(backup("SUCCEEDED", "PARTIAL"))).toBe(true);
    expect(backupRecordNeedsPolling(backup("SUCCEEDED", "SUCCEEDED"))).toBe(false);
    expect(backupOperationNeedsPolling("UNCERTAIN")).toBe(true);
    expect(backupOperationNeedsPolling("FAILED")).toBe(false);
  });

  it("uses the server's Backup action allow-list", () => {
    const all = ["manage", "read", "create", "update", "delete", "download"];
    const metadata = { Backup: ["read", "create", "delete", "download"] };
    expect(actionsForPermissionSubject("Backup", all, metadata)).toEqual(metadata.Backup);
    expect(actionsForPermissionSubject("Media", all, metadata)).toEqual(all);
  });

  it("redacts an active observer while authorization is already refreshing", async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const historyKey = queryKeys.settingsBackupHistory();
    const sensitive = { items: [backup("SUCCEEDED")], next_cursor: null, health: {} };
    cache.setQueryData(historyKey, sensitive);

    let finishAuthorization!: (value: { rules: never[] }) => void;
    const authorizationFetch = cache.fetchQuery({
      queryKey: queryKeys.authorization("user-1"),
      queryFn: () => new Promise<{ rules: never[] }>((resolve) => { finishAuthorization = resolve; }),
    });
    const denial = new ApiError({ status: 403, message: "Forbidden" });
    const observer = new QueryObserver(cache, {
      queryKey: historyKey,
      retry: false,
      queryFn: async () => {
        await clearBackupDataOnDenial(cache, denial, "user-1", historyKey);
        throw denial;
      },
    });
    const observed: unknown[] = [];
    const unsubscribe = observer.subscribe((result) => observed.push(result.data));
    await observer.refetch();

    expect(cache.getQueryState(queryKeys.authorization("user-1"))?.fetchStatus).toBe("fetching");
    expect(observer.getCurrentResult().data).toBeNull();
    expect(observed.at(-1)).toBeNull();
    expect(observed.at(-1)).not.toEqual(sensitive);

    finishAuthorization({ rules: [] });
    await authorizationFetch;
    unsubscribe();
    cache.clear();
  });

  it("fences a pending history success before another backup query redacts on denial", async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const historyKey = queryKeys.settingsBackupHistory();
    const policyKey = queryKeys.settingsBackups;
    const sensitive = { items: [backup("SUCCEEDED")], next_cursor: null, health: {} };
    const safeAfterAuthorization = { items: [], next_cursor: null, health: {} };
    let historyCalls = 0;
    let finishLateHistory!: (value: typeof sensitive) => void;
    const historyObserver = new QueryObserver(cache, {
      queryKey: historyKey,
      retry: false,
      queryFn: () => {
        historyCalls += 1;
        if (historyCalls === 1) {
          return new Promise<typeof sensitive>((resolve) => { finishLateHistory = resolve; });
        }
        return Promise.resolve(safeAfterAuthorization);
      },
    });
    const unsubscribeHistory = historyObserver.subscribe(() => undefined);
    expect(historyObserver.getCurrentResult().fetchStatus).toBe("fetching");

    let finishAuthorization!: (value: { rules: never[] }) => void;
    const authorizationFetch = cache.fetchQuery({
      queryKey: queryKeys.authorization("user-1"),
      queryFn: () => new Promise<{ rules: never[] }>((resolve) => { finishAuthorization = resolve; }),
    });
    const denial = new ApiError({ status: 403, message: "Forbidden" });
    const policyObserver = new QueryObserver(cache, {
      queryKey: policyKey,
      enabled: false,
      retry: false,
      queryFn: async () => {
        await clearBackupDataOnDenial(cache, denial, "user-1", policyKey);
        throw denial;
      },
    });
    const unsubscribePolicy = policyObserver.subscribe(() => undefined);
    await policyObserver.refetch();
    expect(historyObserver.getCurrentResult().data).toBeNull();

    finishLateHistory(sensitive);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(historyObserver.getCurrentResult().data).toBeNull();
    expect(cache.getQueryData(historyKey)).toBeNull();

    finishAuthorization({ rules: [] });
    await authorizationFetch;
    await historyObserver.refetch();
    expect(historyObserver.getCurrentResult().data).toEqual(safeAfterAuthorization);

    unsubscribePolicy();
    unsubscribeHistory();
    cache.clear();
  });

  it("replays a lost accepted DELETE response with the same idempotency key", async () => {
    const cache = new QueryClient();
    const request = { backupId: backup("SUCCEEDED").id, idempotencyKey: "delete-action-1" };
    const keys: string[] = [];
    let admitted = false;
    const eligible = backup("SUCCEEDED");
    eligible.permissions.can_delete = true;
    const deleting: BackupRecord = {
      ...eligible,
      permissions: { ...eligible.permissions, can_delete: false },
      lifecycle: { ...eligible.lifecycle, state: "DELETE_REQUESTED" },
      operation: {
        id: "operation-1", kind: "MANUAL_DELETE", status: "PREPARED", requested_at: null,
        started_at: null, completed_at: null, retry_at: null, error_code: null, progress: [],
      },
    };
    const observer = new MutationObserver(cache, {
      mutationFn: (variables: typeof request) => reconcileAndDeleteBackup(variables, {
        getBackup: async () => admitted ? deleting : eligible,
        deleteBackupRun: async (backupId, idempotencyKey) => {
          keys.push(idempotencyKey);
          if (!admitted) {
            admitted = true;
            throw new ApiError({ status: 500, message: "Connection lost after admission" });
          }
          return { disposition: "ACCEPTED" as const, operation_id: "operation-1", backup_run_id: backupId, status: "PREPARED", duplicate: true };
        },
      }),
      retry: shouldRetryBackupDeletion,
      retryDelay: 0,
    });

    const result = await observer.mutate(request);
    expect(result).toMatchObject({ disposition: "ACCEPTED", duplicate: true });
    expect(keys).toEqual([request.idempotencyKey, request.idempotencyKey]);
    cache.clear();
  });

  it("replays a lost DELETE response after deletion already completed", async () => {
    const cache = new QueryClient();
    const request = { backupId: backup("SUCCEEDED").id, idempotencyKey: "delete-action-completed" };
    const keys: string[] = [];
    let admitted = false;
    const eligible = backup("SUCCEEDED");
    eligible.permissions.can_delete = true;
    const deleted: BackupRecord = {
      ...eligible,
      permissions: { ...eligible.permissions, can_delete: false },
      lifecycle: { ...eligible.lifecycle, state: "DELETED" },
      operation: {
        id: "operation-completed", kind: "MANUAL_DELETE", status: "SUCCEEDED", requested_at: null,
        started_at: null, completed_at: "2026-10-29T03:00:00.000Z", retry_at: null,
        error_code: null, progress: [],
      },
      tombstone: {
        disposition: "DELETED", recorded_at: "2026-10-29T03:00:00.000Z", reason_code: "MANUAL_DELETE",
      },
    };
    const observer = new MutationObserver(cache, {
      mutationFn: (variables: typeof request) => reconcileAndDeleteBackup(variables, {
        getBackup: async () => admitted ? deleted : eligible,
        deleteBackupRun: async (backupId, idempotencyKey) => {
          keys.push(idempotencyKey);
          if (!admitted) {
            admitted = true;
            throw new ApiError({ status: 500, message: "Response lost after completed deletion" });
          }
          return {
            disposition: "DELETED" as const,
            operation_id: "operation-completed",
            backup_run_id: backupId,
            tombstone: { disposition: "DELETED" },
          };
        },
      }),
      retry: shouldRetryBackupDeletion,
      retryDelay: 0,
    });

    const result = await observer.mutate(request);
    expect(result).toMatchObject({ disposition: "DELETED", tombstone: { disposition: "DELETED" } });
    expect(keys).toEqual([request.idempotencyKey, request.idempotencyKey]);
    cache.clear();
  });

  it("does not delete an ineligible record without an active operation or retry 4xx", async () => {
    const ineligible = backup("SUCCEEDED");
    let deleteCalls = 0;
    await expect(reconcileAndDeleteBackup(
      { backupId: ineligible.id, idempotencyKey: "delete-action-2" },
      {
        getBackup: async () => ineligible,
        deleteBackupRun: async () => {
          deleteCalls += 1;
          throw new Error("not reached");
        },
      },
    )).rejects.toMatchObject({ status: 409, code: "BACKUP_DELETE_STALE" });
    expect(deleteCalls).toBe(0);
    expect(shouldRetryBackupDeletion(0, new ApiError({ status: 409, message: "Conflict" }))).toBe(false);
  });
});
