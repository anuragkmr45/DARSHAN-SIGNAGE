import { expect, test, type Page, type Route } from "@playwright/test";

const adminUser = {
  id: "admin-user-id",
  email: "admin@darshan.local",
  first_name: "Admin",
  last_name: "User",
  role_id: "role-admin",
  role: "ADMIN",
  authorization: { rules: [{ action: "manage", subject: "all" }], is_global_user_manager: true },
};

const rolesPayload = {
  items: [{
    id: "role-admin",
    name: "ADMIN",
    permissions: { inherits: [], grants: [{ action: "manage", subject: "all" }] },
    is_system: true,
  }],
  page: 1,
  limit: 100,
  total: 1,
};

const login = async (page: Page) => {
  await page.goto("/login");
  await page.fill("#login-email", adminUser.email);
  await page.fill("#login-password", "LocalDev@123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
};

test("an operator can refresh a webpage preview while the last successful preview remains visible", async ({ page }) => {
  let refreshed = false;
  const initialCapture = "2026-10-16T00:00:00.000Z";
  const refreshedCapture = "2026-10-17T00:00:00.000Z";
  const webpage = () => ({
    id: "webpage-1",
    filename: "Status Dashboard",
    name: "Status Dashboard",
    type: "WEBPAGE",
    status: "READY",
    source_url: "http://public.example.test/status",
    media_url: refreshed ? "https://cdn.example.test/preview-v2.png" : "https://cdn.example.test/preview-v1.png",
    fallback_media_url: refreshed ? "https://cdn.example.test/preview-v2.png" : "https://cdn.example.test/preview-v1.png",
    fallback_media_revision: refreshed ? "ready-v2" : "ready-v1",
    fallback_media_sha256: refreshed ? "b".repeat(64) : "a".repeat(64),
    fallback_media_captured_at: refreshed ? refreshedCapture : initialCapture,
    webpage_preview_refresh_status: "READY",
    webpage_preview_last_error: null,
    permissions: { can_update: true, can_delete: true },
  });

  await page.route("**/api/v1/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === "/api/v1/auth/login" && method === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ token: "cms-token", csrf_token: "csrf-token", user: adminUser }),
      });
    }
    if (url.pathname === "/api/v1/roles" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rolesPayload) });
    }
    if (url.pathname === "/api/v1/notifications/unread-count" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ unread_total: 0 }) });
    }
    if (url.pathname === "/api/v1/media/webpage-1/webpage-preview/refresh" && method === "POST") {
      refreshed = true;
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          media_id: "webpage-1",
          refresh_status: "QUEUED",
          requested_at: refreshedCapture,
        }),
      });
    }
    if (url.pathname === "/api/v1/media/webpage-1" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(webpage()) });
    }
    if (url.pathname === "/api/v1/media" && method === "GET") {
      const requestedType = url.searchParams.get("type");
      const items = !requestedType || requestedType === "WEBPAGE" ? [webpage()] : [];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items, page: 1, limit: Number(url.searchParams.get("limit") || 6), total: items.length }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });

  await login(page);
  await page.goto("/media");
  await page.getByText("Status Dashboard", { exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Refresh preview" })).toBeVisible();
  await dialog.getByRole("button", { name: "Refresh preview" }).click();
  await expect(dialog.getByText(new RegExp(new Date(refreshedCapture).toLocaleString()))).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByRole("img", { name: "Status Dashboard" })).toHaveAttribute("src", /preview-v2\.png/);
});
