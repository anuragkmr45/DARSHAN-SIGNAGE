import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useAppearanceSettings, useBrandingSettings } from "@/hooks/useSettingsApi";

const ACCENT_PRESETS: Record<
  "crimson" | "blue" | "emerald" | "amber" | "slate",
  Record<string, string>
> = {
  crimson: {
    "--primary": "356 72% 28%",
    "--primary-foreground": "0 0% 100%",
    "--accent": "356 45% 92%",
    "--accent-foreground": "356 72% 28%",
    "--ring": "356 72% 45%",
    "--sidebar-primary": "0 34% 75%",
    "--sidebar-accent": "356 60% 28%",
  },
  blue: {
    "--primary": "217 91% 46%",
    "--primary-foreground": "0 0% 100%",
    "--accent": "214 95% 93%",
    "--accent-foreground": "217 91% 32%",
    "--ring": "217 91% 52%",
    "--sidebar-primary": "214 90% 74%",
    "--sidebar-accent": "217 72% 34%",
  },
  emerald: {
    "--primary": "160 84% 30%",
    "--primary-foreground": "0 0% 100%",
    "--accent": "151 55% 92%",
    "--accent-foreground": "160 84% 22%",
    "--ring": "160 70% 42%",
    "--sidebar-primary": "155 70% 78%",
    "--sidebar-accent": "160 65% 28%",
  },
  amber: {
    "--primary": "32 95% 44%",
    "--primary-foreground": "0 0% 100%",
    "--accent": "42 100% 92%",
    "--accent-foreground": "28 86% 28%",
    "--ring": "32 95% 48%",
    "--sidebar-primary": "42 88% 78%",
    "--sidebar-accent": "28 74% 34%",
  },
  slate: {
    "--primary": "215 19% 35%",
    "--primary-foreground": "0 0% 100%",
    "--accent": "210 22% 92%",
    "--accent-foreground": "215 19% 28%",
    "--ring": "215 19% 42%",
    "--sidebar-primary": "214 20% 74%",
    "--sidebar-accent": "215 24% 30%",
  },
};

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
    setTheme(appearance.theme_mode);
    const root = document.documentElement;
    const preset = ACCENT_PRESETS[appearance.accent_preset];
    Object.entries(preset).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
    root.dataset.sidebarMode = appearance.sidebar_mode;
  }, [appearance, setTheme]);

  return null;
}
