import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Copy, RefreshCcw, RotateCcw, Server, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { devicePairingApi } from "@/api/domains/devicePairing";
import { queryKeys } from "@/api/queryKeys";
import type { DevicePairingOrphanReport } from "@/api/types";
import { useSafeMutation } from "@/hooks/useSafeMutation";
import { toast } from "sonner";

const ORPHAN_REPORT_LIMIT = 50;

type OrphanRow = {
  key: string;
  reason: string;
  deviceId: string;
  recordId?: string;
  detail: string;
  timestamp?: string | null;
  serialSuffix?: string | null;
  isRevoked?: boolean;
};

function formatDateTime(value?: string | null) {
  if (!value) return "N/A";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "N/A";
  return new Date(timestamp).toLocaleString();
}

function getTotalOrphans(report?: DevicePairingOrphanReport) {
  if (!report) return 0;
  return (
    report.counts.device_certificates +
    report.counts.device_pairings +
    report.counts.heartbeats +
    report.counts.device_commands
  );
}

function getDuplicateConflictCount(report?: DevicePairingOrphanReport) {
  return report?.counts.duplicate_identity_conflicts ?? report?.duplicate_identity?.conflicts.length ?? 0;
}

function getTotalFindings(report?: DevicePairingOrphanReport) {
  return getTotalOrphans(report) + getDuplicateConflictCount(report);
}

function buildRows(report?: DevicePairingOrphanReport): OrphanRow[] {
  if (!report) return [];

  return [
    ...report.orphans.device_certificates.map((row) => ({
      key: `cert-${row.id}`,
      reason: row.reason,
      deviceId: row.screen_id,
      recordId: row.id,
      detail: row.is_revoked ? "Certificate already revoked" : "Certificate points to a missing screen",
      timestamp: row.revoked_at || row.expires_at || row.created_at,
      serialSuffix: row.serial_suffix,
      isRevoked: row.is_revoked,
    })),
    ...report.orphans.device_pairings.map((row) => ({
      key: `pairing-${row.id}`,
      reason: row.reason,
      deviceId: row.device_id,
      recordId: row.id,
      detail: row.used ? "Used pairing references a missing screen" : "Open pairing references a missing screen",
      timestamp: row.expires_at || row.created_at,
    })),
    ...report.orphans.heartbeats.map((row) => ({
      key: `heartbeat-${row.screen_id}`,
      reason: row.reason,
      deviceId: row.screen_id,
      detail: `${row.row_count} heartbeat rows reference a missing screen`,
      timestamp: row.latest_created_at,
    })),
    ...report.orphans.device_commands.map((row) => ({
      key: `command-${row.screen_id}`,
      reason: row.reason,
      deviceId: row.screen_id,
      detail: `${row.row_count} command rows reference a missing screen`,
      timestamp: row.latest_created_at,
    })),
  ];
}

