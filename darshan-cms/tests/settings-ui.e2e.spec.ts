import { expect, test, type Page } from "@playwright/test";
import { ADMIN_TEST_ROLE_ID, ADMIN_TEST_USER_ID, testAuthorization, type TestCapability } from "./helpers/selfAuthorization";
import { installDarkSiteAppearance } from "./helpers/siteAppearance";

const origin = "http://127.0.0.1:5173";
const actor = { id: ADMIN_TEST_USER_ID, email: "settings@example.invalid", role_id: ADMIN_TEST_ROLE_ID, role: "CUSTOM", department_id: null };
const imageId = "00000000-0000-4000-8000-000000000041";
const logoUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' fill='%23a40024'/%3E%3C/svg%3E";

async function setup(page: Page, grants: TestCapability[], options: { failGeneral?: boolean } = {}) {
  let failGeneral = Boolean(options.failGeneral);
  const requests: string[] = [];
  let branding = {
    app_name: "DARSHAN CMS", logo_media_id: imageId, icon_media_id: null, favicon_media_id: null,
    logo_url: logoUrl, icon_url: null, favicon_url: null,
  };
  await page.context().addCookies([
    { name: "access_token", value: "settings-qa-session", url: origin, httpOnly: true, sameSite: "Lax" },
    { name: "csrf_token", value: "settings-qa-csrf", url: origin, sameSite: "Lax" },
  ]);
  await page.route("**/config/app-config.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ cms: {
    environment: { name: "development", deploymentId: "qa", cmsId: "qa" },
    api: { baseUrl: new URL(route.request().url()).origin },
    realtime: { socketBaseUrl: new URL(route.request().url()).origin, socketTransports: ["websocket"] },
  } }) }));
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    requests.push(`${method} ${path}`);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/v1/auth/me") return json(actor);
    if (path === "/api/v1/auth/authorization") return json(testAuthorization(actor, grants));
    if (path === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    if (path === "/api/v1/settings/general") {
      if (failGeneral) return json({ error: { message: "Temporarily unavailable" } }, 503);
      return json({ company_name: "DARSHAN", timezone: "Asia/Kolkata", language: "en" });
    }
    if (path === "/api/v1/settings/branding") {
      if (method === "PUT") {
        const body = route.request().postDataJSON() as typeof branding;
        branding = { ...body, logo_url: body.logo_media_id ? logoUrl : null, icon_url: null, favicon_url: null };
      }
      return json(branding);
    }
    if (path === "/api/v1/settings/security") return json({ idle_timeout_minutes: 30, password_policy: { min_length: 12, require_uppercase: true, require_lowercase: true, require_number: true, require_special: true } });
    if (path === "/api/v1/settings/appearance") return json({ theme_mode: "light", accent_preset: "crimson", sidebar_mode: "expanded" });
    if (path === "/api/v1/settings/backups") return json({ automatic_enabled: true, interval_hours: 24, log_level: "info", external_sidecar: false, manual_run_supported: true });
    if (path === "/api/v1/settings/backups/history") return json({ items: [{ id: "backup-1", status: "COMPLETED", trigger_type: "MANUAL", created_at: "2026-11-03T00:00:00Z", downloads: [] }] });
    if (path === "/api/v1/settings/logs") return json({ items: [] });
    if (path === "/api/v1/media") return json({ items: [{ id: imageId, name: "DARSHAN logo", type: "IMAGE", status: "READY", media_url: logoUrl }], page: 1, limit: 50, total: 1 });
    return json({});
  });
  return { requests, restoreGeneral: () => { failGeneral = false; }, branding: () => branding };
}

