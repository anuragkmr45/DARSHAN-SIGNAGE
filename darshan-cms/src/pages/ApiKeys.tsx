import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingIndicator } from "@/components/common/LoadingIndicator";
import { useToast } from "@/hooks/use-toast";
import { useAuthorization } from "@/hooks/useAuthorization";
import { apiKeysApi } from "@/api/domains/apiKeys";
import { ApiError } from "@/api/apiClient";
import type { ApiKey } from "@/api/types";

function dateLabel(value?: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function keyStatus(key: ApiKey): "Revoked" | "Expired" | "Stored" {
  if (key.is_revoked) return "Revoked";
  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) return "Expired";
  return "Stored";
}

const ApiKeys = () => {
  const { toast } = useToast();
  const { can } = useAuthorization();
  const queryClient = useQueryClient();
  const canRevoke = can("delete", "ApiKey");
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);

  const { data: keys, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["api-keys"],
    queryFn: apiKeysApi.list,
    staleTime: 30_000,
  });
  const showError = (failure: unknown, title: string) => toast({
    title,
    description: failure instanceof ApiError ? failure.message : "Please try again.",
    variant: "destructive",
  });
  const revokeMutation = useMutation({
    retry: false,
    mutationFn: apiKeysApi.revoke,
    onSuccess: () => {
      setRevokeTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast({ title: "API key revoked", description: "The stored record is now marked revoked." });
    },
    onError: (failure) => showError(failure, "Could not revoke API key"),
  });
  return <div className="mx-auto w-full max-w-5xl space-y-5">
    <header className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-2xl font-semibold tracking-tight">API Keys</h1><p className="mt-1 text-sm text-muted-foreground">Review and revoke stored key records.</p></div>
    </header>
    <p className="text-sm text-muted-foreground">API keys cannot authenticate requests in this release. Creation and rotation are unavailable until the access contract is designed.</p>
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{isLoading ? "Loading keys…" : `${keys?.length ?? 0} keys`}{isFetching && !isLoading ? " · Updating" : ""}</p>
      <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}><RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />Refresh</Button>
    </div>
    <p className="text-sm text-muted-foreground">Only stored identifier prefixes are listed. Existing secrets are never shown.</p>
    {isLoading ? <LoadingIndicator label="Loading API keys…" /> : isError && !keys ? (
      <EmptyState title="Unable to load API keys" description={error instanceof Error ? error.message : "Please try again."} actionLabel="Retry" onAction={() => void refetch()} />
    ) : !keys?.length ? (
      <EmptyState title="No API keys" description="New keys are unavailable until API-key authentication is designed." />
    ) : <div className="divide-y rounded-xl border bg-background">
      {keys.map((key) => {
        const status = keyStatus(key);
        return <section key={key.id} aria-label={key.name} className="space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><h2 className="break-words font-semibold">{key.name}</h2><p className="mt-1 text-sm text-muted-foreground">Identifier: {key.token_prefix ?? "Unavailable"}…</p></div>
            <Badge variant={status === "Stored" ? "secondary" : "outline"}>{status}</Badge>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <span>Created {dateLabel(key.created_at)}</span><span>Last used {dateLabel(key.last_used_at)}</span>
            {key.expires_at && <span>Expires {dateLabel(key.expires_at)}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(key.scopes ?? []).map((scope) => <Badge key={scope} variant="outline">{scope}</Badge>)}
            {status !== "Revoked" && canRevoke && <div className="flex flex-wrap gap-2 sm:ml-auto">
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setRevokeTarget(key)}>Revoke</Button>
            </div>}
          </div>
        </section>;
      })}
    </div>}
    {isError && keys && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive"><span>Could not refresh keys. Showing the last loaded list.</span><Button variant="outline" size="sm" onClick={() => void refetch()}>Retry</Button></div>}

    <ConfirmDialog open={!!revokeTarget} title="Revoke API key?" description={`${revokeTarget?.name ?? "This key"} will be marked revoked. API-key authentication is not enabled in this release.`} confirmLabel="Revoke key" onConfirm={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)} onCancel={() => setRevokeTarget(null)} isLoading={revokeMutation.isPending} />
  </div>;
};

export default ApiKeys;
