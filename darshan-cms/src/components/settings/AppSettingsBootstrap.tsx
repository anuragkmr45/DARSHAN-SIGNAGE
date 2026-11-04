import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useAppearanceSettings, useBrandingSettings } from "@/hooks/useSettingsApi";
import { useSiteAppearance } from "@/components/appearance/SiteAppearanceProvider";

export function AppSettingsBootstrap() {
  const { data: branding } = useBrandingSettings();
  const { data: appearance } = useAppearanceSettings();
  const { setTheme } = useTheme();
  const { updateAppearance } = useSiteAppearance();

  useEffect(() => {
    if (!branding) return;
    updateAppearance({
      appName: branding.app_name,
      logoUrl: branding.logo_url,
      iconUrl: branding.icon_url,
      faviconUrl: branding.favicon_url,
    });
  }, [branding, updateAppearance]);

  useEffect(() => {
    if (!appearance) return;
    if (appearance.theme_mode) {
      setTheme(appearance.theme_mode);
    }
    updateAppearance({ themeMode: appearance.theme_mode, accentPreset: appearance.accent_preset });
    const root = document.documentElement;
    if (appearance.sidebar_mode) {
      root.dataset.sidebarMode = appearance.sidebar_mode;
    }
  }, [appearance, setTheme, updateAppearance]);

  return null;
}
