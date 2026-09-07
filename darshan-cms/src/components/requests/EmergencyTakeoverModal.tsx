import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Monitor, ShieldAlert, Users, Zap } from "lucide-react";
import { emergencyApi } from "@/api/domains/emergency";
import { ApiError } from "@/api/apiClient";
import { mediaApi } from "@/api/domains/media";
import { resolveMediaDisplayName } from "@/lib/media";
import { screensApi } from "@/api/domains/screens";
import { queryKeys } from "@/api/queryKeys";
import type { EmergencyRecord } from "@/api/types";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchBar } from "@/components/common/SearchBar";
import { MediaPreview } from "@/components/common/MediaPreview";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

interface EmergencyTakeoverModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated?: () => void;
}

type ScopeMode = "all" | "groups" | "screens";
type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

const severityOptions: Severity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const toIsoDateTime = (value: string) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const getScopeLabel = (emergency: EmergencyRecord) => {
  if (emergency.scope === "GLOBAL") return "All screens";
  if (emergency.scope === "GROUP") return `${emergency.screen_group_ids?.length ?? 0} group(s)`;
  if (emergency.scope === "SCREEN") return `${emergency.screen_ids?.length ?? 0} screen(s)`;
  return emergency.scope ?? "Unknown scope";
};

export const getEmergencyActivationError = (error: unknown) => {
  if (error instanceof ApiError && error.code === "MESSAGE_EMERGENCY_UNSUPPORTED") {
    const details = error.details as { unsupported_screen_count?: number; targeted_screen_count?: number } | undefined;
    if (typeof details?.unsupported_screen_count === "number") {
      return `${details.unsupported_screen_count} of ${details.targeted_screen_count ?? "the targeted"} screen(s) need a player update before message-only emergencies can be used. Select emergency media or update those players.`;
    }
  }
  return error instanceof Error ? error.message : "Unable to activate emergency takeover.";
};

