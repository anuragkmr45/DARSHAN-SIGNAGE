import { adminCapabilities } from "./helpers/selfAuthorization";
import { expect, test, type Page } from "@playwright/test";

const origin = "http://127.0.0.1:5173";

async function setupPublicAppearance(page: Page, response: { status: number; body?: unknown }) {
  const publicRequestHeaders: Record<string, string>[] = [];
  await page.context().addCookies([{ name: "stale_operator_cookie", value: "must-not-be-sent", url: origin }]);
  await page.route("**/config/app-config.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ cms: {
      environment: { name: "development", deploymentId: "appearance-qa", cmsId: "appearance-qa" },
      api: { baseUrl: new URL(route.request().url()).origin },
      realtime: { socketBaseUrl: new URL(route.request().url()).origin, socketTransports: ["websocket"] },
    } }),
  }));
  await page.route("**/api/v1/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/v1/settings/public-appearance") {
      publicRequestHeaders.push(route.request().headers());
      return route.fulfill({
        status: response.status,
        contentType: "application/json",
        body: JSON.stringify(response.body ?? {}),
      });
    }
    if (pathname === "/api/v1/auth/me") return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return publicRequestHeaders;
}

test("public Home, Login and activation use saved site appearance without a session", async ({ page }) => {
  const headers = await setupPublicAppearance(page, { status: 200, body: {
    theme_mode: "dark", accent_preset: "blue", app_name: "North Campus Displays",
    logo_url: "/darshan-mark.svg", icon_url: null, favicon_url: null,
  } });
  for (const [path, heading] of [
    ["/", "Keep every display on course."],
    ["/login", "Sign in to DARSHAN"],
    ["/activate", "Activate your account"],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.getByText("North Campus Displays")).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator("html")).toHaveAttribute("data-accent", "blue");
    await expect(page).toHaveTitle("North Campus Displays");
  }
  expect(headers).toHaveLength(3);
  for (const requestHeaders of headers) expect(requestHeaders.cookie).toBeUndefined();
});

test("unavailable public appearance replaces stale local theme with Forest fallback", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("darshan-site-theme", "dark"));
  await setupPublicAppearance(page, { status: 503 });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to DARSHAN" })).toBeVisible();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveAttribute("data-accent", "emerald");
  await expect(page).toHaveTitle("DARSHAN CMS");
});

test("forest sidebar keeps links readable and marks the current route", async ({ page }) => {
  const user = {
    id: "00000000-0000-4000-8000-000000000001",
    email: "operator@example.invalid",
    role_id: "00000000-0000-4000-8000-000000000002",
    role: "SUPER_ADMIN",
    department_id: null,
  };
  await page.context().addCookies([{ name: "access_token", value: "palette-fixture-session", url: origin, httpOnly: true }]);
  await page.route("**/config/app-config.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ cms: {
      environment: { name: "development", deploymentId: "palette-qa", cmsId: "palette-qa" },
      api: { baseUrl: new URL(route.request().url()).origin },
      realtime: { socketBaseUrl: new URL(route.request().url()).origin, socketTransports: ["websocket"] },
    } }),
  }));
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/v1/settings/public-appearance") return json({ theme_mode: "light", accent_preset: "emerald", app_name: "DARSHAN CMS" });
    if (path === "/api/v1/auth/me") return json(user);
    if (path === "/api/v1/auth/authorization") return json({
      version: 1, user_id: user.id, role: { id: user.role_id, name: user.role },
      department_id: null, department_ids: [], capabilities: adminCapabilities,
    });
    if (path === "/api/v1/settings/appearance") return json({ theme_mode: "light", accent_preset: "emerald", sidebar_mode: "expanded" });
    if (path === "/api/v1/settings/branding") return json({ app_name: "DARSHAN CMS", logo_url: null, icon_url: null, favicon_url: null });
    if (path === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    return json({ items: [], pagination: { page: 1, limit: 100, total: 0 } });
  });
  await page.goto("/screens");
  const screens = page.getByRole("link", { name: "Screens", exact: true });
  const dashboard = page.getByRole("link", { name: "Dashboard", exact: true });
  await expect(screens).toHaveAttribute("data-active", "true");
  await expect(screens).toHaveAttribute("aria-current", "page");
  await expect(dashboard).toHaveCSS("color", "rgb(208, 217, 209)");
  await expect(screens).toHaveCSS("background-color", "rgb(222, 231, 199)");
  await expect(screens).toHaveCSS("color", "rgb(33, 59, 42)");
  await dashboard.hover();
  await expect(dashboard).toHaveCSS("background-color", "rgb(42, 63, 54)");
  await dashboard.click();
  await expect(dashboard).toHaveAttribute("data-active", "true");
  await expect(screens).toHaveAttribute("data-active", "false");
});

test("all five CMS accents keep text and control boundaries legible in both appearances", async ({ page }) => {
  await setupPublicAppearance(page, { status: 200, body: {
    app_name: "DARSHAN CMS", theme_mode: "light", accent_preset: "emerald",
  } });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const issues = await page.evaluate(() => {
    const root = document.documentElement;
    const pairs: Array<[string, string, number]> = [
      ["foreground", "background", 4.5],
      ["muted-foreground", "background", 4.5],
      ["meta-foreground", "background", 4.5],
      ["card-foreground", "card", 4.5],
      ["primary-foreground", "primary", 4.5],
      ["accent-foreground", "accent", 4.5],
      ["sidebar-foreground", "sidebar-background", 4.5],
      ["sidebar-muted", "sidebar-background", 4.5],
      ["sidebar-accent-foreground", "sidebar-accent", 4.5],
      ["status-success-fg", "status-success-bg", 4.5],
      ["status-warning-fg", "status-warning-bg", 4.5],
      ["status-error-fg", "status-error-bg", 4.5],
      ["status-info-fg", "status-info-bg", 4.5],
      ["input", "background", 3],
      ["input", "card", 3],
    ];
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    const rgb = (token: string) => {
      const hsl = getComputedStyle(root).getPropertyValue(`--${token}`).trim();
      probe.style.color = `hsl(${hsl})`;
      return getComputedStyle(probe).color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    };
    const luminance = (components: number[]) => {
      const channels = components.map((value) => {
        const normalized = value / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const failures: string[] = [];
    for (const theme of ["light", "dark"] as const) {
      root.classList.toggle("dark", theme === "dark");
      for (const accent of ["emerald", "crimson", "blue", "amber", "slate"] as const) {
        root.dataset.accent = accent;
        for (const [foreground, background, floor] of pairs) {
          const a = luminance(rgb(foreground));
          const b = luminance(rgb(background));
          const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          if (ratio < floor) failures.push(`${theme}/${accent}: ${foreground} on ${background} = ${ratio.toFixed(2)}`);
        }
      }
    }
    probe.remove();
    return failures;
  });
  expect(issues).toEqual([]);
});
