import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Filter, Plus, Search } from "lucide-react";
import { ApiError } from "@/api/apiClient";
import { requestsApi, type RequestPayload } from "@/api/domains/requests";
import type { RequestTicket } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const statusColors: Record<string, string> = {
  OPEN: "bg-blue-500/10 text-blue-700",
  IN_PROGRESS: "bg-amber-500/10 text-amber-700",
  CLOSED: "bg-emerald-500/10 text-emerald-700",
};

const defaultPayload: RequestPayload = {
  title: "",
  description: "",
  priority: "MEDIUM",
};

export default function Requests() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [payload, setPayload] = useState<RequestPayload>(defaultPayload);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["requests"],
    queryFn: () => requestsApi.list({ page: 1, limit: 100 }),
  });

  const createRequest = useMutation({
    mutationFn: (body: RequestPayload) => requestsApi.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["requests"] });
      setIsCreateOpen(false);
      setPayload(defaultPayload);
      toast({
        title: "Request submitted",
        description: "The request was saved to the shared workboard.",
      });
    },
    onError: (mutationError) => {
      const message =
        mutationError instanceof ApiError
          ? mutationError.message
          : "Unable to create request.";
      toast({
        title: "Create failed",
        description: message,
        variant: "destructive",
      });
    },
  });

  const requests = useMemo(() => data?.items ?? [], [data]);

  const filteredRequests = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return requests;
    }

    return requests.filter((request) => {
      return (
        request.title.toLowerCase().includes(query) ||
        (request.description ?? "").toLowerCase().includes(query) ||
        (request.priority ?? "").toLowerCase().includes(query) ||
        (request.status ?? "").toLowerCase().includes(query)
      );
    });
  }, [requests, searchQuery]);

  const submitRequest = () => {
    if (!payload.title?.trim()) {
      toast({
        title: "Validation error",
        description: "A request title is required.",
        variant: "destructive",
      });
      return;
    }

    createRequest.mutate({
      ...payload,
      title: payload.title.trim(),
      description: payload.description?.trim() || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Requests Workboard</h1>
          <p className="text-muted-foreground mt-1">
            Track generic requests that are handled outside the schedule-request workflow.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled>
            <Filter className="mr-2 h-4 w-4" />
            Filters
          </Button>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Request
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search requests by title, description, priority, or status..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="pl-9"
          />
        </div>
        <div className="text-sm text-muted-foreground">
          {isFetching ? "Refreshing..." : `${filteredRequests.length} requests`}
        </div>
      </div>

      {error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">
            {error instanceof ApiError ? error.message : "Unable to load requests."}
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-40" />
          ))}
        </div>
      ) : filteredRequests.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No requests match the current filter.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filteredRequests.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
        </div>
      )}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Request</DialogTitle>
            <DialogDescription>
              Submit a new request to the shared admin workboard.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="request-title">Title</Label>
              <Input
                id="request-title"
                value={payload.title}
                onChange={(event) =>
                  setPayload((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="e.g. Front desk announcement refresh"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="request-description">Description</Label>
              <Textarea
                id="request-description"
                value={payload.description}
                onChange={(event) =>
                  setPayload((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                rows={4}
                placeholder="Provide context, links, or approval notes."
              />
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={payload.priority ?? "MEDIUM"}
                onValueChange={(value) =>
                  setPayload((current) => ({
                    ...current,
                    priority: value as RequestPayload["priority"],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateOpen(false)}
              disabled={createRequest.isPending}
            >
              Cancel
            </Button>
            <Button onClick={submitRequest} disabled={createRequest.isPending}>
              {createRequest.isPending ? "Submitting..." : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RequestCard({ request }: { request: RequestTicket }) {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg leading-tight">{request.title}</CardTitle>
          <Badge className={statusColors[request.status ?? "OPEN"] ?? "bg-secondary text-foreground"}>
            {request.status ?? "OPEN"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p className="line-clamp-3">{request.description || "No description provided."}</p>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{request.priority ?? "MEDIUM"}</Badge>
          {request.assigned_to ? <Badge variant="secondary">Assigned</Badge> : null}
        </div>
      </CardContent>
    </Card>
  );
}
