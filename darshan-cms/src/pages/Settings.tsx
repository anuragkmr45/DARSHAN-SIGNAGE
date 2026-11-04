import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
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
import type { BackupRun, BackupSettings, MediaAsset } from "@/api/types";
import { uploadMediaWithPresign, validateUploadFile, resolveUploadContentType, getFriendlyUploadError } from "@/lib/mediaUploadFlow";
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
  { value: "emerald", label: "Forest" },
  { value: "amber", label: "Amber" },
  { value: "slate", label: "Slate" },
] as const;

function formatBackupError(message: string | null | undefined) {
  if (!message) return null;
  return message.replace(/\s+/g, " ").trim();
}

function SettingsQueryGuard({
  query,
  children,
}: {
  query: { isPending: boolean; isError: boolean; refetch: () => Promise<unknown> };
  children: ReactNode;
}) {
  if (query.isPending) return <p className="py-8 text-sm text-muted-foreground">Loading settings…</p>;
  if (query.isError) {
    return <div className="space-y-3 py-8">
      <p className="text-sm text-destructive">Could not load these settings. No changes have been made.</p>
      <Button variant="outline" onClick={() => void query.refetch()}>Retry</Button>
    </div>;
  }
  return <>{children}</>;
}

function BrandingAssetField({
  label,
  hint,
  mediaId,
  mediaUrl,
  canChoose,
  canUpload,
  onChange,
}: {
  label: string;
  hint: string;
  mediaId: string | null;
  mediaUrl: string | null;
  canChoose: boolean;
  canUpload: boolean;
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
    if (!file || !canUpload) return;

    const contentType = resolveUploadContentType(file);
    const validationError = validateUploadFile(file) || (!contentType?.startsWith("image/") ? "Branding assets must be JPEG, PNG, or WEBP images." : null);
    if (validationError) {
      toast({ title: "Upload failed", description: validationError, variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const result = await uploadMediaWithPresign(file, { displayName: `${label} ${file.name}` });
      if (result.media.status !== "READY" || result.media.type !== "IMAGE") {
        toast({ title: "Image is processing", description: "Choose the image from the library once it is ready." });
        return;
      }
      onChange(result.media.id, result.media.media_url ?? result.media.fallback_media_url ?? null);
      toast({ title: `${label} selected`, description: "Save Branding to apply it." });
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
    <div className="border-b py-4 last:border-b-0">
      <div className="mb-3">
        <p className="font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 shrink-0 rounded-lg border bg-muted/30 flex items-center justify-center overflow-hidden">
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
          <div className="min-w-0 space-y-2">
            <div className="text-sm text-muted-foreground">
              {mediaId ? "Assigned from media library" : "No media assigned"}
            </div>
            <div className="flex flex-wrap gap-2">
              {canChoose ? <Button variant="outline" onClick={() => setPickerOpen(true)}>
                <Brush className="mr-2 h-4 w-4" />
                Choose existing
              </Button> : null}
              {canUpload ? <Label className="inline-flex">
                <Input
                  type="file"
                  className="hidden"
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  onChange={(event) => {
                    void handleUpload(event.target.files);
                    event.target.value = "";
                  }}
                  disabled={uploading}
                />
                <Button type="button" variant="outline" disabled={uploading} asChild>
                  <span>
                    <Upload className="mr-2 h-4 w-4" />
                    {uploading ? "Uploading..." : "Upload new"}
                  </span>
                </Button>
              </Label> : null}
              {mediaId && (canChoose || canUpload) ? (
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
              {mediaQuery.isPending ? <p className="text-sm text-muted-foreground">Loading ready images…</p> : null}
              {mediaQuery.isError ? <div className="space-y-2"><p className="text-sm text-destructive">Could not load images.</p><Button variant="outline" onClick={() => void mediaQuery.refetch()}>Retry</Button></div> : null}
              {mediaQuery.isSuccess && mediaItems.length === 0 ? <p className="text-sm text-muted-foreground">No ready images in the media library.</p> : null}
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
      </div>
    </div>
  );
}

const Settings = () => {
  const { toast } = useToast();
  const { can, role } = useAuthorization();
  const currentUser = useAppSelector((state) => state.auth.user);
  const canEditBranding = canManageBrandingSettings(currentUser ?? undefined, role, can);
  const canReadBranding = can("read", "BrandingSettings");
  const canReadRoles = can("read", "Role");
  const canEditOrg = can("update", "OrgSettings");
  const canChooseBrandingMedia = canEditBranding && can("read", "Media");
  const canUploadBrandingMedia = canEditBranding && can("create", "Media");

  const generalQuery = useGeneralSettings();
  const brandingQuery = useBrandingSettings();
  const securityQuery = useSecuritySettings();
  const appearanceQuery = useAppearanceSettings();
  const backupSettingsQuery = useBackupSettings();
  const externalBackupSidecar = backupSettingsQuery.data?.external_sidecar === true;
  const backupRunsQuery = useBackupRuns(backupSettingsQuery.isSuccess && !externalBackupSidecar);
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
    accent_preset: "emerald" as const,
    sidebar_mode: "expanded" as const,
  });
  const [backups, setBackups] = useState<BackupSettings>({
    automatic_enabled: false,
    interval_hours: 24,
    log_level: "info" as const,
  });
  const [backupPendingDelete, setBackupPendingDelete] = useState<BackupRun | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const mobileBackRef = useRef<HTMLButtonElement | null>(null);
  const mobileCategoryRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const categories = [
    { value: "general", label: "General", detail: "Organization name, language, and time", icon: Globe },
    ...(canReadBranding ? [{ value: "branding", label: "Branding", detail: "Name, logo, and app icons", icon: ImageUp }] : []),
    { value: "security", label: "Security", detail: "Sessions and password rules", icon: Lock },
    { value: "appearance", label: "Appearance", detail: "Theme, accent, and sidebar", icon: Palette },
    { value: "default-media", label: "Default Media", detail: "Content when no schedule is active", icon: Shield },
    { value: "advanced", label: "Advanced", detail: "Backups and diagnostic logs", icon: Database },
    ...(canReadRoles ? [{ value: "roles", label: "Roles", detail: "Access and permissions", icon: Users }] : []),
  ];
  const visibleCategory = categories.some((category) => category.value === activeCategory) ? activeCategory : null;

  useEffect(() => {
    if (activeCategory === "branding" && !canReadBranding) setActiveCategory(null);
    if (activeCategory === "roles" && !canReadRoles) setActiveCategory(null);
  }, [activeCategory, canReadBranding, canReadRoles]);

  const openMobileCategory = (value: string) => {
    setActiveCategory(value);
    requestAnimationFrame(() => mobileBackRef.current?.focus());
  };

  const returnToMobileCategories = () => {
    const previous = activeCategory;
    setActiveCategory(null);
    requestAnimationFrame(() => {
      if (previous) mobileCategoryRefs.current[previous]?.focus();
    });
  };

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
  const backupScheduleManaged = backups.schedule_managed_by_deployment === true;

  const brandingPreviewName = branding.app_name.trim() || "DARSHAN CMS";

  const handleBrandingAssetChange = (
    key: "logo_media_id" | "icon_media_id" | "favicon_media_id",
    nextId: string | null,
    nextUrl?: string | null,
  ) => {
    const urlKey = key === "logo_media_id" ? "logo_url" : key === "icon_media_id" ? "icon_url" : "favicon_url";
    setBranding((current) => ({
      ...current,
      [key]: nextId,
      [urlKey]: nextUrl === undefined ? current[urlKey] : nextUrl,
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

      <Tabs value={visibleCategory ?? "general"} onValueChange={setActiveCategory}
        className="min-w-0 sm:grid sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start sm:gap-6">
        <nav aria-label="Settings categories" className={visibleCategory ? "hidden sm:block" : "block"}>
          <div className="divide-y divide-border rounded-xl border border-border bg-card sm:hidden">
            {categories.map(({ value, label, detail, icon: Icon }) => (
              <button key={value} ref={(element) => { mobileCategoryRefs.current[value] = element; }}
                type="button" onClick={() => openMobileCategory(value)}
                className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted-foreground">{detail}</span></span>
                <span aria-hidden="true" className="text-muted-foreground">›</span>
              </button>
            ))}
          </div>
          <TabsList className="hidden h-auto w-full flex-col items-stretch justify-start gap-1 bg-transparent p-0 sm:flex">
            {categories.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value}
                className="min-h-10 w-full justify-start gap-2 whitespace-normal rounded-lg px-3 text-left data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none">
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />{label}
              </TabsTrigger>
            ))}
          </TabsList>
        </nav>
        <div className={`min-w-0 ${visibleCategory ? "block" : "hidden sm:block"}`}>
          <Button ref={mobileBackRef} type="button" variant="ghost" onClick={returnToMobileCategories}
            className="mb-3 -ml-2 sm:hidden" aria-label="Back to all settings">
            <ArrowLeft aria-hidden="true" className="mr-2 h-4 w-4" />All settings
          </Button>

        <TabsContent value="general" className="space-y-4">
          <SettingsQueryGuard query={generalQuery}>
          <Card>
            <CardHeader>
              <CardTitle>General</CardTitle>
              <CardDescription>Default locale and organization details for the CMS.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!canEditOrg ? <p className="text-sm text-muted-foreground">You can view these settings. Editing requires Manage Site Settings.</p> : null}
              <div className="space-y-2">
                <Label htmlFor="company-name">Company name</Label>
                <Input
                  id="company-name"
                  value={general.company_name}
                  disabled={!canEditOrg}
                  onChange={(event) => setGeneral((current) => ({ ...current, company_name: event.target.value }))}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Input
                    id="timezone"
                    value={general.timezone}
                    disabled={!canEditOrg}
                    onChange={(event) => setGeneral((current) => ({ ...current, timezone: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="language">Language</Label>
                  <Input
                    id="language"
                    value={general.language}
                    disabled={!canEditOrg}
                    onChange={(event) => setGeneral((current) => ({ ...current, language: event.target.value }))}
                  />
                </div>
              </div>
              <Button onClick={() => updateGeneral.mutate(general)} disabled={!canEditOrg || updateGeneral.isPending}>
                <Save className="mr-2 h-4 w-4" />
                Save General
              </Button>
            </CardContent>
          </Card>
          </SettingsQueryGuard>
        </TabsContent>

        <TabsContent value="branding" className="space-y-4">
          <SettingsQueryGuard query={brandingQuery}>
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
                  You can view branding. Editing requires Manage Branding permission.
                </div>
              ) : null}
              {canEditBranding && !canChooseBrandingMedia && !canUploadBrandingMedia ? (
                <p className="text-sm text-muted-foreground">Media library access is required to choose or upload an image.</p>
              ) : null}
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
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

                  <div>
                    {BRANDING_FIELDS.map((field) => (
                      <BrandingAssetField
                        key={field.key}
                        label={field.label}
                        hint={field.hint}
                        mediaId={branding[field.key]}
                        mediaUrl={branding[field.key === "logo_media_id" ? "logo_url" : field.key === "icon_media_id" ? "icon_url" : "favicon_url"]}
                        canChoose={canChooseBrandingMedia}
                        canUpload={canUploadBrandingMedia}
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

                <Card className="self-start bg-muted/20">
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
          </SettingsQueryGuard>
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <SettingsQueryGuard query={securityQuery}>
          <Card>
            <CardHeader>
              <CardTitle>Security</CardTitle>
              <CardDescription>Working session timeout and password requirement controls.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {!canEditOrg ? <p className="text-sm text-muted-foreground">You can view these settings. Editing requires Manage Site Settings.</p> : null}
              <div className="space-y-2">
                <Label htmlFor="session-timeout">Idle session timeout (minutes)</Label>
                <Input
                  id="session-timeout"
                  type="number"
                  min={5}
                  max={1440}
                  value={security.idle_timeout_minutes}
                  disabled={!canEditOrg}
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
                      disabled={!canEditOrg}
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
                        disabled={!canEditOrg}
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

              <Button onClick={() => updateSecurity.mutate(security)} disabled={!canEditOrg || updateSecurity.isPending}>
                <Save className="mr-2 h-4 w-4" />
                Save Security
              </Button>
            </CardContent>
          </Card>
          </SettingsQueryGuard>
        </TabsContent>

        <TabsContent value="appearance" className="space-y-4">
          <SettingsQueryGuard query={appearanceQuery}>
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Theme, accent, and sidebar behavior for the entire CMS.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!canEditOrg ? <p className="text-sm text-muted-foreground">You can view these settings. Editing requires Manage Site Settings.</p> : null}
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Theme mode</Label>
                  <Select
                    value={appearance.theme_mode}
                    disabled={!canEditOrg}
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
                    disabled={!canEditOrg}
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
                    disabled={!canEditOrg}
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
              <Button onClick={() => updateAppearance.mutate(appearance)} disabled={!canEditOrg || updateAppearance.isPending}>
                <Save className="mr-2 h-4 w-4" />
                Save Appearance
              </Button>
            </CardContent>
          </Card>
          </SettingsQueryGuard>
        </TabsContent>

        <TabsContent value="default-media" className="space-y-4">
          <DefaultMediaSection />
        </TabsContent>

        <TabsContent value="advanced" className="space-y-4">
          <SettingsQueryGuard query={backupSettingsQuery}>
          <Card>
            <CardHeader>
              <CardTitle>Backups</CardTitle>
              <CardDescription>Automatic full backups for PostgreSQL and MinIO archives.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!canEditOrg ? <p className="text-sm text-muted-foreground">You can view backup settings. Editing requires Manage Site Settings.</p> : null}
              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-4 py-3 text-sm">
                <Badge variant={automaticBackupsEnabled ? "default" : "outline"}>
                  {automaticBackupsEnabled ? "Automatic backups on" : "Automatic backups off"}
                </Badge>
                <span className="text-muted-foreground">
                  {externalBackupSidecar
                    ? `The data-stack sidecar runs daily at ${backups.schedule_time ?? "00:00"} ${backups.schedule_timezone ?? "Asia/Kolkata"} and keeps the latest three successful sets.`
                    : automaticBackupsEnabled
                    ? `Recurring backups are enabled for this installation and will be checked every ${backups.interval_hours} hour${backups.interval_hours === 1 ? "" : "s"}.`
                    : "Automatic backups stay off until you enable them and save this section."}
                  {backups.off_host_copy_required && ` Production policy requires an independently operated off-host copy${backups.retention_days ? ` retained for ${backups.retention_days} days` : ""}.`}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium">Automatic backups</p>
                  <p className="text-sm text-muted-foreground">
                    {backupScheduleManaged
                      ? "This production cadence is locked by the signed deployment policy."
                      : "Run recurring full backups into the archives bucket."}
                  </p>
                </div>
                <Switch
                  checked={backups.automatic_enabled}
                  onCheckedChange={(checked) => setBackups((current) => ({ ...current, automatic_enabled: checked }))}
                  disabled={!canEditOrg || backupScheduleManaged}
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
                    disabled={!canEditOrg || backupScheduleManaged}
                    onChange={(event) =>
                      setBackups((current) => ({ ...current, interval_hours: Number(event.target.value || 24) }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Log level</Label>
                  <Select
                    value={backups.log_level}
                    disabled={!canEditOrg}
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
                <Button onClick={() => updateBackups.mutate(backups)} disabled={!canEditOrg || updateBackups.isPending}>
                  <Save className="mr-2 h-4 w-4" />
                  Save Advanced
                </Button>
                {canEditOrg && backups.manual_run_supported !== false ? (
                  <Button variant="outline" onClick={() => runBackupNow.mutate()} disabled={runBackupNow.isPending}>
                    <Database className="mr-2 h-4 w-4" />
                    {runBackupNow.isPending ? "Queueing..." : "Run Backup Now"}
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {!externalBackupSidecar ? <Card>
            <CardHeader>
              <CardTitle>Backup history</CardTitle>
              <CardDescription>Recent manual and automatic backup runs.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {backupRunsQuery.isPending ? <p className="text-sm text-muted-foreground">Loading backup history…</p> : null}
              {backupRunsQuery.isError ? <div className="space-y-2"><p className="text-sm text-destructive">Could not load backup history.</p><Button variant="outline" onClick={() => void backupRunsQuery.refetch()}>Retry</Button></div> : null}
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
                      {canEditOrg ? <Button
                        size="sm"
                        variant="destructive"
                        disabled={!canDeleteBackup(run) || deleteBackupRun.isPending}
                        onClick={() => setBackupPendingDelete(run)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button> : null}
                    </div>
                  </div>
                  {run.error_message ? (
                    <p className="mt-2 text-sm text-destructive">{formatBackupError(run.error_message)}</p>
                  ) : null}
                </div>
              ))}
              {backupRunsQuery.isSuccess && backupRuns.length === 0 ? <p className="text-sm text-muted-foreground">No backup history yet.</p> : null}
            </CardContent>
          </Card> : null}

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
          </SettingsQueryGuard>

          <Card>
            <CardHeader>
              <CardTitle>Recent logs</CardTitle>
              <CardDescription>Recent backend application logs filtered by runtime log level.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {recentLogsQuery.isPending ? <p className="text-sm text-muted-foreground">Loading recent logs…</p> : null}
              {recentLogsQuery.isError ? <div className="space-y-2"><p className="text-sm text-destructive">Could not load recent logs.</p><Button variant="outline" onClick={() => void recentLogsQuery.refetch()}>Retry</Button></div> : null}
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
              <div className="max-h-[420px] space-y-3 overflow-auto rounded-lg border border-border bg-card p-4">
                {recentLogs.map((log) => (
                  <div key={log.id} className="text-xs font-mono">
                    <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                      <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                      <Badge variant="outline" className="border-input text-foreground">{log.level}</Badge>
                      <span>{log.logger}</span>
                    </div>
                    <p className="mt-1 text-sm text-foreground">{log.message}</p>
                  </div>
                ))}
                {recentLogsQuery.isSuccess && recentLogs.length === 0 ? <p className="text-sm text-muted-foreground">No logs available.</p> : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles" className="space-y-4">
          <RolesPermissionsTab />
        </TabsContent>
        </div>
      </Tabs>
    </div>
  );
};

export default Settings;
