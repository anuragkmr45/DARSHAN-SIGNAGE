import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { SITE_THEME_STORAGE_KEY } from "@/config/publicAppearance";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="light" storageKey={SITE_THEME_STORAGE_KEY} enableSystem>
      {children}
    </NextThemesProvider>
  );
}