export function EmergencyTakeoverModal({
  open,
  onOpenChange,
  onUpdated,
}: EmergencyTakeoverModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { can, isAdminOrSuperAdmin } = useAuthorization();
  const canManageEmergency = isAdminOrSuperAdmin || can("update", "Screen");

  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<Severity>("HIGH");
  const [scope, setScope] = useState<ScopeMode>("all");
  const [selectedScreenIds, setSelectedScreenIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [mediaId, setMediaId] = useState<string>("none");
  const [mediaSearch, setMediaSearch] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [auditNote, setAuditNote] = useState("");
  const [confirmedGlobal, setConfirmedGlobal] = useState(false);
  const [clearTargetId, setClearTargetId] = useState<string | null>(null);
  const [clearReason, setClearReason] = useState("");
  const triggerOperationRef = useRef<{ fingerprint: string; key: string } | null>(null);

  const emergencyStatusQuery = useQuery({
    queryKey: queryKeys.emergencyStatus,
    queryFn: emergencyApi.status,
    enabled: open,
    staleTime: 15_000,
    refetchInterval: open ? 30_000 : false,
  });

  const mediaQuery = useQuery({
    queryKey: [...queryKeys.media, "emergency-picker"],
    queryFn: () => mediaApi.list({ page: 1, limit: 100, status: "READY" }),
    enabled: open,
    staleTime: 60_000,
  });

  const screensQuery = useQuery({
    queryKey: queryKeys.screens,
    queryFn: () => screensApi.list({ page: 1, limit: 100 }),
    enabled: open,
    staleTime: 60_000,
  });

  const groupsQuery = useQuery({
    queryKey: queryKeys.screenGroups,
    queryFn: () => screensApi.listGroups({ page: 1, limit: 100 }),
    enabled: open,
    staleTime: 60_000,
  });

  const activeEmergencies = emergencyStatusQuery.data?.active_emergencies ?? [];
  const mediaItems = useMemo(() => (Array.isArray(mediaQuery.data?.items) ? mediaQuery.data.items : []), [mediaQuery.data?.items]);
  const screens = useMemo(() => screensQuery.data?.items ?? [], [screensQuery.data?.items]);
  const groups = groupsQuery.data?.items ?? [];
  const selectedMedia = mediaId !== "none" ? mediaItems.find((media) => media.id === mediaId) ?? null : null;
  const filteredMediaItems = useMemo(() => {
    const query = mediaSearch.trim().toLowerCase();
    if (!query) return mediaItems;
    return mediaItems.filter((media) => resolveMediaDisplayName(media).toLowerCase().includes(query));
  }, [mediaItems, mediaSearch]);

  const groupedScreenIds = useMemo(() => {
    const screenMap = new Map(screens.map((screen) => [screen.id, screen.name || screen.id]));
    return screenMap;
  }, [screens]);

  const resetForm = () => {
    setMessage("");
    setSeverity("HIGH");
    setScope("all");
    setSelectedScreenIds([]);
    setSelectedGroupIds([]);
    setMediaId("none");
    setMediaSearch("");
    setExpiresAt("");
    setAuditNote("");
    setConfirmedGlobal(false);
    setClearTargetId(null);
    setClearReason("");
    triggerOperationRef.current = null;
  };

  const invalidateEmergencyState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.emergencyStatus }),
      queryClient.invalidateQueries({ queryKey: queryKeys.screensOverview({ includeMedia: true }) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.screensScheduleTimeline() }),
    ]);
    onUpdated?.();
  };

  const triggerMutation = useMutation({
    mutationFn: () => {
      const triggerPayload = {
        message: message.trim() || undefined,
        severity,
        media_id: mediaId !== "none" ? mediaId : undefined,
        target_all: scope === "all" ? true : undefined,
        screen_ids: scope === "screens" ? selectedScreenIds : undefined,
        screen_group_ids: scope === "groups" ? selectedGroupIds : undefined,
        expires_at: toIsoDateTime(expiresAt),
        audit_note: auditNote.trim() || undefined,
      };
      const fingerprint = JSON.stringify(triggerPayload);
      if (triggerOperationRef.current?.fingerprint !== fingerprint) {
        triggerOperationRef.current = { fingerprint, key: crypto.randomUUID() };
      }
      return emergencyApi.trigger(triggerPayload, triggerOperationRef.current.key);
    },
    onSuccess: async () => {
      toast({
        title: "Emergency activated",
        description: "Emergency takeover has been activated and broadcast to affected screens.",
      });
      await invalidateEmergencyState();
      resetForm();
    },
    onError: (error) => {
      const messageText = getEmergencyActivationError(error);
      toast({ title: "Activation failed", description: messageText, variant: "destructive" });
    },
  });

  const clearMutation = useMutation({
    mutationFn: ({ emergencyId, reason }: { emergencyId: string; reason: string }) =>
      emergencyApi.clear(emergencyId, { clear_reason: reason }),
    onSuccess: async () => {
      toast({
        title: "Emergency cleared",
        description: "The emergency takeover has been cleared.",
      });
      setClearTargetId(null);
      setClearReason("");
      await invalidateEmergencyState();
    },
    onError: (error) => {
      const messageText = error instanceof Error ? error.message : "Unable to clear emergency takeover.";
      toast({ title: "Clear failed", description: messageText, variant: "destructive" });
    },
  });

  const toggleSelection = (current: string[], id: string, setter: (next: string[]) => void) => {
    setter(current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  };

  const handleActivate = async () => {
    if (!canManageEmergency) {
      toast({
        title: "Permission denied",
        description: "You do not have permission to trigger an emergency takeover.",
        variant: "destructive",
      });
      return;
    }

    if (!message.trim() && mediaId === "none") {
      toast({
        title: "Emergency content required",
        description: "Provide an ad hoc message or select emergency media before activation.",
        variant: "destructive",
      });
      return;
    }

    if (!auditNote.trim()) {
      toast({
        title: "Audit note required",
        description: "Explain why this emergency takeover is being activated.",
        variant: "destructive",
      });
      return;
    }

    if (scope === "screens" && selectedScreenIds.length === 0) {
      toast({
        title: "Select target screens",
        description: "Choose at least one screen for a screen-scoped emergency.",
        variant: "destructive",
      });
      return;
    }

    if (scope === "groups" && selectedGroupIds.length === 0) {
      toast({
        title: "Select target groups",
        description: "Choose at least one screen group for a group-scoped emergency.",
        variant: "destructive",
      });
      return;
    }

    if (scope === "all" && !confirmedGlobal) {
      toast({
        title: "Global confirmation required",
        description: "Confirm that you understand the impact of a system-wide emergency takeover.",
        variant: "destructive",
      });
      return;
    }

    await triggerMutation.mutateAsync();
  };

  const handleClear = async (emergencyId: string) => {
    if (!clearReason.trim()) {
      toast({
        title: "Clear reason required",
        description: "Provide a reason before clearing an active emergency.",
        variant: "destructive",
      });
      return;
    }
    await clearMutation.mutateAsync({ emergencyId, reason: clearReason.trim() });
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm();
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            Emergency Takeover
          </DialogTitle>
          <DialogDescription>
            Trigger a scoped emergency override using the backend contract. Emergency playback overrides scheduled content immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-5">
            <div className="rounded-lg border p-4 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="emergency-message">Emergency message</Label>
                  <Textarea
                    id="emergency-message"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    rows={4}
                    placeholder="Evacuate the premises immediately and follow the nearest marked exit."
                  />
                </div>

                <div className="space-y-2">
                  <Label>Severity</Label>
                  <Select value={severity} onValueChange={(value) => setSeverity(value as Severity)}>
                    <SelectTrigger aria-label="Emergency severity">
                      <SelectValue placeholder="Select severity" />
                    </SelectTrigger>
                    <SelectContent>
                      {severityOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Target scope</Label>
                  <Select
                    value={scope}
                    onValueChange={(value) => {
                      setScope(value as ScopeMode);
                      setSelectedScreenIds([]);
                      setSelectedGroupIds([]);
                      setConfirmedGlobal(false);
                    }}
                  >
                    <SelectTrigger aria-label="Emergency scope">
                      <SelectValue placeholder="Select scope" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All screens</SelectItem>
                      <SelectItem value="groups">Screen groups</SelectItem>
                      <SelectItem value="screens">Specific screens</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="emergency-expires-at">Expires at</Label>
                  <Input
                    id="emergency-expires-at"
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(event) => setExpiresAt(event.target.value)}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="emergency-audit-note">Audit note</Label>
                  <Textarea
                    id="emergency-audit-note"
                    value={auditNote}
                    onChange={(event) => setAuditNote(event.target.value)}
                    rows={3}
                    placeholder="Explain why this override is required and who authorized it."
                  />
                </div>

                <div className="space-y-3 md:col-span-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label>Emergency media</Label>
                    {selectedMedia ? (
                      <Button variant="ghost" size="sm" onClick={() => setMediaId("none")}>
                        Clear selection
                      </Button>
                    ) : null}
                  </div>

                  <div className="rounded-lg border bg-muted/20 p-3">
                    {selectedMedia ? (
                      <div className="flex items-center gap-3">
                        <MediaPreview
                          media={selectedMedia}
                          className="h-20 w-28 flex-shrink-0"
                          videoControls={false}
                          videoMuted
                          videoAutoPlay={selectedMedia.type === "VIDEO"}
                        />
                        <div className="min-w-0">
                          <p className="font-medium">{resolveMediaDisplayName(selectedMedia)}</p>
                          <p className="text-sm text-muted-foreground">
                            {selectedMedia.source_content_type ?? selectedMedia.content_type ?? selectedMedia.type ?? "Media"}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No media override selected. The emergency can still run with just the message.
                      </p>
                    )}
                  </div>

                  <div className="rounded-lg border p-3">
                    <SearchBar placeholder="Search emergency media..." onSearch={setMediaSearch} initialValue={mediaSearch} />
                    <ScrollArea className="mt-3 h-56">
                      <div className="grid grid-cols-1 gap-3 pr-4 md:grid-cols-2">
                        <button
                          type="button"
                          className={`rounded-lg border p-3 text-left transition-colors ${
                            mediaId === "none" ? "border-primary bg-primary/5" : "hover:border-primary/40"
                          }`}
                          onClick={() => setMediaId("none")}
                        >
                          <p className="font-medium">No media override</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Use only the emergency message for this takeover.
                          </p>
                        </button>
                        {filteredMediaItems.map((media) => (
                          <button
                            key={media.id}
                            type="button"
                            className={`rounded-lg border p-3 text-left transition-colors ${
                              media.id === mediaId ? "border-primary bg-primary/5" : "hover:border-primary/40"
                            }`}
                            onClick={() => setMediaId(media.id)}
                          >
                            <div className="space-y-3">
                              <MediaPreview
                                media={media}
                                className="h-28 w-full"
                                videoControls={false}
                                videoMuted
                                videoAutoPlay={media.type === "VIDEO"}
                              />
                              <div>
                                <p className="truncate font-medium">{resolveMediaDisplayName(media)}</p>
                                <p className="text-sm text-muted-foreground">
                                  {media.source_content_type ?? media.content_type ?? media.type ?? "Media"}
                                </p>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                </div>
              </div>

              {scope === "all" && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-medium">System-wide override</p>
                      <p className="text-sm text-muted-foreground">
                        This takeover interrupts scheduled playback on every paired screen until cleared or expired.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="confirm-global-emergency"
                      checked={confirmedGlobal}
                      onCheckedChange={(checked) => setConfirmedGlobal(Boolean(checked))}
                    />
                    <label htmlFor="confirm-global-emergency" className="text-sm leading-5">
                      I understand the scope and confirm that a global emergency takeover is required.
                    </label>
                  </div>
                </div>
              )}

              {scope === "screens" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-primary" />
                    <p className="font-medium">Target screens</p>
                    <Badge variant="secondary">{selectedScreenIds.length}</Badge>
                  </div>
                  <ScrollArea className="h-48 rounded-lg border p-3">
                    <div className="space-y-2">
                      {screens.map((screen) => (
                        <label key={screen.id} className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
                          <Checkbox
                            checked={selectedScreenIds.includes(screen.id)}
                            onCheckedChange={() =>
                              toggleSelection(selectedScreenIds, screen.id, setSelectedScreenIds)
                            }
                          />
                          <div>
                            <p className="font-medium">{screen.name || screen.id}</p>
                            <p className="text-xs text-muted-foreground">{screen.location || screen.id}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {scope === "groups" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    <p className="font-medium">Target groups</p>
                    <Badge variant="secondary">{selectedGroupIds.length}</Badge>
                  </div>
                  <ScrollArea className="h-48 rounded-lg border p-3">
                    <div className="space-y-2">
                      {groups.map((group) => (
                        <label key={group.id} className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
                          <Checkbox
                            checked={selectedGroupIds.includes(group.id)}
                            onCheckedChange={() =>
                              toggleSelection(selectedGroupIds, group.id, setSelectedGroupIds)
                            }
                          />
                          <div>
                            <p className="font-medium">{group.name || group.id}</p>
                            <p className="text-xs text-muted-foreground">
                              {(group.screen_ids?.length ?? 0) > 0
                                ? `${group.screen_ids?.length ?? 0} screens`
                                : group.description || group.id}
                            </p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Active emergencies</p>
                  <p className="text-sm text-muted-foreground">
                    {emergencyStatusQuery.data?.active ? `${emergencyStatusQuery.data.active_count ?? activeEmergencies.length} active` : "No active emergency"}
                  </p>
                </div>
                {emergencyStatusQuery.data?.active && (
                  <Badge variant="destructive">{emergencyStatusQuery.data.active_count ?? activeEmergencies.length}</Badge>
                )}
              </div>
              <Separator />
              <ScrollArea className="h-[26rem] pr-2">
                <div className="space-y-3">
                  {activeEmergencies.length === 0 && (
                    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      No active emergency takeover. Scheduled playback is the current source of truth.
                    </div>
                  )}

                  {activeEmergencies.map((emergency) => (
                    <div key={emergency.id} className="rounded-lg border p-3 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="destructive">{emergency.severity}</Badge>
                            <Badge variant="outline">{getScopeLabel(emergency)}</Badge>
                          </div>
                          <p className="font-medium">{emergency.message || "Media-based emergency takeover"}</p>
                          <p className="text-xs text-muted-foreground">
                            Triggered {formatDateTime(emergency.triggered_at || emergency.created_at)}
                          </p>
                          {emergency.expires_at && (
                            <p className="text-xs text-muted-foreground">
                              Expires {formatDateTime(emergency.expires_at)}
                            </p>
                          )}
                          {emergency.scope === "SCREEN" && emergency.screen_ids?.length ? (
                            <p className="text-xs text-muted-foreground">
                              Targets: {emergency.screen_ids.map((id) => groupedScreenIds.get(id) || id).join(", ")}
                            </p>
                          ) : null}
                          {emergency.audit_note && (
                            <p className="text-xs text-muted-foreground">Audit note: {emergency.audit_note}</p>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setClearTargetId(emergency.id);
                            setClearReason("");
                          }}
                        >
                          Clear
                        </Button>
                      </div>

                      {clearTargetId === emergency.id && (
                        <div className="rounded-md bg-muted/50 p-3 space-y-3">
                          <Label htmlFor={`clear-reason-${emergency.id}`}>Clear reason</Label>
                          <Textarea
                            id={`clear-reason-${emergency.id}`}
                            value={clearReason}
                            onChange={(event) => setClearReason(event.target.value)}
                            rows={3}
                            placeholder="Incident resolved. Resume scheduled playback."
                          />
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setClearTargetId(null);
                                setClearReason("");
                              }}
                            >
                              Cancel
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={clearMutation.isPending}
                              onClick={() => void handleClear(emergency.id)}
                            >
                              Confirm clear
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            Close
          </Button>
          <Button
            variant={scope === "all" ? "destructive" : "default"}
            onClick={() => void handleActivate()}
            disabled={!canManageEmergency || triggerMutation.isPending}
          >
            <Zap className="mr-2 h-4 w-4" />
            {triggerMutation.isPending ? "Activating..." : "Activate emergency"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
