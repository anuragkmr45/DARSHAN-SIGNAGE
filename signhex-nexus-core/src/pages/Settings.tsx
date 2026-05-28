import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Brush,
  Clock3,
  Database,
  Globe,
  ImageUp,
  Lock,
  Palette,
  Save,
  Shield,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RolesPermissionsTab } from "@/components/settings/RolesPermissionsTab";
import { DefaultMediaSection } from "@/components/settings/DefaultMediaSection";
import { MediaPreview } from "@/components/common/MediaPreview";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useAppSelector } from "@/store/hooks";
import {
  useAppearanceSettings,
  useBackupRuns,
  useBackupSettings,
  useBrandingSettings,
  useDeleteBackupRun,
  useGeneralSettings,
  useRecentLogs,
  useRunBackupNow,
  useSecuritySettings,
  useUpdateAppearanceSettings,
  useUpdateBackupSettings,
  useUpdateBrandingSettings,
  useUpdateGeneralSettings,
  useUpdateSecuritySettings,
} from "@/hooks/useSettingsApi";
import { canManageBrandingSettings } from "@/lib/access";
import { mediaApi } from "@/api/domains/media";
import type { BackupRun, MediaAsset } from "@/api/types";
import { uploadMediaWithPresign, validateUploadFile, getFriendlyUploadError } from "@/lib/mediaUploadFlow";
import { useToast } from "@/hooks/use-toast";

const BRANDING_FIELDS = [
  { key: "logo_media_id", label: "Logo", hint: "Shown in the sidebar and login screen." },
  { key: "icon_media_id", label: "App icon", hint: "Used in compact UI surfaces." },
  { key: "favicon_media_id", label: "Favicon", hint: "Shown in the browser tab." },
] as const;

const sidebarModes = [
  { value: "expanded", label: "Always expanded" },
  { value: "collapsed", label: "Always collapsed" },
  { value: "auto", label: "Auto responsive" },
] as const;

const accentPresets = [
  { value: "crimson", label: "Crimson" },
  { value: "blue", label: "Blue" },
  { value: "emerald", label: "Emerald" },
  { value: "amber", label: "Amber" },
  { value: "slate", label: "Slate" },
] as const;

function formatBackupError(message: string | null | undefined) {
  if (!message) return null;
  return message.replace(/\s+/g, " ").trim();
}

