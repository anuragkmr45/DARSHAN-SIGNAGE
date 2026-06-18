import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Key, Copy, Trash2, Plus, Eye, EyeOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiKeysApi } from "@/api/domains/apiKeys";
import { ApiError } from "@/api/apiClient";
import type { ApiKey as ApiKeyModel } from "@/api/types";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setApiKey } from "@/store/authSlice";

const availableScopes = [
  { id: "read", label: "Read" },
  { id: "write", label: "Write" },
  { id: "admin", label: "Admin" },
];

const maskKey = (key?: string) => {
  if (!key) return "********";
  if (key.length <= 8) return `${key.slice(0, 2)}****`;
  return `${key.slice(0, 6)}******${key.slice(-4)}`;
};

const ApiKeys = () => {
  const { toast } = useToast();
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const authToken = useAppSelector((state) => state.auth.token);
  const user = useAppSelector((state) => state.auth.user);
  const isAuthenticated = Boolean(authToken || user);

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [secrets, setSecrets] = useState<Record<string, string>>({});

  const { data: apiKeys, isLoading, isFetching } = useQuery({
    queryKey: ["api-keys"],
    queryFn: apiKeysApi.list,
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const handleApiError = (error: unknown, title = "Request failed") => {
    const description =
      error instanceof ApiError ? error.message : "Unable to complete the request.";
    toast({ title, description, variant: "destructive" });
  };

  const createMutation = useMutation({
    mutationFn: apiKeysApi.create,
    onSuccess: (created) => {
      setKeyName("");
      setSelectedScopes([]);
      setIsCreateDialogOpen(false);
      if (created.secret) {
        setSecrets((prev) => ({ ...prev, [created.id]: created.secret! }));
        dispatch(setApiKey(created.secret));
      }
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast({
        title: "API key created",
        description: "Copy and store the secret securely; it is shown once.",
      });
    },
    onError: (error) => handleApiError(error, "Could not create API key"),
  });

  const rotateMutation = useMutation({
    mutationFn: apiKeysApi.rotate,
    onSuccess: (rotated) => {
      if (rotated.secret) {
        setSecrets((prev) => ({ ...prev, [rotated.id]: rotated.secret! }));
        dispatch(setApiKey(rotated.secret));
      }
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast({
        title: "API key rotated",
        description: "New secret generated. Update any consumers.",
      });
    },
    onError: (error) => handleApiError(error, "Could not rotate key"),
  });

  const revokeMutation = useMutation({
    mutationFn: apiKeysApi.revoke,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast({ title: "Key revoked", description: "The key is inactive now." });
    },
    onError: (error) => handleApiError(error, "Could not revoke key"),
  });

  const handleCreateKey = () => {
    if (!keyName.trim() || selectedScopes.length === 0) {
      toast({
        title: "Validation error",
        description: "Provide a name and select at least one scope.",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({ name: keyName, scopes: selectedScopes, roles: ["ADMIN"] });
  };

  const toggleKeyVisibility = (id: string) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCopyKey = async (key?: string) => {
    if (!key) return;
    await navigator.clipboard.writeText(key);
    toast({ title: "Copied", description: "API key copied to clipboard." });
  };

  const resolvedKeys: ApiKeyModel[] = useMemo(
    () => apiKeys ?? [],
    [apiKeys],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">API Key Management</h1>
          <p className="text-muted-foreground">
            Generate and manage API keys for programmatic access
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button disabled={!isAuthenticated}>
              <Plus className="mr-2 h-4 w-4" />
              Create API Key
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New API Key</DialogTitle>
              <DialogDescription>
                Generate a new API key with specific permissions
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="key-name">Key Name</Label>
                <Input
                  id="key-name"
                  placeholder="Production API Key"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  autoComplete="off"
                />
              </div>

              <div className="space-y-3">
                <Label>Permissions & Scopes</Label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {availableScopes.map((scope) => (
                    <div key={scope.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={scope.id}
                        checked={selectedScopes.includes(scope.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedScopes((prev) => [...prev, scope.id]);
                          } else {
                            setSelectedScopes((prev) => prev.filter((s) => s !== scope.id));
                          }
                        }}
                      />
                      <Label htmlFor={scope.id} className="text-sm font-normal cursor-pointer">
                        {scope.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateKey} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Generate Key"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Active API Keys
          </CardTitle>
          <CardDescription>
            {isAuthenticated
              ? "Manage your API keys and their permissions"
              : "Sign in to view and manage API keys."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>API Key</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading || isFetching ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    Loading keys...
                  </TableCell>
                </TableRow>
              ) : resolvedKeys.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    No keys yet. Create one to get started.
                  </TableCell>
                </TableRow>
              ) : (
                resolvedKeys.map((apiKey) => {
                  const status = apiKey.revoked_at ? "revoked" : "active";
                  const secret = secrets[apiKey.id];
                  const displayKey = secret ?? apiKey.secret ?? apiKey.id;

                  return (
                    <TableRow key={apiKey.id}>
                      <TableCell className="font-medium">{apiKey.name}</TableCell>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-2">
                          <code className="max-w-[14rem] truncate rounded bg-muted px-2 py-1 text-xs sm:max-w-none">
                            {visibleKeys.has(apiKey.id) ? displayKey : maskKey(displayKey)}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleKeyVisibility(apiKey.id)}
                          >
                            {visibleKeys.has(apiKey.id) ? (
                              <EyeOff className="h-3 w-3" />
                            ) : (
                              <Eye className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(apiKey.scopes ?? []).slice(0, 2).map((scope) => (
                            <Badge key={scope} variant="secondary" className="text-xs">
                              {scope}
                            </Badge>
                          ))}
                          {(apiKey.scopes?.length ?? 0) > 2 && (
                            <Badge variant="secondary" className="text-xs">
                              +{(apiKey.scopes?.length ?? 0) - 2} more
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {apiKey.created_at ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {apiKey.last_used_at ?? "Never"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={status === "active" ? "default" : "destructive"}>
                          {status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopyKey(displayKey)}
                            disabled={status === "revoked"}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => rotateMutation.mutate(apiKey.id)}
                            disabled={status === "revoked"}
                          >
                            <RefreshCw className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => revokeMutation.mutate(apiKey.id)}
                            disabled={status === "revoked"}
                          >
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default ApiKeys;
