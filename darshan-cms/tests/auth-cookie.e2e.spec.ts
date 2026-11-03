import { expect, test } from "@playwright/test";
import { ADMIN_TEST_ROLE_ID, ADMIN_TEST_USER_ID, adminAuthorization } from "./helpers/selfAuthorization";

test.use({ ignoreHTTPSErrors: process.env.E2E_LOCAL_HTTPS === "true" });

const user = {
  id: ADMIN_TEST_USER_ID,
  email: "admin@cms.test",
  first_name: "CMS",
  last_name: "Admin",
  role_id: ADMIN_TEST_ROLE_ID,
  role: "Super Admin",
  department_id: null,
};

test("cookie-only login restores the session, redirects, and logs out", async ({ page }) => {
  let loginRequests = 0;
  let restoredRequests = 0;
  let logoutCsrfHeader: string | undefined;

  await page.route("**/config/app-config.json", (route) => {
    const origin = new URL(route.request().url()).origin;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        cms: {
          environment: { name: origin.startsWith("https:") ? "production" : "development", deploymentId: "browser-test", cmsId: "cms-test" },
          api: { baseUrl: origin },
          realtime: { socketBaseUrl: origin, socketTransports: ["websocket"] },
        },
      }),
    });
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname, origin } = new URL(request.url());
    const cookie = request.headers().cookie ?? "";
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

    if (pathname === "/api/v1/auth/login" && request.method() === "POST") {
      loginRequests += 1;
      await page.context().addCookies([
        { name: "access_token", value: "opaque-test-session", url: origin, httpOnly: true, sameSite: "Lax" },
        { name: "csrf_token", value: "csrf-test-token", url: origin, sameSite: "Lax" },
      ]);
      return json({ user });
    }
    if (pathname === "/api/v1/auth/me") {
      if (!cookie.includes("access_token=opaque-test-session")) {
        return json({ error: { message: "Unauthenticated" } }, 401);
      }
      restoredRequests += 1;
      return json(user);
    }
    if (pathname === "/api/v1/auth/logout") {
      logoutCsrfHeader = request.headers()["x-csrf-token"];
      await page.context().clearCookies();
      return json({ message: "Logged out successfully" });
    }
    if (pathname === "/api/v1/auth/authorization") {
      return json(adminAuthorization(user));
    }
    if (pathname === "/api/v1/roles") {
      return json({
        items: [{
          id: ADMIN_TEST_ROLE_ID,
          name: "Super Admin",
          description: null,
          permissions: { inherits: [], grants: [{ action: "manage", subject: "all" }] },
          is_system: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        }],
        page: 1,
        limit: 100,
        total: 1,
      });
    }
    if (pathname === "/api/v1/notifications/unread-count") {
      return json({ unread_total: 0 });
    }
    return json({});
  });

  await page.goto("/login?redirect=%2Fdashboard%3Ffrom%3Dcookie");
  await page.getByLabel("Email").fill(user.email);
  await page.locator("#login-password").fill("password123");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL(/\/dashboard\?from=cookie$/);
  expect(loginRequests).toBe(1);
  expect(await page.evaluate(() => document.cookie)).not.toContain("access_token");
  expect(await page.evaluate(() => sessionStorage.getItem("persist:darshan"))).not.toContain("opaque-test-session");

  await page.reload();
  await expect(page).toHaveURL(/\/dashboard\?from=cookie$/);
  await expect.poll(() => restoredRequests).toBeGreaterThan(0);

  await page.getByRole("button", { name: /CMS Admin|admin@cms.test/i }).first().click();
  await page.getByRole("menuitem", { name: /log out|sign out/i }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(logoutCsrfHeader).toBe("csrf-test-token");
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?redirect=/);
});

test("invalid runtime config blocks login before any API request", async ({ page }) => {
  let apiRequests = 0;
  await page.route("**/config/app-config.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ cms: { api: { baseUrl: "invalid URL" } } }),
  }));
  await page.route("**/api/v1/**", (route) => {
    apiRequests += 1;
    return route.fulfill({ status: 500 });
  });

  await page.goto("/login");
  await expect(page.getByRole("alert")).toContainText("CMS configuration could not be loaded");
  await expect(page.getByRole("button", { name: "Sign In" })).toHaveCount(0);
  expect(apiRequests).toBe(0);
});