function BrandingAssetField({
  label,
  hint,
  mediaId,
  mediaUrl,
  onChange,
}: {
  label: string;
  hint: string;
  mediaId: string | null;
  mediaUrl: string | null;
  onChange: (nextId: string | null, nextUrl?: string | null) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();
  const mediaQuery = useQuery({
    queryKey: ["settings", "branding", "media-picker"],
    queryFn: () => mediaApi.list({ limit: 50, status: "READY" as never, type: "IMAGE" }),
    staleTime: 60_000,
    enabled: pickerOpen,
  });

  const mediaItems = mediaQuery.data?.items ?? [];

  const handleUpload = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;

    const validationError = validateUploadFile(file);
    if (validationError) {
      toast({ title: "Upload failed", description: validationError, variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const result = await uploadMediaWithPresign(file, { displayName: `${label} ${file.name}` });
      onChange(result.media.id, result.media.media_url ?? result.media.fallback_media_url ?? null);
      toast({ title: `${label} updated`, description: "Uploaded media is now assigned." });
    } catch (error) {
      toast({
        title: "Upload failed",
        description: getFriendlyUploadError(error),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
        <CardDescription>{hint}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-lg border bg-muted/30 flex items-center justify-center overflow-hidden">
            {mediaUrl ? (
              <MediaPreview
                url={mediaUrl}
                type="image"
                alt={label}
                fit="contain"
                className="h-full w-full rounded-none"
              />
            ) : (
              <ImageUp className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">
              {mediaId ? "Assigned from media library" : "No media assigned"}
            </div>
            <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setPickerOpen(true)}>
                <Brush className="mr-2 h-4 w-4" />
                Choose existing
              </Button>
              <Label className="inline-flex">
                <Input
                  type="file"
                  className="hidden"
                  onChange={(event) => void handleUpload(event.target.files)}
                  disabled={uploading}
                />
                <Button type="button" variant="outline" disabled={uploading} asChild>
                  <span>
                    <Upload className="mr-2 h-4 w-4" />
                    {uploading ? "Uploading..." : "Upload new"}
                  </span>
                </Button>
              </Label>
              {mediaId ? (
                <Button variant="ghost" onClick={() => onChange(null, null)}>
                  Clear
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Select {label}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 md:grid-cols-2">
              {mediaItems.map((media) => (
                <button
                  key={media.id}
                  type="button"
                  className="rounded-lg border p-3 text-left hover:border-primary transition-colors"
                  onClick={() => {
                    onChange(media.id, media.media_url ?? media.fallback_media_url ?? null);
                    setPickerOpen(false);
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="h-14 w-14 rounded bg-muted/40 overflow-hidden flex items-center justify-center">
                      {media.media_url || media.fallback_media_url ? (
                        <MediaPreview
                          media={media}
                          url={media.media_url ?? media.fallback_media_url ?? undefined}
                          type={media.content_type ?? media.source_content_type ?? media.type}
                          alt={media.display_name ?? media.name}
                          className="h-full w-full rounded-none"
                        />
                      ) : (
                        <ImageUp className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{media.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{media.display_name ?? media.name}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

const Settings = () => {
  const { toast } = useToast();
  const { can, role } = useAuthorization();
  const currentUser = useAppSelector((state) => state.auth.user);
  const canEditBranding = canManageBrandingSettings(currentUser ?? undefined, role, can);

  const generalQuery = useGeneralSettings();
  const brandingQuery = useBrandingSettings();
  const securityQuery = useSecuritySettings();
  const appearanceQuery = useAppearanceSettings();
  const backupSettingsQuery = useBackupSettings();
  const backupRunsQuery = useBackupRuns();
  const [logLevelFilter, setLogLevelFilter] = useState<string>("all");
  const recentLogsQuery = useRecentLogs({
    limit: 100,
    level: logLevelFilter === "all" ? undefined : logLevelFilter,
  });

  const updateGeneral = useUpdateGeneralSettings();
  const updateBranding = useUpdateBrandingSettings();
  const updateSecurity = useUpdateSecuritySettings();
  const updateAppearance = useUpdateAppearanceSettings();
  const updateBackups = useUpdateBackupSettings();
  const runBackupNow = useRunBackupNow();
  const deleteBackupRun = useDeleteBackupRun();

  const [general, setGeneral] = useState({ company_name: "", timezone: "UTC", language: "en" });
  const [branding, setBranding] = useState({
    app_name: "",
    logo_media_id: null as string | null,
    icon_media_id: null as string | null,
    favicon_media_id: null as string | null,
    logo_url: null as string | null,
    icon_url: null as string | null,
    favicon_url: null as string | null,
  });
  const [security, setSecurity] = useState({
    idle_timeout_minutes: 30,
    password_policy: {
      min_length: 12,
      require_uppercase: true,
      require_lowercase: true,
      require_number: true,
      require_special: true,
    },
  });
  const [appearance, setAppearance] = useState({
    theme_mode: "light" as const,
    accent_preset: "crimson" as const,
    sidebar_mode: "expanded" as const,
  });
  const [backups, setBackups] = useState({
    automatic_enabled: false,
    interval_hours: 24,
    log_level: "info" as const,
  });
  const [backupPendingDelete, setBackupPendingDelete] = useState<BackupRun | null>(null);

  useEffect(() => {
    if (generalQuery.data) setGeneral(generalQuery.data);
  }, [generalQuery.data]);

  useEffect(() => {
    if (brandingQuery.data) setBranding(brandingQuery.data);
  }, [brandingQuery.data]);

  useEffect(() => {
    if (securityQuery.data) setSecurity(securityQuery.data);
  }, [securityQuery.data]);

  useEffect(() => {
    if (appearanceQuery.data) setAppearance(appearanceQuery.data);
  }, [appearanceQuery.data]);

  useEffect(() => {
    if (backupSettingsQuery.data) setBackups(backupSettingsQuery.data);
  }, [backupSettingsQuery.data]);

  const backupRuns = backupRunsQuery.data?.items ?? [];
  const recentLogs = recentLogsQuery.data?.items ?? [];
  const automaticBackupsEnabled = backups.automatic_enabled;

  const brandingPreviewName = branding.app_name.trim() || "Signhex CMS";

  const handleBrandingAssetChange = (
    key: "logo_media_id" | "icon_media_id" | "favicon_media_id",
    nextId: string | null,
    nextUrl?: string | null,
  ) => {
    const urlKey = key === "logo_media_id" ? "logo_url" : key === "icon_media_id" ? "icon_url" : "favicon_url";
    setBranding((current) => ({
      ...current,
      [key]: nextId,
      [urlKey]: nextUrl ?? current[urlKey],
    }));
  };

  const passwordRequirementSummary = useMemo(() => {
    const rules = [];
    if (security.password_policy.require_uppercase) rules.push("uppercase");
    if (security.password_policy.require_lowercase) rules.push("lowercase");
    if (security.password_policy.require_number) rules.push("number");
    if (security.password_policy.require_special) rules.push("special");
    return rules.join(", ");
  }, [security.password_policy]);

  const canDeleteBackup = (run: BackupRun) => run.status !== "PENDING" && run.status !== "RUNNING";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Site Settings</h1>
        <p className="text-muted-foreground">
          Configure organization-wide branding, security, appearance, and operational settings.
        </p>
      </div>

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="general"><Globe className="mr-2 h-4 w-4" />General</TabsTrigger>
          <TabsTrigger value="branding"><ImageUp className="mr-2 h-4 w-4" />Branding</TabsTrigger>
          <TabsTrigger value="security"><Lock className="mr-2 h-4 w-4" />Security</TabsTrigger>
          <TabsTrigger value="appearance"><Palette className="mr-2 h-4 w-4" />Appearance</TabsTrigger>
          <TabsTrigger value="default-media"><Shield className="mr-2 h-4 w-4" />Default Media</TabsTrigger>
          <TabsTrigger value="advanced"><Database className="mr-2 h-4 w-4" />Advanced</TabsTrigger>
          <TabsTrigger value="roles"><Users className="mr-2 h-4 w-4" />Roles</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>General</CardTitle>
              <CardDescription>Default locale and organization details for the CMS.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="company-name">Company name</Label>
                <Input
                  id="company-name"
                  value={general.company_name}
                  onChange={(event) => setGeneral((current) => ({ ...current, company_name: event.target.value }))}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Input
                    id="timezone"
                    value={general.timezone}
                    onChange={(event) => setGeneral((current) => ({ ...current, timezone: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="language">Language</Label>
                  <Input
                    id="language"
                    value={general.language}
                    onChange={(event) => setGeneral((current) => ({ ...current, language: event.target.value }))}
                  />
                </div>
              </div>
              <Button onClick={() => updateGeneral.mutate(general)} disabled={updateGeneral.isPending}>
                <Save className="mr-2 h-4 w-4" />
                Save General
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="branding" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Branding</CardTitle>
              <CardDescription>
                Manage the app name, logo, icon, and favicon used throughout the CMS.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!canEditBranding ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Branding is restricted. By default only Super Admin can edit it unless the role is explicitly granted
                  the branding permission.
                </div>
              ) : null}
              <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="app-name">Application name</Label>
                    <Input
                      id="app-name"
                      value={branding.app_name}
                      disabled={!canEditBranding}
                      onChange={(event) => setBranding((current) => ({ ...current, app_name: event.target.value }))}
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    {BRANDING_FIELDS.map((field) => (
                      <BrandingAssetField
                        key={field.key}
                        label={field.label}
                        hint={field.hint}
                        mediaId={branding[field.key]}
                        mediaUrl={branding[field.key === "logo_media_id" ? "logo_url" : field.key === "icon_media_id" ? "icon_url" : "favicon_url"]}
                        onChange={(nextId, nextUrl) => handleBrandingAssetChange(field.key, nextId, nextUrl)}
                      />
                    ))}
                  </div>

                  <Button
                    onClick={() =>
                      updateBranding.mutate({
                        app_name: branding.app_name,
                        logo_media_id: branding.logo_media_id,
                        icon_media_id: branding.icon_media_id,
                        favicon_media_id: branding.favicon_media_id,
                      })
                    }
                    disabled={!canEditBranding || updateBranding.isPending}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Save Branding
                  </Button>
                </div>

                <Card className="bg-muted/20">
                  <CardHeader>
                    <CardTitle className="text-base">Preview</CardTitle>
                    <CardDescription>How the CMS identity will appear in the shell.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-xl border bg-card p-4 flex items-center gap-3">
                      <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center overflow-hidden">
                        {branding.logo_url ? (
                          <img src={branding.logo_url} alt={brandingPreviewName} className="h-full w-full object-contain" />
                        ) : (
                          <ImageUp className="h-5 w-5 text-primary" />
                        )}
                      </div>
                      <div>
                        <p className="font-semibold">{brandingPreviewName}</p>
                        <p className="text-sm text-muted-foreground">CMS identity preview</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {branding.icon_media_id ? <Badge>Icon ready</Badge> : null}
                      {branding.favicon_media_id ? <Badge variant="outline">Favicon ready</Badge> : null}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Security</CardTitle>
              <CardDescription>Working session timeout and password requirement controls.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="session-timeout">Idle session timeout (minutes)</Label>
                <Input
                  id="session-timeout"
                  type="number"
                  min={5}
                  max={1440}
                  value={security.idle_timeout_minutes}
                  onChange={(event) =>
                    setSecurity((current) => ({
                      ...current,
                      idle_timeout_minutes: Number(event.target.value || 30),
                    }))
                  }
                />
              </div>

              <Separator />

              <div className="space-y-4">
                <div>
                  <h3 className="font-medium">Password requirements</h3>
                  <p className="text-sm text-muted-foreground">
                    New passwords must be at least {security.password_policy.min_length} characters and include {passwordRequirementSummary || "no extra character classes"}.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="min-length">Minimum length</Label>
                    <Input
                      id="min-length"
                      type="number"
                      min={8}
                      max={128}
                      value={security.password_policy.min_length}
                      onChange={(event) =>
                        setSecurity((current) => ({
                          ...current,
                          password_policy: {
                            ...current.password_policy,
                            min_length: Number(event.target.value || 12),
                          },
                        }))
                      }
                    />
                  </div>
                  {[
                    ["require_uppercase", "Require uppercase"],
                    ["require_lowercase", "Require lowercase"],
                    ["require_number", "Require number"],
                    ["require_special", "Require special character"],
                  ].map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between rounded-lg border p-3">
                      <span className="text-sm">{label}</span>
                      <Switch
                        checked={security.password_policy[key as keyof typeof security.password_policy] as boolean}
                        onCheckedChange={(checked) =>
                          setSecurity((current) => ({
                            ...current,
                            password_policy: {
                              ...current.password_policy,
                              [key]: checked,
                            },
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>

              <Button onClick={() => updateSecurity.mutate(security)} disabled={updateSecurity.isPending}>
                <Save className="mr-2 h-4 w-4" />
                Save Security
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appearance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Theme, accent, and sidebar behavior for the entire CMS.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Theme mode</Label>
                  <Select
                    value={appearance.theme_mode}
                    onValueChange={(value: "light" | "dark" | "system") =>
                      setAppearance((current) => ({ ...current, theme_mode: value }))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="dark">Dark</SelectItem>
                      <SelectItem value="system">System</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Accent preset</Label>
                  <Select
                    value={appearance.accent_preset}
                    onValueChange={(value: typeof appearance.accent_preset) =>
                      setAppearance((current) => ({ ...current, accent_preset: value }))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {accentPresets.map((preset) => (
                        <SelectItem key={preset.value} value={preset.value}>
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Sidebar mode</Label>
                  <Select
                    value={appearance.sidebar_mode}
                    onValueChange={(value: typeof appearance.sidebar_mode) =>
                      setAppearance((current) => ({ ...current, sidebar_mode: value }))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {sidebarModes.map((mode) => (
                        <SelectItem key={mode.value} value={mode.value}>
                          {mode.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={() => updateAppearance.mutate(appearance)} disabled={updateAppearance.isPending}>
                <Save className="mr-2 h-4 w-4" />
                Save Appearance
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="default-media" className="space-y-4">
          <DefaultMediaSection />
        </TabsContent>

        <TabsContent value="advanced" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Backups</CardTitle>
              <CardDescription>Automatic full backups for PostgreSQL and MinIO archives.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-4 py-3 text-sm">
                <Badge variant={automaticBackupsEnabled ? "default" : "outline"}>
                  {automaticBackupsEnabled ? "Automatic backups on" : "Automatic backups off"}
                </Badge>
                <span className="text-muted-foreground">
                  {automaticBackupsEnabled
                    ? `Recurring backups are enabled for this installation and will be checked every ${backups.interval_hours} hour${backups.interval_hours === 1 ? "" : "s"}.`
                    : "Automatic backups stay off until you enable them and save this section."}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium">Automatic backups</p>
                  <p className="text-sm text-muted-foreground">Run recurring full backups into the archives bucket.</p>
                </div>
                <Switch
                  checked={backups.automatic_enabled}
                  onCheckedChange={(checked) => setBackups((current) => ({ ...current, automatic_enabled: checked }))}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="backup-interval">Backup interval (hours)</Label>
                  <Input
                    id="backup-interval"
                    type="number"
                    min={1}
                    max={168}
                    value={backups.interval_hours}
                    onChange={(event) =>
                      setBackups((current) => ({ ...current, interval_hours: Number(event.target.value || 24) }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Log level</Label>
                  <Select
                    value={backups.log_level}
                    onValueChange={(value: typeof backups.log_level) =>
                      setBackups((current) => ({ ...current, log_level: value }))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["trace", "debug", "info", "warn", "error", "fatal"].map((level) => (
                        <SelectItem key={level} value={level}>
                          {level.toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => updateBackups.mutate(backups)} disabled={updateBackups.isPending}>
                  <Save className="mr-2 h-4 w-4" />
                  Save Advanced
                </Button>
                <Button variant="outline" onClick={() => runBackupNow.mutate()} disabled={runBackupNow.isPending}>
                  <Database className="mr-2 h-4 w-4" />
                  {runBackupNow.isPending ? "Queueing..." : "Run Backup Now"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Backup history</CardTitle>
              <CardDescription>Recent manual and automatic backup runs.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {backupRuns.map((run) => (
                <div key={run.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{run.trigger_type}</Badge>
                      <Badge>{run.status}</Badge>
                      <span className="text-sm text-muted-foreground">{new Date(run.created_at).toLocaleString()}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {run.downloads.map((download) => (
                        <Button key={download.object_key} asChild size="sm" variant="ghost">
                          <a href={download.url} target="_blank" rel="noreferrer">{download.name}</a>
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={!canDeleteBackup(run) || deleteBackupRun.isPending}
                        onClick={() => setBackupPendingDelete(run)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                  {run.error_message ? (
                    <p className="mt-2 text-sm text-destructive">{formatBackupError(run.error_message)}</p>
                  ) : null}
                </div>
              ))}
              {backupRuns.length === 0 ? <p className="text-sm text-muted-foreground">No backup history yet.</p> : null}
            </CardContent>
          </Card>

          <ConfirmDialog
            open={Boolean(backupPendingDelete)}
            title="Delete backup"
            description={
              backupPendingDelete
                ? "This will permanently remove the backup archives from storage and delete the history entry. This action cannot be undone."
                : undefined
            }
            confirmLabel="Delete backup"
            isLoading={deleteBackupRun.isPending}
            confirmDisabled={!backupPendingDelete || !canDeleteBackup(backupPendingDelete)}
            onCancel={() => {
              if (deleteBackupRun.isPending) return;
              setBackupPendingDelete(null);
            }}
            onConfirm={() => {
              if (!backupPendingDelete) return;
              deleteBackupRun.mutate(backupPendingDelete.id, {
                onSuccess: () => {
                  setBackupPendingDelete(null);
                },
              });
            }}
          />

          <Card>
            <CardHeader>
              <CardTitle>Recent logs</CardTitle>
              <CardDescription>Recent backend application logs filtered by runtime log level.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-muted-foreground" />
                  <Label>Log filter</Label>
                </div>
                <Select value={logLevelFilter} onValueChange={setLogLevelFilter}>
                  <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All levels</SelectItem>
                    {["trace", "debug", "info", "warn", "error", "fatal"].map((level) => (
                      <SelectItem key={level} value={level}>{level.toUpperCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-lg border bg-black text-slate-100 p-4 max-h-[420px] overflow-auto space-y-3">
                {recentLogs.map((log) => (
                  <div key={log.id} className="text-xs font-mono">
                    <div className="flex flex-wrap items-center gap-2 text-slate-400">
                      <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                      <Badge variant="outline" className="border-slate-600 text-slate-200">{log.level}</Badge>
                      <span>{log.logger}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-50">{log.message}</p>
                  </div>
                ))}
                {recentLogs.length === 0 ? <p className="text-sm text-slate-400">No logs available.</p> : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles" className="space-y-4">
          <RolesPermissionsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Settings;
