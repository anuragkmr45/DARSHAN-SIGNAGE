import { expect, test, type Page } from "@playwright/test";
import { ADMIN_TEST_ROLE_ID, ADMIN_TEST_USER_ID, testAuthorization } from "./helpers/selfAuthorization";

const origin = "http://127.0.0.1:5173";
const user = {
  id: ADMIN_TEST_USER_ID, email: "hooks-qa@example.invalid", first_name: "Hook", last_name: "Operator",
  role_id: ADMIN_TEST_ROLE_ID, role: "ADMIN", department_id: null,
};
type Hook = {
  id: string; name: string; target_url: string; event_types: string[];
  is_active: boolean; last_status: string | null; last_status_at: string | null;
};
const initial: Hook[] = [
  { id: "hook-site", name: "Site status", target_url: "http://service.internal.test/hooks/site", event_types: ["screen.online", "screen.offline"], is_active: true, last_status: null, last_status_at: null },
  { id: "hook-pause", name: "Paused delivery", target_url: "https://service.internal.test/hooks/paused", event_types: ["content.published"], is_active: false, last_status: "FAILED_HTTP_503", last_status_at: "2026-11-03T09:00:00Z" },
];
async function setup(page: Page, actions: Array<"create" | "update" | "delete"> = ["create", "update", "delete"], seed = initial) {
  const hooks = seed.map((item) => ({ ...item }));
  let listFails = false;
  let testFails = false;
  let testCalls = 0;
  await page.context().addCookies([
    { name: "access_token", value: "hooks-qa-session", url: origin, httpOnly: true, sameSite: "Lax" },
    { name: "csrf_token", value: "hooks-qa-csrf", url: origin, sameSite: "Lax" },
  ]);
  await page.route("**/config/app-config.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ cms: {
    environment: { name: "development", deploymentId: "qa", cmsId: "qa" },
    api: { baseUrl: new URL(route.request().url()).origin },
    realtime: { socketBaseUrl: new URL(route.request().url()).origin, socketTransports: ["websocket"] },
  } }) }));
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/v1/auth/me") return json(user);
    if (url.pathname === "/api/v1/auth/authorization") return json(testAuthorization(user, [
      { action: "read", subject: "Webhook" },
      ...actions.map((action) => ({ action, subject: "Webhook" })),
    ], { roleId: ADMIN_TEST_ROLE_ID }));
    if (url.pathname === "/api/v1/roles") return json({ items: [{ id: ADMIN_TEST_ROLE_ID, name: "ADMIN", permissions: { inherits: [], grants: [] } }], page: 1, limit: 100, total: 1 });
    if (url.pathname === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    if (url.pathname === "/api/v1/webhooks" && method === "GET") return listFails ? json({ error: "Unavailable" }, 503) : json({ items: hooks });
    if (url.pathname === "/api/v1/webhooks" && method === "POST") {
      const payload = route.request().postDataJSON() as { name: string; target_url: string; event_types: string[] };
      const hook = { id: "hook-new", name: payload.name, target_url: payload.target_url, event_types: payload.event_types, is_active: true, last_status: null, last_status_at: null };
      hooks.unshift(hook);
      return json({ ...hook, secret: "one-time-webhook-secret" }, 201);
    }
    if (url.pathname === "/api/v1/webhooks/hook-site/test" && method === "POST") {
      testCalls += 1;
      const hook = hooks.find((item) => item.id === "hook-site")!;
      if (testFails) {
        hook.last_status = "FAILED_HTTP_503";
        return json({ error: "Test rejected" }, 502);
      }
      hook.last_status = "SUCCESS";
      hook.last_status_at = "2026-11-04T00:00:00Z";
      return json({ success: true, status_code: 202, attempted: hook.target_url, sent_at: "2026-11-04T00:00:00Z" });
    }
    if (url.pathname === "/api/v1/webhooks/hook-pause" && method === "PATCH") {
      hooks[1]!.is_active = true;
      return json(hooks[1]);
    }
    if (url.pathname === "/api/v1/webhooks/hook-site" && method === "DELETE") {
      hooks.splice(hooks.findIndex((hook) => hook.id === "hook-site"), 1);
      return route.fulfill({ status: 204, body: "" });
    }
    return json({});
  });
  return {
    hooks,
    setListFails: (value: boolean) => { listFails = value; },
    setTestFails: (value: boolean) => { testFails = value; },
    testCalls: () => testCalls,
  };
}

test("create validates URL, Test is explicit, and delete needs confirmation", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/webhooks");
  await expect(page.getByText(/Only the explicit Test action sends a request/)).toBeVisible();
  expect(state.testCalls()).toBe(0);
  await page.getByRole("button", { name: "Add Webhook" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Office hook");
  await page.getByLabel("HTTP or HTTPS URL").fill("file:///etc/passwd");
  await page.getByLabel("Screen Comes Online").click();
  await page.getByRole("button", { name: "Create Webhook" }).click();
  expect(state.hooks).toHaveLength(2);
  await page.getByLabel("HTTP or HTTPS URL").fill("http://office.internal.test/webhook");
  await page.getByRole("button", { name: "Create Webhook" }).click();
  await expect(page.getByRole("region", { name: "Office hook" })).toBeVisible();
  await expect(page.getByText("one-time-webhook-secret")).toHaveCount(0);
  const site = page.getByRole("region", { name: "Site status" });
  await site.getByRole("button", { name: "Test" }).click();
  await expect(site.getByText("Last test succeeded")).toBeVisible();
  expect(state.testCalls()).toBe(1);
  await site.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: "Delete webhook?" }).getByRole("button", { name: "Cancel" }).click();
  await expect(site).toBeVisible();
  await site.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog", { name: "Delete webhook?" }).getByRole("button", { name: "Delete webhook" }).click();
  await expect(site).toHaveCount(0);
});

test("test failure is reported once and read-only roles cannot change endpoints", async ({ page }) => {
  const state = await setup(page, []);
  state.setListFails(true);
  await page.goto("/webhooks");
  await expect(page.getByText("Unable to load webhooks")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Webhook" })).toHaveCount(0);
  state.setListFails(false);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("region", { name: "Site status" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Site status" }).getByRole("button", { name: "Test" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Site status" }).getByRole("button", { name: "Delete" })).toHaveCount(0);
});

test("failed manual Test retains failure status and does not retry automatically", async ({ page }) => {
  const state = await setup(page);
  state.setTestFails(true);
  await page.goto("/webhooks");
  const site = page.getByRole("region", { name: "Site status" });
  await site.getByRole("button", { name: "Test" }).click();
  await expect(site.getByText("Last test failed (HTTP 503)")).toBeVisible();
  expect(state.testCalls()).toBe(1);
  await expect(page.getByRole("region", { name: "Paused delivery" }).getByText("Paused", { exact: true })).toBeVisible();
});

test("endpoint list fits phone, tablet, desktop, and dark phone", async ({ page }, testInfo) => {
  await setup(page);
  await page.goto("/webhooks");
  await expect(page.getByRole("region", { name: "Site status" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`webhooks-${width}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(() => window.localStorage.setItem("theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("region", { name: "Site status" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("webhooks-dark-390.png") });
});
