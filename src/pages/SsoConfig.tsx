import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Copy, Shield } from "lucide-react";
import { ApiError } from "@/api/apiClient";
import { ssoApi } from "@/api/domains/ssoConfig";
import type { SsoConfig as SsoConfigRecord } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type SsoFormState = {
  provider: string;
  issuer: string;
  client_id: string;
  client_secret: string;
  authorization_url: string;
  token_url: string;
  jwks_url: string;
  redirect_uri: string;
  scopes: string;
};

const createDefaultState = (): SsoFormState => ({
  provider: "oidc",
  issuer: "",
  client_id: "",
  client_secret: "",
  authorization_url: "",
  token_url: "",
  jwks_url: "",
  redirect_uri:
    typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : "",
  scopes: "openid, profile, email",
});

const mapConfigToState = (config: SsoConfigRecord | null): SsoFormState => {
  if (!config) {
    return createDefaultState();
  }

  return {
    provider: config.provider || "oidc",
    issuer: config.issuer || "",
    client_id: config.client_id || "",
    client_secret: config.client_secret || "",
    authorization_url: config.authorization_url || "",
    token_url: config.token_url || "",
    jwks_url: config.jwks_url || "",
    redirect_uri:
      config.redirect_uri ||
      (typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : ""),
    scopes: (config.scopes ?? []).join(", "),
  };
};

export default function SsoConfig() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formState, setFormState] = useState<SsoFormState>(createDefaultState);

  const { data: activeConfig, isLoading, error } = useQuery({
    queryKey: ["sso-config", "active"],
    queryFn: ssoApi.getActive,
  });

  useEffect(() => {
    setFormState(mapConfigToState(activeConfig ?? null));
  }, [activeConfig]);

  const scopes = useMemo(
    () =>
      formState.scopes
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    [formState.scopes],
  );

  const saveMutation = useMutation({
    mutationFn: () =>
      ssoApi.upsert({
        provider: formState.provider.trim() || "oidc",
        issuer: formState.issuer.trim(),
        client_id: formState.client_id.trim(),
        client_secret: formState.client_secret.trim(),
        authorization_url: formState.authorization_url.trim() || undefined,
        token_url: formState.token_url.trim() || undefined,
        jwks_url: formState.jwks_url.trim() || undefined,
        redirect_uri: formState.redirect_uri.trim() || undefined,
        scopes,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sso-config", "active"] });
      toast({
        title: "Configuration saved",
        description: "The active SSO configuration was persisted through the backend API.",
      });
    },
    onError: (mutationError) => {
      toast({
        title: "Save failed",
        description:
          mutationError instanceof ApiError
            ? mutationError.message
            : "Unable to save SSO configuration.",
        variant: "destructive",
      });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => ssoApi.deactivate(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sso-config", "active"] });
      toast({
        title: "Configuration deactivated",
        description: "The active SSO configuration was disconnected.",
      });
    },
    onError: (mutationError) => {
      toast({
        title: "Disconnect failed",
        description:
          mutationError instanceof ApiError
            ? mutationError.message
            : "Unable to deactivate SSO configuration.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!formState.issuer.trim() || !formState.client_id.trim() || !formState.client_secret.trim()) {
      toast({
        title: "Validation error",
        description: "Issuer, client ID, and client secret are required.",
        variant: "destructive",
      });
      return;
    }

    saveMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">SSO / OIDC Configuration</h1>
          <p className="text-muted-foreground">
            Persist the active sign-in provider through the existing backend lifecycle.
          </p>
        </div>
        {activeConfig ? (
          <Badge variant="default" className="flex items-center gap-2">
            <CheckCircle className="h-3 w-3" />
            Active
          </Badge>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Active Provider
          </CardTitle>
          <CardDescription>
            Save and deactivate the currently active provider. This page no longer simulates a
            successful connection test.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error ? (
            <div className="text-sm text-destructive">
              {error instanceof ApiError ? error.message : "Unable to load SSO configuration."}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="provider">Provider</Label>
            <Select
              value={formState.provider}
              onValueChange={(value) => setFormState((current) => ({ ...current, provider: value }))}
              disabled={isLoading}
            >
              <SelectTrigger id="provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="oidc">Generic OIDC</SelectItem>
                <SelectItem value="google">Google Workspace</SelectItem>
                <SelectItem value="azure">Azure Active Directory</SelectItem>
                <SelectItem value="okta">Okta</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="grid gap-4 md:grid-cols-2">
            <Field
              id="issuer"
              label="Issuer"
              value={formState.issuer}
              onChange={(value) => setFormState((current) => ({ ...current, issuer: value }))}
              placeholder="https://issuer.example.com"
            />
            <Field
              id="client-id"
              label="Client ID"
              value={formState.client_id}
              onChange={(value) => setFormState((current) => ({ ...current, client_id: value }))}
              placeholder="cms-client-id"
            />
            <Field
              id="client-secret"
              label="Client Secret"
              value={formState.client_secret}
              onChange={(value) => setFormState((current) => ({ ...current, client_secret: value }))}
              placeholder="super-secret"
              type="password"
            />
            <Field
              id="authorization-url"
              label="Authorization URL"
              value={formState.authorization_url}
              onChange={(value) =>
                setFormState((current) => ({ ...current, authorization_url: value }))
              }
              placeholder="https://issuer.example.com/authorize"
            />
            <Field
              id="token-url"
              label="Token URL"
              value={formState.token_url}
              onChange={(value) => setFormState((current) => ({ ...current, token_url: value }))}
              placeholder="https://issuer.example.com/token"
            />
            <Field
              id="jwks-url"
              label="JWKS URL"
              value={formState.jwks_url}
              onChange={(value) => setFormState((current) => ({ ...current, jwks_url: value }))}
              placeholder="https://issuer.example.com/jwks"
            />
          </div>

          <Field
            id="redirect-uri"
            label="Redirect URI"
            value={formState.redirect_uri}
            onChange={(value) => setFormState((current) => ({ ...current, redirect_uri: value }))}
            placeholder="https://cms.example.com/auth/callback"
          />

          <div className="space-y-2">
            <Label htmlFor="scopes">Scopes</Label>
            <Textarea
              id="scopes"
              value={formState.scopes}
              onChange={(event) =>
                setFormState((current) => ({ ...current, scopes: event.target.value }))
              }
              rows={3}
              placeholder="openid, profile, email"
            />
          </div>

          <div className="flex flex-col gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Connection testing</span>
            <span>
              The current backend route surface persists configuration and deactivation only. This
              page intentionally does not simulate a fake successful test connection.
            </span>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={handleSave} disabled={saveMutation.isPending || isLoading}>
              {saveMutation.isPending ? "Saving..." : "Save Configuration"}
            </Button>
            {activeConfig ? (
              <Button
                variant="destructive"
                onClick={() => deactivateMutation.mutate(activeConfig.id)}
                disabled={deactivateMutation.isPending}
              >
                {deactivateMutation.isPending ? "Disconnecting..." : "Disconnect"}
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={() => {
                if (typeof navigator !== "undefined" && navigator.clipboard) {
                  void navigator.clipboard.writeText(formState.redirect_uri);
                }
                toast({
                  title: "Copied",
                  description: "Redirect URI copied to clipboard.",
                });
              }}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy Redirect URI
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