test("read-only settings never offer a write or media upload", async ({ page }) => {
  const state = await setup(page, [
    { action: "read", subject: "OrgSettings" },
    { action: "read", subject: "BrandingSettings" },
    { action: "read", subject: "Media" },
  ]);
  await page.goto("/settings");
  await expect(page.getByLabel("Company name")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save General" })).toBeDisabled();
  await page.getByRole("tab", { name: "Branding" }).click();
  await expect(page.getByRole("button", { name: "Save Branding" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Choose existing" })).toHaveCount(0);
  await expect(page.getByText("Upload new")).toHaveCount(0);
  await page.getByRole("tab", { name: "Advanced" }).click();
  await expect(page.getByRole("button", { name: "Save Advanced" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Run Backup Now" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  expect(state.requests.some((request) => request.startsWith("PUT ") || request.startsWith("POST ") || request.startsWith("DELETE "))).toBe(false);
});

test("branding image Clear removes its preview and Save persists the cleared ID", async ({ page }) => {
  const state = await setup(page, [
    { action: "read", subject: "OrgSettings" },
    { action: "read", subject: "BrandingSettings" },
    { action: "update", subject: "BrandingSettings" },
    { action: "read", subject: "Media" },
  ]);
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Branding" }).click();
  await expect(page.getByRole("img", { name: "Logo" })).toHaveCount(1);
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByRole("img", { name: "Logo" })).toHaveCount(0);
  await page.getByRole("button", { name: "Save Branding" }).click();
  await expect.poll(() => state.branding().logo_media_id).toBeNull();
  await page.getByRole("button", { name: "Choose existing" }).first().click();
  await page.getByRole("dialog", { name: "Select Logo" }).getByRole("button", { name: /DARSHAN logo/ }).click();
  await page.getByRole("button", { name: "Save Branding" }).click();
  await expect.poll(() => state.branding().logo_media_id).toBe(imageId);
});

test("branding upload rejects a PDF before requesting an upload session", async ({ page }) => {
  const state = await setup(page, [
    { action: "read", subject: "OrgSettings" },
    { action: "read", subject: "BrandingSettings" },
    { action: "update", subject: "BrandingSettings" },
    { action: "create", subject: "Media" },
  ]);
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Branding" }).click();
  await page.locator('input[type="file"]').first().setInputFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-test") });
  await expect(page.getByText("Branding assets must be JPEG, PNG, or WEBP images.", { exact: true })).toBeVisible();
  const notification = page.locator('[data-state="open"].destructive');
  await expect(notification).toBeVisible();
  await expect(notification.getByRole("button", { name: "Dismiss notification" })).toBeVisible();
  const notificationSurfaces = await notification.evaluate((element) => {
    const root = document.documentElement;
    const originalDark = root.classList.contains("dark");
    const originalTransition = element.style.transition;
    element.style.transition = "none";
    root.classList.remove("dark");
    const light = getComputedStyle(element).backgroundColor;
    root.classList.add("dark");
    const dark = getComputedStyle(element).backgroundColor;
    root.classList.toggle("dark", originalDark);
    element.style.transition = originalTransition;
    return { light, dark };
  });
  expect(notificationSurfaces.light).not.toBe("rgba(0, 0, 0, 0)");
  expect(notificationSurfaces.dark).not.toBe(notificationSurfaces.light);
  await notification.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(notification).toHaveCount(0);
  expect(state.requests.some((request) => request.includes("/api/v1/media/upload"))).toBe(false);
});

test("failed settings load offers Retry instead of showing empty defaults", async ({ page }) => {
  const state = await setup(page, [{ action: "read", subject: "OrgSettings" }], { failGeneral: true });
  await page.goto("/settings");
  await expect(page.getByText("Could not load these settings. No changes have been made.")).toBeVisible();
  await expect(page.getByLabel("Company name")).toHaveCount(0);
  state.restoreGeneral();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByLabel("Company name")).toHaveValue("DARSHAN");
});

test("recent logs use readable site surfaces in dark and light modes", async ({ page }) => {
  await setup(page, [{ action: "read", subject: "OrgSettings" }]);
  await page.route("**/api/v1/settings/logs**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ items: [{ id: "log-1", timestamp: "2026-11-04T10:00:00Z", level: "info", logger: "server", message: "Service ready" }] }),
  }));
  await installDarkSiteAppearance(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  await page.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: /Advanced/ }).click();
  const message = page.getByText("Service ready");
  await expect(message).toBeVisible();
  const panel = message.locator("../..");
  const section = page.locator(".settings-section").filter({ has: page.getByRole("heading", { name: "Recent logs" }) });
  await expect(section).toHaveCSS("border-top-width", "0px");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(panel).toHaveCSS("background-color", "rgb(29, 33, 29)");
  await expect(message).toHaveCSS("color", "rgb(242, 245, 238)");
  await page.screenshot({ path: "../qa-artifacts/evidence/product-ui-settings/logs-dark-390.png", fullPage: true });
  await page.locator("html").evaluate((element) => element.classList.remove("dark"));
  await expect(panel).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(message).toHaveCSS("color", "rgb(27, 31, 27)");
});

test("settings tabs and branding remain within phone, tablet and desktop widths", async ({ page }) => {
  await setup(page, [
    { action: "read", subject: "OrgSettings" },
    { action: "read", subject: "BrandingSettings" },
    { action: "update", subject: "BrandingSettings" },
    { action: "read", subject: "Media" },
  ]);
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/settings");
    if (width < 640) {
      await expect(page.getByLabel("Company name")).toBeHidden();
      await page.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: /Branding/ }).click();
      await expect(page.getByRole("button", { name: "Back to all settings" })).toBeVisible();
    } else {
      await page.getByRole("tab", { name: "Branding" }).click();
    }
    await expect(page.getByRole("button", { name: "Save Branding" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width !== 820) await page.screenshot({ path: `../qa-artifacts/evidence/product-ui-settings/${width}-light.png`, fullPage: true });
  }
});

test("phone settings opens one category, retains a draft, and returns focus to the category list", async ({ page }) => {
  await setup(page, [
    { action: "read", subject: "OrgSettings" },
    { action: "update", subject: "OrgSettings" },
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  const categories = page.getByRole("navigation", { name: "Settings categories" });
  await expect(categories.getByRole("button", { name: /General/ })).toBeVisible();
  await page.screenshot({ path: "../qa-artifacts/evidence/product-ui-settings/390-categories.png", fullPage: true });
  await expect(categories.getByRole("button", { name: /Branding/ })).toHaveCount(0);
  await expect(categories.getByRole("button", { name: /Roles/ })).toHaveCount(0);
  await expect(page.getByLabel("Company name")).toBeHidden();

  await categories.getByRole("button", { name: /General/ }).click();
  await expect(page.getByLabel("Company name")).toHaveValue("DARSHAN");
  await page.getByLabel("Company name").fill("DARSHAN draft");
  await page.getByRole("button", { name: "Back to all settings" }).click();
  await expect(categories.getByRole("button", { name: /General/ })).toBeFocused();
  await expect(page.getByLabel("Company name")).toBeHidden();

  await categories.getByRole("button", { name: /General/ }).click();
  await expect(page.getByLabel("Company name")).toHaveValue("DARSHAN draft");
  await expect(page.getByRole("tab", { name: "General" })).toBeHidden();
  await page.setViewportSize({ width: 640, height: 360 });
  await expect(page.getByRole("tab", { name: "General" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
