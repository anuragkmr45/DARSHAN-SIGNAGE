import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Send } from "lucide-react";
import { ApiError } from "@/api/apiClient";
import { webhooksApi } from "@/api/domains/webhooks";
import type { Webhook as WebhookRecord } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingIndicator } from "@/components/common/LoadingIndicator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useToast } from "@/hooks/use-toast";

const availableEvents = [
  { id: "screen.online", label: "Screen Comes Online" },
  { id: "screen.offline", label: "Screen Goes Offline" },
  { id: "content.approved", label: "Content Approved" },
  { id: "content.rejected", label: "Content Rejected" },
  { id: "content.published", label: "Content Published" },
  { id: "department.created", label: "Department Created" },
];
const eventLabel = (id: string) => availableEvents.find((event) => event.id === id)?.label ?? id;
const lastTestLabel = (status?: string | null) => {
  if (!status) return "No test yet";
  if (status === "SUCCESS") return "Last test succeeded";
  if (status.startsWith("FAILED_HTTP_")) return `Last test failed (HTTP ${status.slice("FAILED_HTTP_".length)})`;
  return "Last test failed";
};
const dateLabel = (value?: string | null) => {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
};

export default function Webhooks() {
  const { toast } = useToast();
  const { can } = useAuthorization();
  const queryClient = useQueryClient();
  const canCreate = can("create", "Webhook");
  const canUpdate = can("update", "Webhook");
  const canDelete = can("delete", "Webhook");
  const [createOpen, setCreateOpen] = useState(false);
  const [webhookName, setWebhookName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<WebhookRecord | null>(null);

  const { data: webhooks, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["webhooks"], queryFn: webhooksApi.list,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["webhooks"] });
  const showError = (failure: unknown, title: string) => toast({
    title,
    description: failure instanceof ApiError ? failure.message : "Please try again.",
    variant: "destructive",
  });
  const createMutation = useMutation({
    retry: false,
    mutationFn: webhooksApi.create,
    onSuccess: () => {
      refresh();
      setWebhookName(""); setWebhookUrl(""); setSelectedEvents([]); setCreateOpen(false);
      toast({ title: "Webhook saved", description: "Use Test to check whether this endpoint can receive a request." });
    },
    onError: (failure) => showError(failure, "Could not save webhook"),
  });
  const testMutation = useMutation({
    retry: false,
    mutationFn: webhooksApi.test,
    onSuccess: (result) => {
      refresh();
      toast({ title: "Test request delivered", description: `Endpoint returned HTTP ${result.status_code}.` });
    },
    onError: (failure) => { refresh(); showError(failure, "Test request failed"); },
  });
  const toggleMutation = useMutation({
    retry: false,
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) => webhooksApi.update(id, { is_active }),
    onSuccess: () => refresh(),
    onError: (failure) => showError(failure, "Could not update webhook"),
  });
  const deleteMutation = useMutation({
    retry: false,
    mutationFn: webhooksApi.remove,
    onSuccess: () => {
      setDeleteTarget(null); refresh();
      toast({ title: "Webhook deleted" });
    },
    onError: (failure) => showError(failure, "Could not delete webhook"),
  });
  const createWebhook = () => {
    const name = webhookName.trim();
    const targetUrl = webhookUrl.trim();
    if (!name || !targetUrl || selectedEvents.length === 0) {
      toast({ title: "Complete the required fields", description: "Add a name, URL and at least one event.", variant: "destructive" });
      return;
    }
    try {
      const parsed = new URL(targetUrl);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    } catch {
      toast({ title: "Check the URL", description: "Use an HTTP or HTTPS address without embedded credentials.", variant: "destructive" });
      return;
    }
    createMutation.mutate({ name, target_url: targetUrl, event_types: selectedEvents, is_active: true });
  };

  return <div className="mx-auto w-full max-w-5xl space-y-5">
    <header className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-2xl font-semibold tracking-tight">Webhooks</h1><p className="mt-1 text-sm text-muted-foreground">Configure endpoints and check delivery manually.</p></div>
      {canCreate && <Button onClick={() => setCreateOpen(true)}><Plus aria-hidden="true" className="mr-2 h-4 w-4" />Add Webhook</Button>}
    </header>
    <p role="note" className="border-l-2 border-amber-500 pl-3 text-sm leading-6 text-muted-foreground">Only the explicit Test action sends a request in this build. Event subscriptions are stored; automatic event delivery is not yet available.</p>
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{isLoading ? "Loading webhooks…" : `${webhooks?.length ?? 0} endpoints`}{isFetching && !isLoading ? " · Updating" : ""}</p>
      <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}><RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />Refresh</Button>
    </div>
    {isLoading ? <LoadingIndicator label="Loading webhooks…" /> : isError && !webhooks ? (
      <EmptyState title="Unable to load webhooks" description={error instanceof Error ? error.message : "Please try again."} actionLabel="Retry" onAction={() => void refetch()} />
    ) : !webhooks?.length ? (
      <EmptyState title="No webhooks yet" description="Saved endpoints will appear here." actionLabel={canCreate ? "Add Webhook" : undefined} onAction={canCreate ? () => setCreateOpen(true) : undefined} />
    ) : <div className="divide-y rounded-xl border bg-background">
      {webhooks.map((webhook) => <section key={webhook.id} aria-label={webhook.name} className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0"><h2 className="break-words font-semibold">{webhook.name}</h2><p className="mt-1 break-all text-sm text-muted-foreground">{webhook.target_url}</p></div>
          <Badge variant={webhook.is_active === false ? "outline" : "secondary"}>{webhook.is_active === false ? "Paused" : "Enabled"}</Badge>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{lastTestLabel(webhook.last_status)}</span><span>Tested {dateLabel(webhook.last_status_at)}</span>
        </div>
        <div className="flex flex-wrap gap-1">{webhook.event_types.map((event) => <Badge key={event} variant="outline">{eventLabel(event)}</Badge>)}</div>
        {canUpdate || canDelete ? <div className="flex flex-wrap gap-2 border-t border-border/70 pt-3">
          {canUpdate && <Button variant="outline" size="sm" onClick={() => testMutation.mutate(webhook.id)} disabled={testMutation.isPending}><Send aria-hidden="true" className="mr-2 h-4 w-4" />Test</Button>}
          {canUpdate && <Button variant="ghost" size="sm" onClick={() => toggleMutation.mutate({ id: webhook.id, is_active: webhook.is_active === false })} disabled={toggleMutation.isPending}>{webhook.is_active === false ? "Enable" : "Pause"}</Button>}
          {canDelete && <Button variant="ghost" size="sm" className="text-destructive sm:ml-auto" onClick={() => setDeleteTarget(webhook)}>Delete</Button>}
        </div> : null}
      </section>)}
    </div>}
    {isError && webhooks && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive"><span>Could not refresh webhooks. Showing the last loaded list.</span><Button variant="outline" size="sm" onClick={() => void refetch()}>Retry</Button></div>}

    <Dialog open={createOpen} onOpenChange={(open) => !createMutation.isPending && setCreateOpen(open)}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>Add Webhook</DialogTitle><DialogDescription>Save a destination and choose the events it may receive when automatic delivery is enabled.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2"><Label htmlFor="webhook-name">Name</Label><Input id="webhook-name" value={webhookName} onChange={(event) => setWebhookName(event.target.value)} placeholder="Publishing alerts" /></div>
          <div className="space-y-2"><Label htmlFor="webhook-url">HTTP or HTTPS URL</Label><Input id="webhook-url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://service.example.test/webhook" inputMode="url" /></div>
          <fieldset className="space-y-2"><legend className="text-sm font-medium">Event types</legend>
            {availableEvents.map((event) => <div key={event.id} className="flex items-center gap-2">
              <Checkbox id={`webhook-event-${event.id}`} checked={selectedEvents.includes(event.id)} onCheckedChange={(checked) => setSelectedEvents((previous) => checked ? [...previous, event.id] : previous.filter((item) => item !== event.id))} />
              <Label htmlFor={`webhook-event-${event.id}`}>{event.label}</Label>
            </div>)}
          </fieldset>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>Cancel</Button><Button onClick={createWebhook} disabled={createMutation.isPending}>{createMutation.isPending ? "Saving…" : "Create Webhook"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={!!deleteTarget} title="Delete webhook?" description={`The saved endpoint ${deleteTarget?.name ?? ""} will be removed. This cannot be undone.`} confirmLabel="Delete webhook" onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)} onCancel={() => setDeleteTarget(null)} isLoading={deleteMutation.isPending} />
  </div>;
}