export function PairingHealthPanel({
  canManage,
  visibleScreenCount,
}: {
  canManage: boolean;
  visibleScreenCount: number;
}) {
  const queryClient = useQueryClient();
  const [revokeTarget, setRevokeTarget] = useState<OrphanRow | null>(null);
  const [revokeNote, setRevokeNote] = useState("");

  const orphanQuery = useQuery({
    queryKey: queryKeys.devicePairingOrphans(ORPHAN_REPORT_LIMIT),
    queryFn: () => devicePairingApi.orphans({ limit: ORPHAN_REPORT_LIMIT }),
    enabled: canManage,
  });

  const report = orphanQuery.data;
  const totalOrphans = getTotalOrphans(report);
  const duplicateConflictCount = getDuplicateConflictCount(report);
  const totalFindings = getTotalFindings(report);
  const rows = useMemo(() => buildRows(report), [report]);
  const serverIdentity = report?.server_identity;
  const duplicateConflicts = report?.duplicate_identity?.conflicts ?? [];

  const revokePairing = useSafeMutation({
    mutationFn: (payload: { deviceId: string; note?: string }) =>
      devicePairingApi.revoke(payload.deviceId, {
        reason: "admin_revoked_stale_pairing",
        note: payload.note,
      }),
    onSuccess: (response) => {
      toast.success(
        response.status === "PAIRING_REVOKED"
          ? "Pairing revoked. The player must pair again."
          : "No active credential was found for that device.",
      );
      setRevokeTarget(null);
      setRevokeNote("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.devicePairingOrphans(ORPHAN_REPORT_LIMIT) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.screens });
      void queryClient.invalidateQueries({ queryKey: ["device-pairings"] });
    },
  }, "Unable to revoke pairing.");

  if (!canManage) {
    return null;
  }

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {totalFindings > 0 ? (
              <ShieldAlert className="h-4 w-4 text-amber-600" />
            ) : (
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
            )}
            <h2 className="font-semibold">Pairing Health</h2>
            <Badge variant={totalFindings > 0 ? "destructive" : "secondary"}>
              {totalFindings > 0 ? `${totalFindings} pairing findings` : "healthy"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Pairing diagnostics show orphan records and copied/cloned identity conflicts without exposing secrets.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {serverIdentity ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs">
              <Server className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{serverIdentity.environment}</span>
              <span className="text-muted-foreground">/</span>
              <span>{serverIdentity.deploymentId}</span>
              <span className="text-muted-foreground">/</span>
              <span>{serverIdentity.serverId}</span>
            </div>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void orphanQuery.refetch();
            }}
            disabled={orphanQuery.isFetching}
          >
            <RefreshCcw className="mr-1 h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {visibleScreenCount === 0 && totalOrphans > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
            <p>
              No screens are visible in this list, but orphan device state exists. Revoke stale pairing state or pair the
              player again.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Certificates</p>
          <p className="text-xl font-semibold">{report?.counts.device_certificates ?? "—"}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Pairing records</p>
          <p className="text-xl font-semibold">{report?.counts.device_pairings ?? "—"}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Heartbeats</p>
          <p className="text-xl font-semibold">{report?.counts.heartbeats ?? "—"}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Commands</p>
          <p className="text-xl font-semibold">{report?.counts.device_commands ?? "—"}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Duplicate identity</p>
          <p className="text-xl font-semibold">{duplicateConflictCount}</p>
        </div>
      </div>

      {duplicateConflicts.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Copy className="h-4 w-4 text-amber-600" />
            Duplicate identity conflicts
          </div>
          <div className="max-h-80 divide-y overflow-auto rounded-md border">
            {duplicateConflicts.map((conflict) => (
              <div key={conflict.conflictId} className="space-y-3 p-3">
                <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={conflict.severity === "BLOCK" ? "destructive" : "outline"}>
                        {conflict.severity}
                      </Badge>
                      <Badge variant="secondary">{conflict.activeSessionCount} active sessions</Badge>
                      <span className="text-sm font-medium">{conflict.screenName || "Unnamed screen"}</span>
                    </div>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{conflict.deviceId}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      First seen {formatDateTime(conflict.firstSeenAt)} · Last seen {formatDateTime(conflict.lastSeenAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setRevokeTarget({
                          key: `duplicate-${conflict.conflictId}`,
                          reason: "DUPLICATE_IDENTITY_CONFLICT",
                          deviceId: conflict.deviceId,
                          recordId: conflict.conflictId,
                          detail: "Duplicate active player sessions are using this device identity",
                          timestamp: conflict.lastSeenAt,
                        })
                      }
                    >
                      <ShieldAlert className="mr-1 h-3.5 w-3.5" />
                      Revoke
                    </Button>
                    <Button size="sm" variant="outline" disabled title="Requires a future fresh-pairing reclaim flow">
                      <RotateCcw className="mr-1 h-3.5 w-3.5" />
                      Reclaim
                    </Button>
                  </div>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {conflict.sessions.map((session, index) => (
                    <div key={`${conflict.conflictId}-${session.runtimeSessionSuffix || index}`} className="rounded-md border p-2 text-xs">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">{session.source}</Badge>
                        {session.playerVersion ? <span>v{session.playerVersion}</span> : null}
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        install ...{session.installInstanceSuffix || "unknown"} · runtime ...
                        {session.runtimeSessionSuffix || "unknown"}
                      </p>
                      <p className="text-muted-foreground">
                        machine hash {session.machineHash || "N/A"} · ip hash {session.ipHash || "N/A"}
                      </p>
                      <p className="text-muted-foreground">last seen {formatDateTime(session.lastSeenAt)}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Recommended action: verify physical players, revoke stale pairing if this is copied app data, then run
                  reset-pairing on the reused machine.
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {orphanQuery.isError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          Unable to load pairing health diagnostics.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border p-4 text-sm text-muted-foreground">
          No orphan device state was reported by the backend.
        </div>
      ) : (
        <div className="max-h-80 divide-y overflow-auto rounded-md border">
          {rows.map((row) => (
            <div key={row.key} className="grid gap-3 p-3 lg:grid-cols-[1.2fr_1.4fr_auto] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{row.reason}</Badge>
                  {row.isRevoked ? <Badge variant="secondary">revoked</Badge> : null}
                  {row.serialSuffix ? <span className="text-xs text-muted-foreground">serial ...{row.serialSuffix}</span> : null}
                </div>
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{row.deviceId}</p>
              </div>
              <div className="text-sm">
                <p>{row.detail}</p>
                <p className="text-xs text-muted-foreground">
                  {row.recordId ? `Record ${row.recordId} · ` : ""}
                  {formatDateTime(row.timestamp)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <Button size="sm" variant="outline" onClick={() => setRevokeTarget(row)}>
                  <ShieldAlert className="mr-1 h-3.5 w-3.5" />
                  Revoke
                </Button>
                <Button size="sm" variant="outline" disabled title="Requires a future fresh-pairing reclaim flow">
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />
                  Reclaim
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        title="Revoke pairing?"
        description="The player will need to pair again. This does not delete the screen."
        confirmLabel="Revoke Pairing"
        onConfirm={() => {
          if (!revokeTarget) return;
          revokePairing.mutate({
            deviceId: revokeTarget.deviceId,
            note: revokeNote.trim() || undefined,
          });
        }}
        onCancel={() => {
          if (revokePairing.isPending) return;
          setRevokeTarget(null);
          setRevokeNote("");
        }}
        isLoading={revokePairing.isPending}
      >
        {revokeTarget ? (
          <div className="space-y-3">
            <div className="rounded-md border p-3 text-sm">
              <p className="text-muted-foreground">Device</p>
              <p className="break-all font-mono">{revokeTarget.deviceId}</p>
            </div>
            <div className="space-y-1">
              <label htmlFor="revoke-note" className="text-sm font-medium">
                Admin note
              </label>
              <Input
                id="revoke-note"
                value={revokeNote}
                onChange={(event) => setRevokeNote(event.target.value)}
                placeholder="Optional note"
                maxLength={500}
              />
            </div>
          </div>
        ) : null}
      </ConfirmDialog>
    </Card>
  );
}
