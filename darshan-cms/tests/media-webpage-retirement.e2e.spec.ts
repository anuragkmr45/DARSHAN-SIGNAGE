import { expect, test, type Page, type Route } from "@playwright/test";
import { ADMIN_TEST_ROLE_ID, ADMIN_TEST_USER_ID, adminAuthorization } from "./helpers/selfAuthorization";

const adminUser = {
  id: ADMIN_TEST_USER_ID,
  email: "admin@darshan.local",
  first_name: "Admin",
  last_name: "User",
  role_id: ADMIN_TEST_ROLE_ID,
  role: "ADMIN",
};

const webpage = {
  id: "webpage-1",
  filename: "Status Dashboard",
  name: "Status Dashboard",
  type: "WEBPAGE",
  status: "READY",
  source_url: "https://legacy.example.test/status",
  media_url: "https://cdn.example.test/preview.png",
  fallback_media_url: "https://cdn.example.test/preview.png",
  permissions: { can_update: false, can_delete: true },
};

const login = async (page: Page) => {
  await page.goto("/login");
  await page.fill("#login-email", adminUser.email);
  await page.fill("#login-password", "LocalDev@123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
};

test("retired webpage media stays in history without playback or creation controls", async ({ page }) => {
  let oldRefreshRequested = false;
  await page.route("**/api/v1/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname.includes("webpage-preview/refresh")) oldRefreshRequested = true;
    if (url.pathname === "/api/v1/auth/login" && method === "POST") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "cms-token", csrf_token: "csrf-token", user: adminUser }) });
    }
    if (url.pathname === "/api/v1/auth/authorization" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(adminAuthorization(adminUser)) });
    }
    if (url.pathname === "/api/v1/roles" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ id: ADMIN_TEST_ROLE_ID, name: "ADMIN", permissions: { inherits: [], grants: [{ action: "manage", subject: "all" }] }, is_system: true }], page: 1, limit: 100, total: 1 }) });
    }
    if (url.pathname === "/api/v1/notifications/unread-count" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ unread_total: 0 }) });
    }
    if (url.pathname === "/api/v1/media/webpage-1" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(webpage) });
    }
    if (url.pathname === "/api/v1/media" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [webpage], page: 1, limit: 6, total: 1 }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });

  await login(page);
  await page.goto("/media");
  await expect(page.getByRole("button", { name: /add webpage/i })).toHaveCount(0);
  await expect(page.getByText("Retired webpage item")).toBeVisible();
  await page.getByRole("group", { name: "Status Dashboard" }).getByRole("button", { name: "Preview" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Webpage media is retired and cannot be played.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Refresh preview" })).toHaveCount(0);
  await expect(dialog.locator("img, video, iframe, webview")).toHaveCount(0);
  expect(oldRefreshRequested).toBe(false);
});
