import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingIndicator } from "@/components/common/LoadingIndicator";
import { useToast } from "@/hooks/use-toast";
import { useAuthorization } from "@/hooks/useAuthorization";
import { apiKeysApi } from "@/api/domains/apiKeys";
import { ApiError } from "@/api/apiClient";
import type { ApiKey } from "@/api/types";

const availableScopes = [
  { id: "read", label: "Read" },
  { id: "write", label: "Write" },
  { id: "admin", label: "Admin" },
];

function dateLabel(value?: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function keyStatus(key: ApiKey): "Revoked" | "Expired" | "Active" {
  if (key.is_revoked) return "Revoked";
  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) return "Expired";
  return "Active";
}

const ApiKeys = () => {
  const { toast } = useToast();
  const { can } = useAuthorization();
  const queryClient = useQueryClient();
  const canCreate = can("create", "ApiKey");
  const canRotate = can("update", "ApiKey");
  const canRevoke = can("delete", "ApiKey");
  const [createOpen, setCreateOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [oneTimeSecret, setOneTimeSecret] = useState<{ name: string; value: string } | null>(null);
  const [rotateTarget, setRotateTarget] = useState<ApiKey | null>(null);
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
  const revealNewSecret = (result: ApiKey, action: "created" | "rotated") => {
    void queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    if (result.secret) setOneTimeSecret({ name: result.name, value: result.secret });
    else toast({
      title: `Key ${action}, but its secret was not returned`,
      description: "Do not use this key. Rotate it to generate a new secret.",
      variant: "destructive",
    });
  };
  const createMutation = useMutation({
    retry: false,
    mutationFn: apiKeysApi.create,
    onSuccess: (result) => {
      setCreateOpen(false);
      setKeyName("");
      setSelectedScopes([]);
      revealNewSecret(result, "created");
    },
    onError: (failure) => showError(failure, "Could not create API key"),
  });
  const rotateMutation = useMutation({
    retry: false,
    mutationFn: apiKeysApi.rotate,
    onSuccess: (result) => {
      setRotateTarget(null);
      revealNewSecret(result, "rotated");
    },
    onError: (failure) => showError(failure, "Could not rotate API key"),
  });
  const revokeMutation = useMutation({
    retry: false,
    mutationFn: apiKeysApi.revoke,
    onSuccess: () => {
      setRevokeTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast({ title: "API key revoked", description: "Requests using this key will no longer be accepted." });
    },
    onError: (failure) => showError(failure, "Could not revoke API key"),
  });
  const createKey = () => {
    const name = keyName.trim();
    if (!name || selectedScopes.length === 0) {
      toast({ title: "Name and access required", description: "Name the key and select at least one scope.", variant: "destructive" });
      return;
    }
    createMutation.mutate({ name, scopes: selectedScopes });
  };
  const copySecret = async () => {
    if (!oneTimeSecret) return;
    try {
      await navigator.clipboard.writeText(oneTimeSecret.value);
      toast({ title: "Secret copied", description: "Store it securely before closing this window." });
    } catch {
      toast({ title: "Could not copy secret", description: "Select and copy it manually before closing.", variant: "destructive" });
    }
  };

  return <div className="mx-auto w-full max-w-5xl space-y-5">
    <header className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-2xl font-semibold tracking-tight">API Keys</h1><p className="mt-1 text-sm text-muted-foreground">Manage stored API key records.</p></div>
      {canCreate && <Button onClick={() => setCreateOpen(true)}><Plus aria-hidden="true" className="mr-2 h-4 w-4" />Create API Key</Button>}
    </header>
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{isLoading ? "Loading keys…" : `${keys?.length ?? 0} keys`}{isFetching && !isLoading ? " · Updating" : ""}</p>
      <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}><RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />Refresh</Button>
    </div>
    <p className="text-sm text-muted-foreground">Only identifier prefixes are listed. A secret is shown once, when generated.</p>
    {isLoading ? <LoadingIndicator label="Loading API keys…" /> : isError && !keys ? (
      <EmptyState title="Unable to load API keys" description={error instanceof Error ? error.message : "Please try again."} actionLabel="Retry" onAction={() => void refetch()} />
    ) : !keys?.length ? (
      <EmptyState title="No API keys yet" description="Keys created for approved integrations will appear here." actionLabel={canCreate ? "Create API Key" : undefined} onAction={canCreate ? () => setCreateOpen(true) : undefined} />
    ) : <div className="divide-y rounded-xl border bg-background">
      {keys.map((key) => {
        const status = keyStatus(key);
        return <section key={key.id} aria-label={key.name} className="space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><h2 className="break-words font-semibold">{key.name}</h2><p className="mt-1 text-sm text-muted-foreground">Identifier: {key.token_prefix ?? "Unavailable"}…</p></div>
            <Badge variant={status === "Active" ? "secondary" : "outline"}>{status}</Badge>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <span>Created {dateLabel(key.created_at)}</span><span>Last used {dateLabel(key.last_used_at)}</span>
            {key.expires_at && <span>Expires {dateLabel(key.expires_at)}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(key.scopes ?? []).map((scope) => <Badge key={scope} variant="outline">{scope}</Badge>)}
            {status !== "Revoked" && (canRotate || canRevoke) && <div className="flex flex-wrap gap-2 sm:ml-auto">
              {canRotate && status === "Active" && <Button variant="outline" size="sm" onClick={() => setRotateTarget(key)}>Rotate</Button>}
              {canRevoke && <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setRevokeTarget(key)}>Revoke</Button>}
            </div>}
          </div>
        </section>;
      })}
    </div>}
    {isError && keys && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive"><span>Could not refresh keys. Showing the last loaded list.</span><Button variant="outline" size="sm" onClick={() => void refetch()}>Retry</Button></div>}

    <Dialog open={createOpen} onOpenChange={(open) => !createMutation.isPending && setCreateOpen(open)}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>Create API Key</DialogTitle><DialogDescription>The secret appears once after creation. Store it before closing.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2"><Label htmlFor="key-name">Key name</Label><Input id="key-name" value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="Integration name" autoComplete="off" /></div>
          <fieldset className="space-y-2"><legend className="text-sm font-medium">Access scopes</legend>
            {availableScopes.map((scope) => <div key={scope.id} className="flex items-center gap-2">
              <Checkbox id={`key-scope-${scope.id}`} checked={selectedScopes.includes(scope.id)} onCheckedChange={(checked) => setSelectedScopes((previous) => checked ? [...previous, scope.id] : previous.filter((item) => item !== scope.id))} />
              <Label htmlFor={`key-scope-${scope.id}`}>{scope.label}</Label>
            </div>)}
          </fieldset>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>Cancel</Button><Button onClick={createKey} disabled={createMutation.isPending}>{createMutation.isPending ? "Creating…" : "Generate Key"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!oneTimeSecret} onOpenChange={(open) => !open && setOneTimeSecret(null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Save this API key secret</DialogTitle><DialogDescription>{oneTimeSecret?.name}: this is the only time the secret can be viewed. Closing clears it from the page.</DialogDescription></DialogHeader>
        <div className="rounded-lg border bg-muted/50 p-3"><code className="block select-all break-all text-sm" aria-label="One-time API key secret">{oneTimeSecret?.value}</code></div>
        <DialogFooter><Button variant="outline" onClick={() => setOneTimeSecret(null)}>Done</Button><Button onClick={() => void copySecret()}><Copy aria-hidden="true" className="mr-2 h-4 w-4" />Copy secret</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={!!rotateTarget} title="Rotate API key?" description={`The current secret for ${rotateTarget?.name ?? "this key"} will stop working immediately. Update its consumers with the new secret.`} confirmLabel="Rotate key" onConfirm={() => rotateTarget && rotateMutation.mutate(rotateTarget.id)} onCancel={() => setRotateTarget(null)} isLoading={rotateMutation.isPending} />
    <ConfirmDialog open={!!revokeTarget} title="Revoke API key?" description={`Requests using ${revokeTarget?.name ?? "this key"} will stop working immediately.`} confirmLabel="Revoke key" onConfirm={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)} onCancel={() => setRevokeTarget(null)} isLoading={revokeMutation.isPending} />
  </div>;
};

export default ApiKeys;
