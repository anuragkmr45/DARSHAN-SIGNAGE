import { useMemo, useState } from "react";
import { AlertTriangle, Database, Download, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import { ApiError } from "@/api/apiClient";
import type { BackupRecord } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
  useBackupOperation,
  useBackupRuns,
  useBackupSettings,
  useDeleteBackupRun,
  useDownloadBackupArtifact,
  useRunBackupNow,
} from "@/hooks/useSettingsApi";
import { formatDecimalBytes, presentBackupAlert } from "@/lib/backupPresentation";

const formatInstant = (value: string | null | undefined) => value
  ? new Date(value).toLocaleString()
  : "Not recorded";

const errorText = (error: unknown) => {
  if (!(error instanceof ApiError)) return "Backup data could not be loaded.";
  return error.code ? `${error.message} (${error.code})` : error.message;
};

const codeLabel = (code: string) => code.replace(/^BACKUP_/, "").replace(/_/g, " ").toLowerCase();

function BackupRow({
  backup,
  canDelete,
  canDownload,
  deleting,
  onDelete,
  onDownload,
}: {
  backup: BackupRecord;
  canDelete: boolean;
  canDownload: boolean;
  deleting: boolean;
  onDelete: () => void;
  onDownload: (artifact: "DATABASE" | "OBJECTS" | "CONFIGURATION") => void;
}) {
  return (
    <article className="space-y-4 rounded-lg border p-4" data-testid={`backup-row-${backup.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{backup.trigger_type}</Badge>
            <Badge>{backup.execution.status}</Badge>
            <Badge variant="secondary">Artifacts: {backup.lifecycle.state}</Badge>
            {backup.tombstone ? <Badge variant="destructive">Tombstone: {backup.tombstone.disposition}</Badge> : null}
          </div>
          <p className="break-all text-xs text-muted-foreground">Run {backup.id}</p>
          <p className="text-sm text-muted-foreground">Created {formatInstant(backup.created_at)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canDownload && !backup.permissions.can_download ? (
            <span className="text-xs text-muted-foreground" title={backup.permissions.download_unavailable_reason ?? undefined}>
              Download unavailable{backup.permissions.download_unavailable_code ? ` (${backup.permissions.download_unavailable_code})` : ""}
            </span>
          ) : null}
          {canDelete ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={!backup.permissions.can_delete || deleting || Boolean(backup.tombstone)}
              onClick={onDelete}
            >
              <Trash2 className="mr-2 h-4 w-4" />Delete artifacts
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 text-sm md:grid-cols-3">
        <div className="rounded-md bg-muted/30 p-3">
          <p className="font-medium">Execution</p>
          <p>Outcome: {backup.execution.outcome ?? "Incomplete"}</p>
          <p>Stage: {backup.stage}</p>
          <p>Captured: {formatInstant(backup.execution.captured_at)}</p>
          {backup.execution.error_code ? <p className="text-destructive">{backup.execution.error_code}</p> : null}
        </div>
        <div className="rounded-md bg-muted/30 p-3">
          <p className="font-medium">Capture & verification</p>
          <p>Capture: {backup.capture?.status ?? "Not recorded"}</p>
          <p>Verification: {backup.verification.provenance}</p>
          <p>Verified: {formatInstant(backup.verification.verified_at)}</p>
        </div>
        <div className="rounded-md bg-muted/30 p-3">
          <p className="font-medium">Retention & protection</p>
          <p>Expires: {formatInstant(backup.retention.expires_at)}</p>
          <p>Restore hold: {backup.retention.restore_hold}</p>
          <p>{backup.retention.eligible ? "Eligible for deletion" : "Protected from deletion"}</p>
          {backup.retention.protection_codes.map((code) => <p key={code} title={code}>{codeLabel(code)}</p>)}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Artifacts</p>
        {backup.artifacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No artifact inventory is available.</p>
        ) : backup.artifacts.map((artifact, index) => (
          <div key={`${artifact.kind}-${artifact.name}-${index}`} className="flex flex-wrap justify-between gap-2 text-sm">
            <span>{artifact.kind}: {artifact.name}</span>
            <span className="flex items-center gap-2 text-muted-foreground">
              {formatDecimalBytes(artifact.size_bytes)}
              {canDownload && backup.permissions.can_download && ["DATABASE", "OBJECTS", "CONFIGURATION"].includes(artifact.kind) ? (
                <Button size="sm" variant="outline" onClick={() => onDownload(artifact.kind as "DATABASE" | "OBJECTS" | "CONFIGURATION")}>
                  <Download className="mr-2 h-4 w-4" />Encrypted
                </Button>
              ) : null}
            </span>
          </div>
        ))}
      </div>

      {backup.operation ? (
        <div className="space-y-2 rounded-md border p-3 text-sm" aria-label="Deletion operation">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Deletion operation</span>
            <Badge variant="outline">{backup.operation.status ?? "UNKNOWN"}</Badge>
          </div>
          <p>Requested {formatInstant(backup.operation.requested_at)}</p>
          {backup.operation.error_code ? <p className="text-destructive">{backup.operation.error_code}</p> : null}
          {backup.operation.progress.map((progress, index) => (
            <p key={`${progress.kind}-${index}`}>
              {progress.kind}: {progress.status} · {formatDecimalBytes(progress.size_bytes)} · attempts {progress.attempt_count}
            </p>
          ))}
        </div>
      ) : null}
      {backup.tombstone ? (
        <p className="text-sm text-muted-foreground">
          Artifact deletion is durably recorded. The history and deletion record remain available.
        </p>
      ) : null}
    </article>
  );
}

export function BackupsSection({
  canCreate,
  canDelete,
  canDownload,
}: {
  canCreate: boolean;
  canDelete: boolean;
  canDownload: boolean;
}) {
  const [cursor, setCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([]);
  const [pendingDelete, setPendingDelete] = useState<BackupRecord | null>(null);
  const historyQuery = useBackupRuns({ limit: 20, cursor });
  const settingsQuery = useBackupSettings();
  const runBackup = useRunBackupNow();
  const deleteBackup = useDeleteBackupRun();
  const downloadBackup = useDownloadBackupArtifact();
  const activeOperationId = useMemo(
    () => historyQuery.data?.items.find((item) => item.operation?.id && item.operation.status &&
      ["PREPARED", "RUNNING", "RETRY_WAIT", "PARTIAL", "UNCERTAIN"].includes(item.operation.status))?.operation?.id,
    [historyQuery.data?.items],
  );
  useBackupOperation(activeOperationId);

  const items = historyQuery.data?.items ?? [];
  const health = historyQuery.data?.health;
  const policy = settingsQuery.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Installation backups</CardTitle>
          <CardDescription>
            Backups cover the entire installation, not one department or operator. Production schedule, retention,
            off-host copying, and storage are deployment-managed controls.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {settingsQuery.isLoading ? <p>Loading backup policy…</p> : null}
          {settingsQuery.isError ? <p className="text-destructive">{errorText(settingsQuery.error)}</p> : null}
          {policy ? (
            <div className="flex flex-wrap gap-2">
              <Badge variant={policy.automatic_enabled ? "default" : "outline"}>
                Automatic backups {policy.automatic_enabled ? "enabled" : "disabled"}
              </Badge>
              <Badge variant="outline">Cadence: {policy.interval_hours} hours</Badge>
              <Badge variant="outline">Retention: {policy.retention_days == null ? "deployment policy" : `${policy.retention_days} days`}</Badge>
              {policy.schedule_managed_by_deployment ? <Badge variant="secondary">Schedule deployment-managed</Badge> : null}
              {policy.off_host_copy_required ? <Badge variant="secondary">Off-host copy required</Badge> : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {canCreate ? (
              <Button onClick={() => runBackup.mutate()} disabled={runBackup.isPending}>
                <Database className="mr-2 h-4 w-4" />{runBackup.isPending ? "Queueing…" : "Run backup now"}
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => void historyQuery.refetch()} disabled={historyQuery.isFetching}>
              <RefreshCw className="mr-2 h-4 w-4" />Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Backup history</CardTitle>
          <CardDescription>Execution, artifact lifecycle, and deletion operations are independent durable states.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {health?.alert_codes.map((code) => {
            const alert = presentBackupAlert(code);
            return <div key={code} role="alert" className="flex items-center gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />{alert.message} <span className="font-mono text-xs">({alert.code})</span>
            </div>;
          })}
          {health ? (
            <div className="grid gap-3 text-sm md:grid-cols-3">
              <div className="rounded-md bg-muted/30 p-3"><p className="font-medium">Latest verified success</p>
                <p>{formatInstant(health.latest_verified_success?.verified_at)}</p>
                <p className="break-all text-xs">{health.latest_verified_success?.run_id ?? "None recorded"}</p></div>
              <div className="rounded-md bg-muted/30 p-3"><p className="font-medium">Latest failure</p>
                <p>{formatInstant(health.latest_failure?.failed_at)}</p>
                <p>{health.latest_failure?.error_code ?? "None recorded"}</p></div>
              <div className="rounded-md bg-muted/30 p-3"><p className="font-medium">Active attempt</p>
                <p>{health.active ? `${health.active.stage} · attempt ${health.active.attempt_number}` : "None"}</p>
                <p>Heartbeat: {formatInstant(health.active?.heartbeat_at)}</p></div>
            </div>
          ) : null}
          {health && !health.retention_runtime_supported ? (
            <div className="rounded-md border border-dashed p-3 text-sm">
              Retention deletion is unsupported or unconfigured for this runtime
              {health.retention_runtime_reason_code ? ` (${health.retention_runtime_reason_code})` : ""}.
            </div>
          ) : null}
          {historyQuery.isLoading ? <p aria-live="polite">Loading backup history…</p> : null}
          {historyQuery.isError ? (
            <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
              {errorText(historyQuery.error)}
            </div>
          ) : null}
          {deleteBackup.isError ? (
            <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
              {errorText(deleteBackup.error)}
            </div>
          ) : null}
          {!historyQuery.isLoading && !historyQuery.isError && items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No backup history is available for this page.</p>
          ) : null}
          {items.map((backup) => (
            <BackupRow
              key={backup.id}
              backup={backup}
              canDelete={canDelete}
              canDownload={canDownload}
              deleting={deleteBackup.isPending}
              onDelete={() => setPendingDelete(backup)}
              onDownload={(artifact) => downloadBackup.mutate({ backupId: backup.id, artifact })}
            />
          ))}
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={cursorHistory.length === 0}
              onClick={() => {
                const previous = cursorHistory[cursorHistory.length - 1];
                setCursorHistory((current) => current.slice(0, -1));
                setCursor(previous);
              }}
            >Previous page</Button>
            <Button
              variant="outline"
              disabled={!historyQuery.data?.next_cursor}
              onClick={() => {
                setCursorHistory((current) => [...current, cursor]);
                setCursor(historyQuery.data?.next_cursor ?? undefined);
              }}
            >Next page</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Controlled recovery report</CardTitle>
          <CardDescription>Recovery remains an operator command workflow; the CMS cannot start restore, promotion, acceptance, or rollback.</CardDescription></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {health?.recovery_report ? <>
            <p>Latest imported state: <Badge>{health.recovery_report.state}</Badge></p>
            <p>Operation {health.recovery_report.operation_id} · {health.recovery_report.release_id} · {health.recovery_report.schema_migration_id}</p>
            <p>Data {health.recovery_report.results.data}; application {health.recovery_report.results.application}; promotion {health.recovery_report.results.promotion}; rollback {health.recovery_report.results.rollback}</p>
            {health.recovery_report.unexecuted_gates.length ? <p>Pending gates: {health.recovery_report.unexecuted_gates.join(", ")}</p> : null}
          </> : <p>No deployment-imported recovery report is available.</p>}
          <a className="inline-flex items-center text-primary underline" href="/docs/runbooks/controlled-docker-recovery-packet3.md" target="_blank" rel="noreferrer">
            Operator command and report runbook <ExternalLink className="ml-1 h-4 w-4" />
          </a>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Permanently delete backup artifacts?"
        description="This permanently removes the backup artifacts from storage. The backup history entry, deletion operation, and tombstone record remain; no downloadable archive is cached by the CMS."
        confirmLabel="Delete artifacts"
        isLoading={deleteBackup.isPending}
        confirmDisabled={!pendingDelete?.permissions.can_delete}
        onCancel={() => { if (!deleteBackup.isPending) setPendingDelete(null); }}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteBackup.mutate(
            { backupId: pendingDelete.id, idempotencyKey: crypto.randomUUID() },
            { onSuccess: () => setPendingDelete(null) },
          );
        }}
      />
    </div>
  );
}
