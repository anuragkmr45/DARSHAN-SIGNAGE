import { expect, test } from "@playwright/test";

test.use({ ignoreHTTPSErrors: process.env.E2E_LOCAL_HTTPS === "true" });

const user = {
  id: "user-1",
  email: "admin@cms.test",
  first_name: "CMS",
  last_name: "Admin",
  role_id: "role-1",
  role: "Super Admin",
  department_id: null,
  authorization: { rules: [{ action: "manage", subject: "all" }], is_global_user_manager: true },
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
    if (pathname === "/api/v1/roles") {
      return json({
        items: [{
          id: "role-1",
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

test("logging in as a different user in another tab clears the old tab's local identity", async ({ page, context }) => {
  const secondUser = {
    ...user,
    id: "user-2",
    email: "other@cms.test",
    first_name: "Other",
  };
  let activeUser: typeof user | null = null;

  await context.route("**/config/app-config.json", (route) => {
    const origin = new URL(route.request().url()).origin;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        cms: {
          environment: { name: "development", deploymentId: "browser-test", cmsId: "cms-test" },
          api: { baseUrl: origin },
          realtime: { socketBaseUrl: origin, socketTransports: ["websocket"] },
        },
      }),
    });
  });
  await context.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname, origin } = new URL(request.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/v1/auth/login" && request.method() === "POST") {
      const email = (request.postDataJSON() as { email: string }).email;
      activeUser = email === secondUser.email ? secondUser : user;
      await context.addCookies([{ name: "access_token", value: activeUser.id, url: origin, httpOnly: true, sameSite: "Lax" }]);
      return json({ user: activeUser });
    }
    if (pathname === "/api/v1/auth/me") {
      return activeUser ? json(activeUser) : json({ error: { code: "UNAUTHORIZED", message: "No session" } }, 401);
    }
    if (pathname === "/api/v1/users" && request.method() === "GET") {
      if (!activeUser) return json({ error: { code: "UNAUTHORIZED", message: "No session" } }, 401);
      const suffix = activeUser.id === secondUser.id ? "b" : "a";
      return json({
        items: [{
          id: `operator-${suffix}`, email: `operator-${suffix}@cms.test`,
          first_name: "Operator", last_name: suffix.toUpperCase(),
          role_id: "role-operator", role: "OPERATOR", department_id: null,
          is_active: true, created_at: "2026-10-22T00:00:00.000Z", updated_at: "2026-10-22T00:00:00.000Z",
          permissions: { can_update: false, can_delete: false, can_reset_password: false },
        }],
        pagination: { page: 1, limit: 9, total: 1 },
      });
    }
    if (pathname === "/api/v1/users/management-options") {
      return json({ roles: [{ id: "role-operator", name: "OPERATOR" }], departments: [], is_global_user_manager: true });
    }
    if (pathname === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    return json({});
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.locator("#login-password").fill("password123");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/operators");
  await expect(page.getByText("operator-a@cms.test", { exact: true })).toBeVisible();

  const otherTab = await context.newPage();
  await otherTab.goto("/login");
  await otherTab.getByLabel("Email").fill(secondUser.email);
  await otherTab.locator("#login-password").fill("password123");
  await otherTab.getByRole("button", { name: "Sign In" }).click();
  await expect(otherTab).toHaveURL(/\/dashboard$/);
  await otherTab.goto("/operators");
  await expect(otherTab.getByText("operator-b@cms.test", { exact: true })).toBeVisible();
  await expect(otherTab.getByText("operator-a@cms.test", { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("persist:darshan") ?? ""))
    .not.toContain(user.email);
});

test("window focus clears an old identity when both cross-tab browser signals are blocked", async ({ page, context }) => {
  const secondUser = {
    ...user,
    id: "user-focus-2",
    email: "focus-other@cms.test",
    first_name: "Focus Other",
  };
  let activeUser: typeof user | null = null;
  let firstUserMeRequests = 0;
  let secondUserMeRequests = 0;

  await context.addInitScript(() => {
    Object.defineProperty(window, "BroadcastChannel", { configurable: true, value: undefined });
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        removeItem: () => undefined,
        setItem: () => { throw new Error("local storage blocked for test"); },
      },
    });
  });
  await context.route("**/config/app-config.json", (route) => {
    const origin = new URL(route.request().url()).origin;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        cms: {
          environment: { name: "development", deploymentId: "focus-fallback-test", cmsId: "cms-test" },
          api: { baseUrl: origin },
          realtime: { socketBaseUrl: origin, socketTransports: ["websocket"] },
        },
      }),
    });
  });
  await context.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname, origin } = new URL(request.url());
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    if (pathname === "/api/v1/auth/login" && request.method() === "POST") {
      const email = (request.postDataJSON() as { email: string }).email;
      activeUser = email === secondUser.email ? secondUser : user;
      await context.addCookies([{
        name: "access_token",
        value: activeUser.id,
        url: origin,
        httpOnly: true,
        sameSite: "Lax",
      }]);
      return json({ user: activeUser });
    }
    if (pathname === "/api/v1/auth/me") {
      if (activeUser?.id === user.id) firstUserMeRequests += 1;
      if (activeUser?.id === secondUser.id) secondUserMeRequests += 1;
      return activeUser ? json(activeUser) : json({ error: { code: "UNAUTHORIZED", message: "No session" } }, 401);
    }
    if (pathname === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    return json({});
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.locator("#login-password").fill("password123");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect.poll(() => firstUserMeRequests).toBeGreaterThan(0);

  const otherTab = await context.newPage();
  await otherTab.goto("/login");
  await otherTab.getByLabel("Email").fill(secondUser.email);
  await otherTab.locator("#login-password").fill("password123");
  await otherTab.getByRole("button", { name: "Sign In" }).click();
  await expect(otherTab).toHaveURL(/\/dashboard$/);

  // Neither storage events nor BroadcastChannel can notify the first tab.
  // Bringing it forward must revalidate /auth/me and reject the new identity
  // before applying its authorization rules to the old rendered account.
  await page.bringToFront();
  await expect.poll(() => secondUserMeRequests).toBeGreaterThan(0);
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("persist:darshan") ?? ""))
    .not.toContain(user.email);
});
