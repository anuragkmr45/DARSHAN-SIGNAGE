import type { Page, Route } from "@playwright/test";

// Dark-mode visual checks must use the site's saved setting. Local browser
// storage is only a bootstrap cache and is replaced on each public load.
export async function installDarkSiteAppearance(page: Page) {
  const fulfill = (route: Route, body: unknown) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/v1/settings/public-appearance", (route) =>
    fulfill(route, { app_name: "DARSHAN CMS", theme_mode: "dark", accent_preset: "emerald" }));
  await page.route("**/api/v1/settings/appearance", (route) =>
    fulfill(route, { theme_mode: "dark", accent_preset: "emerald", sidebar_mode: "expanded" }));
}
