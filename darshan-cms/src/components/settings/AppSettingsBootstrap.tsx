import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useAppearanceSettings, useBrandingSettings } from "@/hooks/useSettingsApi";
import { useSiteAppearance } from "@/components/appearance/SiteAppearanceProvider";
import { accentPresets, parsePublicAppearance, type PublicAppearance } from "@/config/publicAppearance";

export function AppSettingsBootstrap() {
  const { data: branding } = useBrandingSettings();
  const { data: appearance } = useAppearanceSettings();
  const { setTheme } = useTheme();
  const { updateAppearance } = useSiteAppearance();

  useEffect(() => {
    if (!branding) return;
    const changes: Partial<PublicAppearance> = {};
    const safe = parsePublicAppearance({
      app_name: branding.app_name,
      logo_url: branding.logo_url,
      icon_url: branding.icon_url,
      favicon_url: branding.favicon_url,
    });
    if (typeof branding.app_name === "string" && branding.app_name.trim()) changes.appName = safe.appName;
    if (branding.logo_url === null || (typeof branding.logo_url === "string" && safe.logoUrl)) changes.logoUrl = safe.logoUrl;
    if (branding.icon_url === null || (typeof branding.icon_url === "string" && safe.iconUrl)) changes.iconUrl = safe.iconUrl;
    if (branding.favicon_url === null || (typeof branding.favicon_url === "string" && safe.faviconUrl)) changes.faviconUrl = safe.faviconUrl;
    if (Object.keys(changes).length) updateAppearance(changes);
  }, [branding, updateAppearance]);

  useEffect(() => {
    if (!appearance) return;
    const changes: Partial<PublicAppearance> = {};
    if (appearance.theme_mode === "light" || appearance.theme_mode === "dark" || appearance.theme_mode === "system") {
      setTheme(appearance.theme_mode);
      changes.themeMode = appearance.theme_mode;
    }
    if (accentPresets.includes(appearance.accent_preset)) {
      changes.accentPreset = appearance.accent_preset;
    }
    if (Object.keys(changes).length) updateAppearance(changes);
    if (appearance.sidebar_mode === "expanded" || appearance.sidebar_mode === "collapsed" || appearance.sidebar_mode === "auto") {
      document.documentElement.dataset.sidebarMode = appearance.sidebar_mode;
    }
  }, [appearance, setTheme, updateAppearance]);

  return null;
}
