import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useAppearanceSettings, useBrandingSettings } from "@/hooks/useSettingsApi";

const accentPresets = ["crimson", "blue", "emerald", "amber", "slate"] as const;

export function AppSettingsBootstrap() {
  const { data: branding } = useBrandingSettings();
  const { data: appearance } = useAppearanceSettings();
  const { setTheme } = useTheme();

  useEffect(() => {
    if (!branding?.app_name) return;
    document.title = branding.app_name;
    document
      .querySelector('meta[name="author"]')
      ?.setAttribute("content", branding.app_name);
  }, [branding?.app_name]);

  useEffect(() => {
    const faviconHref = branding?.favicon_url || branding?.icon_url || null;
    if (!faviconHref) return;

    let link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = faviconHref;
  }, [branding?.favicon_url, branding?.icon_url]);

  useEffect(() => {
    if (!appearance) return;
    if (appearance.theme_mode) {
      setTheme(appearance.theme_mode);
    }
    const root = document.documentElement;
    // Appearance is operational configuration and can be absent or partial
    // during an upgrade. It must never blank the authenticated application.
    root.dataset.accent = accentPresets.includes(appearance.accent_preset)
      ? appearance.accent_preset
      : "crimson";
    if (appearance.sidebar_mode) {
      root.dataset.sidebarMode = appearance.sidebar_mode;
    }
  }, [appearance, setTheme]);

  return null;
}
