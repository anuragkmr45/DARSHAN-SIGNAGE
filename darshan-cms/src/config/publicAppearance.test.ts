import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PUBLIC_APPEARANCE,
  loadPublicAppearance,
  parsePublicAppearance,
} from "./publicAppearance";

describe("public site appearance", () => {
  it("uses Forest and light mode when the public response is unavailable or malformed", async () => {
    expect(parsePublicAppearance(null)).toEqual(DEFAULT_PUBLIC_APPEARANCE);
    expect(parsePublicAppearance({ accent_preset: "unknown", theme_mode: "invalid", app_name: " " })).toMatchObject({
      accentPreset: "emerald", themeMode: "light", appName: "DARSHAN CMS",
    });
    const unavailable = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    expect(await loadPublicAppearance(unavailable)).toEqual(DEFAULT_PUBLIC_APPEARANCE);
  });

  it("rejects credential-bearing and executable branding URLs", () => {
    const appearance = parsePublicAppearance({
      logo_url: "https://user:password@storage.example.test/logo.png",
      icon_url: "//external.example.test/icon.png",
      favicon_url: "data:image/svg+xml,<svg/>",
    });
    expect(appearance.logoUrl).toBeNull();
    expect(appearance.iconUrl).toBeNull();
    expect(appearance.faviconUrl).toBeNull();
  });

  it("accepts only the bounded public fields and requests without credentials", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      app_name: "  North Site  ",
      theme_mode: "system",
      accent_preset: "blue",
      logo_url: "https://storage.example.test/logo.png",
      icon_url: "javascript:alert(1)",
      favicon_url: "/favicon.png",
      secret: "never used",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await loadPublicAppearance(fetchImpl);
    expect(result).toEqual({
      appName: "North Site", themeMode: "system", accentPreset: "blue",
      logoUrl: "https://storage.example.test/logo.png", iconUrl: null, faviconUrl: "/favicon.png",
    });
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("/settings/public-appearance"),
      expect.objectContaining({ credentials: "omit", cache: "no-store" }));
  });
});
