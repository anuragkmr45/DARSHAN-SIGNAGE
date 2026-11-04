import { getCmsApiBaseUrl } from "./runtimeConfig";

export const SITE_THEME_STORAGE_KEY = "darshan-site-theme";

export const accentPresets = ["crimson", "blue", "emerald", "amber", "slate"] as const;
export type SiteAccent = (typeof accentPresets)[number];
export type SiteTheme = "light" | "dark" | "system";

export type PublicAppearance = {
  appName: string;
  logoUrl: string | null;
  iconUrl: string | null;
  faviconUrl: string | null;
  themeMode: SiteTheme;
  accentPreset: SiteAccent;
};

export const DEFAULT_PUBLIC_APPEARANCE: PublicAppearance = {
  appName: "DARSHAN CMS",
  logoUrl: null,
  iconUrl: null,
  faviconUrl: null,
  themeMode: "light",
  accentPreset: "emerald",
};

const safeImageUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  if (/^\/(?!\/)/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) return null;
    if (typeof window !== "undefined" && window.location.protocol === "https:" && url.protocol !== "https:") return null;
    return value;
  } catch {
    return null;
  }
};

export const parsePublicAppearance = (value: unknown): PublicAppearance => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_PUBLIC_APPEARANCE;
  const data = value as Record<string, unknown>;
  const themeMode = data.theme_mode;
  const accentPreset = data.accent_preset;
  return {
    appName: typeof data.app_name === "string" && data.app_name.trim()
      ? data.app_name.trim().slice(0, 255)
      : DEFAULT_PUBLIC_APPEARANCE.appName,
    logoUrl: safeImageUrl(data.logo_url),
    iconUrl: safeImageUrl(data.icon_url),
    faviconUrl: safeImageUrl(data.favicon_url),
    themeMode: themeMode === "dark" || themeMode === "system" ? themeMode : "light",
    accentPreset: accentPresets.includes(accentPreset as SiteAccent)
      ? accentPreset as SiteAccent
      : DEFAULT_PUBLIC_APPEARANCE.accentPreset,
  };
};

export const loadPublicAppearance = async (
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2_000,
): Promise<PublicAppearance> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${getCmsApiBaseUrl()}/settings/public-appearance`, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return DEFAULT_PUBLIC_APPEARANCE;
    return parsePublicAppearance(await response.json());
  } catch {
    return DEFAULT_PUBLIC_APPEARANCE;
  } finally {
    clearTimeout(timeout);
  }
};

export const applyInitialPublicAppearance = (appearance: PublicAppearance) => {
  const root = document.documentElement;
  root.dataset.accent = appearance.accentPreset;
  const dark = appearance.themeMode === "dark" || (
    appearance.themeMode === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  try {
    window.localStorage.setItem(SITE_THEME_STORAGE_KEY, appearance.themeMode);
  } catch {
    // Hardened browsers may disable local storage. The root theme is still set.
  }
};
