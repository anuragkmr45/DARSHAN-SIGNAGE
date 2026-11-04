import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_PUBLIC_APPEARANCE,
  type PublicAppearance,
} from "@/config/publicAppearance";

type SiteAppearanceContextValue = {
  appearance: PublicAppearance;
  updateAppearance: (partial: Partial<PublicAppearance>) => void;
};

const SiteAppearanceContext = createContext<SiteAppearanceContextValue>({
  appearance: DEFAULT_PUBLIC_APPEARANCE,
  updateAppearance: () => undefined,
});

export function SiteAppearanceProvider({
  initialAppearance,
  children,
}: {
  initialAppearance: PublicAppearance;
  children: ReactNode;
}) {
  const [appearance, setAppearance] = useState(initialAppearance);
  const updateAppearance = useCallback((partial: Partial<PublicAppearance>) => {
    setAppearance((current) => {
      const changed = Object.entries(partial).some(([key, value]) =>
        current[key as keyof PublicAppearance] !== value
      );
      return changed ? { ...current, ...partial } : current;
    });
  }, []);
  const value = useMemo<SiteAppearanceContextValue>(() => ({
    appearance,
    updateAppearance,
  }), [appearance, updateAppearance]);

  useEffect(() => {
    document.title = appearance.appName;
    document.querySelector('meta[name="author"]')?.setAttribute("content", appearance.appName);
    document.documentElement.dataset.accent = appearance.accentPreset;
    let link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = appearance.faviconUrl || appearance.iconUrl || "/darshan-mark.svg";
  }, [appearance]);

  return <SiteAppearanceContext.Provider value={value}>{children}</SiteAppearanceContext.Provider>;
}

// The context hook intentionally shares this small provider module.
// eslint-disable-next-line react-refresh/only-export-components
export const useSiteAppearance = () => useContext(SiteAppearanceContext);
