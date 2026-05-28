import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, RefreshCw, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { devicePairingApi } from "@/api/domains/devicePairing";
import { queryKeys } from "@/api/queryKeys";
import { useSafeMutation } from "@/hooks/useSafeMutation";
import type { PairingStatusResponse, ScreenOverviewItem } from "@/api/types";
import { toast } from "sonner";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { formatMaskedScreenId } from "@/lib/screens";

interface PairDeviceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recoveryScreen?: ScreenOverviewItem | null;
}

const DEFAULT_EXPIRES_IN = 900;

function formatDateTime(value?: string | null) {
  if (!value) return "N/A";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "N/A";
  return new Date(timestamp).toLocaleString();
}

export function PairDeviceModal({ open, onOpenChange, recoveryScreen = null }: PairDeviceModalProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"confirm" | "recover">(recoveryScreen ? "recover" : "confirm");
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmForm, setConfirmForm] = useState({
    pairingCode: "",
    name: recoveryScreen?.name || "",
    location: recoveryScreen?.location || "",
  });

  useEffect(() => {
    if (!open) return;
    setTab(recoveryScreen ? "recover" : "confirm");
    setConfirmForm({
      pairingCode: "",
      name: recoveryScreen?.name || "",
      location: recoveryScreen?.location || "",
    });
  }, [open, recoveryScreen]);

  const recoveryQuery = useQuery({
    queryKey: ["device-pairing", "recovery", recoveryScreen?.id],
    queryFn: () => devicePairingApi.recovery(recoveryScreen!.id),
    enabled: open && Boolean(recoveryScreen?.id),
  });

  const confirmPairing = useSafeMutation({
    mutationFn: (payload: { pairing_code: string; name: string; location?: string }) =>
      devicePairingApi.confirm(payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["device-pairings"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.screensOverview({ includeMedia: true }) });
      queryClient.invalidateQueries({ queryKey: ["device-pairing", "recovery", recoveryScreen?.id] });
      const message =
        data?.recovery?.mode === "RECOVERY"
          ? "Recovery confirmed. The screen can now complete credential recovery."
          : data?.message || "Pairing approved. Waiting for device completion.";
      toast.success(message);
      setGeneratedCode(null);
      setConfirmForm({ pairingCode: "", name: recoveryScreen?.name || "", location: recoveryScreen?.location || "" });
      onOpenChange(false);
    },
  }, "Unable to confirm pairing.");

  const generateRecoveryCode = useSafeMutation({
    mutationFn: (payload: { device_id: string; expires_in?: number }) =>
      devicePairingApi.startRecovery(payload.device_id, { expires_in: payload.expires_in }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["device-pairings"] });
      queryClient.invalidateQueries({ queryKey: ["device-pairing", "recovery", recoveryScreen?.id] });
      if (data.pairing_code) {
        setGeneratedCode(data.pairing_code);
        setConfirmForm((current) => ({
          ...current,
          pairingCode: data.pairing_code || current.pairingCode,
          name: recoveryScreen?.name || current.name,
          location: recoveryScreen?.location || current.location,
        }));
      }
      toast.success("Recovery code generated. Older recovery codes are now invalid.");
    },
  }, "Unable to generate recovery code.");

  const pairingUrl = useMemo(
    () => (generatedCode ? `https://signhex.app/pair?code=${generatedCode}` : ""),
    [generatedCode],
  );

  const handleCopyCode = async () => {
    if (!generatedCode) return;
    await navigator.clipboard.writeText(generatedCode);
    setCopied(true);
    toast.success("Code copied to clipboard");
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleConfirm = () => {
    confirmPairing.mutate({
      pairing_code: confirmForm.pairingCode.trim(),
      name: confirmForm.name.trim(),
      location: confirmForm.location.trim() || undefined,
    });
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setGeneratedCode(null);
      setCopied(false);
      setTab(recoveryScreen ? "recover" : "confirm");
      setConfirmForm({
        pairingCode: "",
        name: recoveryScreen?.name || "",
        location: recoveryScreen?.location || "",
      });
    }
    onOpenChange(nextOpen);
  };

  const recovery = recoveryQuery.data;
  const activeRecovery = recovery?.active_pairing?.mode === "RECOVERY" ? recovery.active_pairing : null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[560px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{recoveryScreen ? "Recover Screen" : "Pair Device"}</DialogTitle>
          <DialogDescription>
            {recoveryScreen
              ? "Generate and approve a recovery code for this existing screen identity."
              : "Approve a pairing code that was already generated by the signage player."}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} className="mt-2 min-w-0">
          <TabsList className="h-auto w-full justify-start gap-2 overflow-x-auto p-1">
            <TabsTrigger value="confirm" className="shrink-0">
              Confirm
            </TabsTrigger>
            {recoveryScreen ? (
              <TabsTrigger value="recover" className="shrink-0">
                Recover
              </TabsTrigger>
            ) : null}
          </TabsList>

          <TabsContent value="confirm" className="space-y-4 py-3">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="pairing-code" className="text-sm">Pairing Code *</Label>
                <Input
                  id="pairing-code"
                  value={confirmForm.pairingCode}
                  onChange={(e) =>
                    setConfirmForm((prev) => ({ ...prev, pairingCode: e.target.value.toUpperCase() }))
                  }
                  placeholder="Enter the code currently shown on the screen"
                  className="font-mono uppercase"
                  maxLength={20}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="screen-name" className="text-sm">Screen Name *</Label>
                <Input
                  id="screen-name"
                  value={confirmForm.name}
                  onChange={(e) => setConfirmForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Lobby Display"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="screen-location" className="text-sm">Location (Optional)</Label>
                <Input
                  id="screen-location"
                  value={confirmForm.location}
                  onChange={(e) => setConfirmForm((prev) => ({ ...prev, location: e.target.value }))}
                  placeholder="e.g., First Floor"
                />
              </div>

              <Card className="p-3 bg-muted/30">
                <p className="text-sm font-medium">CMS action</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Confirm is used for both first-time pairing and same-screen recovery. The device still completes pairing on its side with a CSR after approval.
                </p>
              </Card>

              <Button
                onClick={handleConfirm}
                disabled={
                  confirmPairing.isPending ||
                  !confirmForm.pairingCode.trim() ||
                  !confirmForm.name.trim()
                }
                className="w-full"
              >
                {confirmPairing.isPending ? "Confirming..." : "Confirm Pairing / Recovery"}
              </Button>
            </div>
          </TabsContent>

          {recoveryScreen ? (
            <TabsContent value="recover" className="space-y-4 py-3">
              <Card className="p-4 space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold">{recoveryScreen.name}</p>
                    <p className="break-all text-xs font-mono text-muted-foreground">
                      {formatMaskedScreenId(recoveryScreen.id)}
                    </p>
                  </div>
                  <StatusBadge status={recoveryScreen.health_state || recoveryScreen.status || "offline"} />
                </div>
                {recovery?.recovery ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4 text-amber-600" />
                      <span className="font-medium">{recovery.recovery.auth_state || "UNKNOWN"}</span>
                    </div>
                    <p className="text-muted-foreground">{recovery.recovery.reason || "No recovery diagnostics available."}</p>
                    <p className="text-xs text-muted-foreground">
                      Recommended action: {recovery.recovery.recommended_action || "N/A"}
                    </p>
                  </div>
                ) : recoveryQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading recovery diagnostics...</p>
                ) : null}
                {recovery?.certificate ? (
                  <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground md:grid-cols-2">
                    <p>Serial: <span className="font-mono">{recovery.certificate.serial || "N/A"}</span></p>
                    <p>Expires: {formatDateTime(recovery.certificate.expires_at)}</p>
                    <p>Revoked: {recovery.certificate.is_revoked ? "Yes" : "No"}</p>
                    <p>Revoked at: {formatDateTime(recovery.certificate.revoked_at)}</p>
                  </div>
                ) : null}
                {activeRecovery ? (
                  <Badge variant="outline" className="w-fit border-amber-500 text-amber-700">
                    Recovery pending until {formatDateTime(activeRecovery.expires_at)}
                  </Badge>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Only the most recently generated recovery code remains valid for this screen.
                </p>
              </Card>

              {generatedCode ? (
                <Card className="p-4 space-y-3 bg-muted/30">
                  <div className="flex flex-col items-center gap-3">
                    <div className="bg-white p-3 rounded-lg shadow-sm">
                      <QRCodeSVG value={pairingUrl} size={160} level="H" />
                    </div>
                    <div className="flex w-full flex-wrap items-center gap-2">
                      <Input
                        value={generatedCode}
                        readOnly
                        className="min-w-0 flex-1 text-center text-base font-mono font-bold tracking-wider"
                      />
                      <Button variant="outline" size="icon" className="shrink-0" onClick={handleCopyCode}>
                        {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        onClick={() => generateRecoveryCode.mutate({ device_id: recoveryScreen.id, expires_in: DEFAULT_EXPIRES_IN })}
                        disabled={generateRecoveryCode.isPending}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2 text-xs text-muted-foreground">
                    <p>1. Enter this code on the affected screen or player recovery UI.</p>
                    <p>2. Return to the Confirm tab and approve this code for the same screen identity.</p>
                    <p>3. The device completes recovery with a fresh CSR; the old certificate is revoked automatically.</p>
                  </div>
                  <Button variant="outline" className="w-full" onClick={() => setTab("confirm")}>Use this code in Confirm</Button>
                </Card>
              ) : (
                <Button
                  onClick={() => generateRecoveryCode.mutate({ device_id: recoveryScreen.id, expires_in: DEFAULT_EXPIRES_IN })}
                  disabled={generateRecoveryCode.isPending}
                  className="w-full"
                >
                  {generateRecoveryCode.isPending ? "Generating recovery code..." : "Generate Recovery Code"}
                </Button>
              )}
            </TabsContent>
          ) : null}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
