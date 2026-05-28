import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Plus, Send, Trash2, Webhook } from "lucide-react";
import { ApiError } from "@/api/apiClient";
import { webhooksApi } from "@/api/domains/webhooks";
import type { Webhook as WebhookRecord } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

const availableEvents = [
  { id: "screen.online", label: "Screen Comes Online" },
  { id: "screen.offline", label: "Screen Goes Offline" },
  { id: "content.approved", label: "Content Approved" },
  { id: "content.rejected", label: "Content Rejected" },
  { id: "content.published", label: "Content Published" },
  { id: "request.created", label: "Request Created" },
  { id: "request.completed", label: "Request Completed" },
  { id: "department.created", label: "Department Created" },
];

const statusLabel = (webhook: WebhookRecord) => {
  if (webhook.is_active === false) {
    return "Inactive";
  }

  if (!webhook.last_status) {
    return "Never tested";
  }

  if (webhook.last_status === "SUCCESS") {
    return "Healthy";
  }

  return webhook.last_status;
};

export default function Webhooks() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [webhookName, setWebhookName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);

  const { data: webhooks = [], isLoading, error } = useQuery({
    queryKey: ["webhooks"],
    queryFn: webhooksApi.list,
  });

  const createMutation = useMutation({
    mutationFn: webhooksApi.create,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      setWebhookName("");
      setWebhookUrl("");
      setSelectedEvents([]);
      setIsCreateDialogOpen(false);
      toast({
        title: "Webhook created",
        description: "The webhook is now persisted through the backend API.",
      });
    },
    onError: (mutationError) => {
      toast({
        title: "Create failed",
        description:
          mutationError instanceof ApiError
            ? mutationError.message
            : "Unable to create webhook.",
        variant: "destructive",
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: webhooksApi.test,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      toast({
        title: "Test delivered",
        description: `Webhook responded with status ${result.status_code}.`,
      });
    },
    onError: (mutationError) => {
      void queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      toast({
        title: "Test failed",
        description:
          mutationError instanceof ApiError
            ? mutationError.message
            : "Webhook test delivery failed.",
        variant: "destructive",
      });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      webhooksApi.update(id, { is_active }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    },
    onError: (mutationError) => {
      toast({
        title: "Update failed",
        description:
          mutationError instanceof ApiError
            ? mutationError.message
            : "Unable to update webhook.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: webhooksApi.remove,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      toast({
        title: "Webhook deleted",
        description: "The webhook was removed from the backend store.",
      });
    },
    onError: (mutationError) => {
      toast({
        title: "Delete failed",
        description:
          mutationError instanceof ApiError
            ? mutationError.message
            : "Unable to delete webhook.",
        variant: "destructive",
      });
    },
  });

  const hasSelection = useMemo(() => selectedEvents.length > 0, [selectedEvents.length]);

  const createWebhook = () => {
    if (!webhookName.trim() || !webhookUrl.trim() || !hasSelection) {
      toast({
        title: "Validation error",
        description: "Provide a name, URL, and at least one event type.",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate({
      name: webhookName.trim(),
      target_url: webhookUrl.trim(),
      event_types: selectedEvents,
      is_active: true,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">Webhook Configuration</h1>
          <p className="text-muted-foreground">
            Persist webhook endpoints and trigger a real delivery test through the backend.
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Webhook
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Webhook</DialogTitle>
              <DialogDescription>
                Configure a persisted webhook endpoint and subscribed event types.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="webhook-name">Name</Label>
                <Input
                  id="webhook-name"
                  placeholder="Publishing Alerts"
                  value={webhookName}
                  onChange={(event) => setWebhookName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="webhook-url">Webhook URL</Label>
                <Input
                  id="webhook-url"
                  placeholder="https://api.example.com/webhooks/signhex"
                  value={webhookUrl}
                  onChange={(event) => setWebhookUrl(event.target.value)}
                />
              </div>

              <div className="space-y-3">
                <Label>Event Types</Label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {availableEvents.map((event) => (
                    <div key={event.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={event.id}
                        checked={selectedEvents.includes(event.id)}
                        onCheckedChange={(checked) => {
                          setSelectedEvents((current) =>
                            checked
                              ? [...current, event.id]
                              : current.filter((entry) => entry !== event.id),
                          );
                        }}
                      />
                      <Label htmlFor={event.id} className="text-sm font-normal cursor-pointer">
                        {event.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsCreateDialogOpen(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button onClick={createWebhook} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create Webhook"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5" />
            Persisted Webhooks
          </CardTitle>
          <CardDescription>
            The table reflects the current backend subscription rows and latest test status.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="py-6 text-sm text-destructive">
              {error instanceof ApiError ? error.message : "Unable to load webhooks."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Target URL</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Test</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      Loading webhooks...
                    </TableCell>
                  </TableRow>
                ) : webhooks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      No webhooks configured yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  webhooks.map((webhook) => (
                    <TableRow key={webhook.id}>
                      <TableCell className="font-medium">{webhook.name}</TableCell>
                      <TableCell className="max-w-[20rem] truncate">{webhook.target_url}</TableCell>
                      <TableCell className="max-w-[16rem]">
                        <div className="flex flex-wrap gap-1">
                          {webhook.event_types.map((eventType) => (
                            <Badge key={eventType} variant="secondary">
                              {eventType}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={webhook.is_active === false ? "outline" : "default"}>
                          {statusLabel(webhook)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {webhook.last_status_at
                          ? new Date(webhook.last_status_at).toLocaleString()
                          : "Never"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => testMutation.mutate(webhook.id)}
                            disabled={testMutation.isPending}
                          >
                            <Send className="mr-2 h-4 w-4" />
                            Test
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              toggleMutation.mutate({
                                id: webhook.id,
                                is_active: webhook.is_active === false,
                              })
                            }
                            disabled={toggleMutation.isPending}
                          >
                            {webhook.is_active === false ? "Activate" : "Deactivate"}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => deleteMutation.mutate(webhook.id)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-700">
            <AlertCircle className="h-5 w-5" />
            Delivery visibility
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The backend currently stores the latest delivery status and timestamp per webhook. This
          page reflects that persisted state instead of simulating a local delivery log.
        </CardContent>
      </Card>
    </div>
  );
}
