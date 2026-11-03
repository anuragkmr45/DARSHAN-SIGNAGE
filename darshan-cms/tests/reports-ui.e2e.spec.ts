import { expect, test, type Page } from "@playwright/test";
import { ADMIN_TEST_ROLE_ID, ADMIN_TEST_USER_ID, testAuthorization, type TestCapability } from "./helpers/selfAuthorization";

const origin = "http://127.0.0.1:5173";
const user = {
  id: ADMIN_TEST_USER_ID, email: "reports-qa@example.invalid", first_name: "Reports", last_name: "Operator",
  role_id: ADMIN_TEST_ROLE_ID, role: "CUSTOM", department_id: null,
};
const availability = {
  range: { start_at: "2026-11-01T00:00:00Z", end_at: "2026-11-04T00:00:00Z", timezone: "Asia/Kolkata", offline_threshold_seconds: 90 },
  summary: { screens: 2, monitored_seconds: 259200, online_seconds: 90000, estimated_offline_seconds: 3600, unknown_seconds: 165600, known_seconds: 93600, uptime_percent: 96.15 },
  screens: [
    { screen_id: "00000000-0000-4000-8000-000000000101", screen_name: "Reception Screen", last_heartbeat_at: "2026-11-03T10:00:00Z", never_seen: false, online_seconds: 90000, estimated_offline_seconds: 3600, unknown_seconds: 79200, known_seconds: 93600, uptime_percent: 96.15 },
    { screen_id: "00000000-0000-4000-8000-000000000102", screen_name: "New Screen", last_heartbeat_at: null, never_seen: true, online_seconds: 0, estimated_offline_seconds: 0, unknown_seconds: 86400, known_seconds: 0, uptime_percent: null },
  ],
  daily: [],
};
const logs = Array.from({ length: 7 }, (_value, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  action: "SCREEN_UPDATE", resource_type: "Screen", resource_id: `screen-${index}`,
  user_id: ADMIN_TEST_USER_ID, user: { email: user.email, first_name: "Reports", last_name: "Operator" },
  ip_address: "127.0.0.1", changes: { name: `Screen ${index}` }, created_at: "2026-11-03T10:00:00Z",
}));

async function setup(page: Page, grants: TestCapability[], options: { failAvailability?: boolean; failAudit?: boolean } = {}) {
  const requests: string[] = [];
  let failAvailability = Boolean(options.failAvailability);
  let failAudit = Boolean(options.failAudit);
  await page.context().addCookies([
    { name: "access_token", value: "reports-qa-session", url: origin, httpOnly: true, sameSite: "Lax" },
    { name: "csrf_token", value: "reports-qa-csrf", url: origin, sameSite: "Lax" },
  ]);
  await page.route("**/config/app-config.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ cms: {
    environment: { name: "development", deploymentId: "qa", cmsId: "qa" },
    api: { baseUrl: new URL(route.request().url()).origin },
    realtime: { socketBaseUrl: new URL(route.request().url()).origin, socketTransports: ["websocket"] },
  } }) }));
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/v1/auth/me") return json(user);
    if (url.pathname === "/api/v1/auth/authorization") return json(testAuthorization(user, grants, { roleId: ADMIN_TEST_ROLE_ID }));
    if (url.pathname === "/api/v1/roles") return json({ items: [{ id: ADMIN_TEST_ROLE_ID, name: "CUSTOM", permissions: { grants } }], page: 1, limit: 100, total: 1 });
    if (url.pathname === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    if (url.pathname === "/api/v1/reports/availability") return failAvailability ? json({ error: "Unavailable" }, 503) : json(availability);
    if (url.pathname === "/api/v1/reports/export" || url.pathname === "/api/v1/audit-logs/export") return route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4\n%%EOF" });
    if (url.pathname === "/api/v1/proof-of-play") return json({ items: [{ id: "pop-one", screen_id: availability.screens[0].screen_id, screen_name: "Reception Screen", media_id: "media-one", media_name: "Training clip", started_at: "2026-11-03T10:00:00Z", completed: false, page_number: 2 }], pagination: { page: 1, limit: 5, total: 1 } });
    if (url.pathname === "/api/v1/audit-logs") {
      if (failAudit) return json({ error: "Unavailable" }, 503);
      const pageNumber = Number(url.searchParams.get("page") || 1);
      const filtered = logs.filter((log) => (!url.searchParams.get("resource_type") || log.resource_type.toLowerCase().includes(url.searchParams.get("resource_type")!.toLowerCase())) && (!url.searchParams.get("action") || log.action.toLowerCase().includes(url.searchParams.get("action")!.toLowerCase())));
      return json({ items: filtered.slice((pageNumber - 1) * 5, pageNumber * 5), pagination: { page: pageNumber, limit: 5, total: filtered.length } });
    }
    return json({});
  });
  return { requests, setAvailabilityFailure: (value: boolean) => { failAvailability = value; }, setAuditFailure: (value: boolean) => { failAudit = value; } };
}

test("Report-only role sees availability and PDF without requesting private PoP or audit data", async ({ page }) => {
  const state = await setup(page, [{ action: "read", subject: "Report" }]);
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Player availability" })).toBeVisible();
  await expect(page.getByText("96.15%", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("row", { name: /New Screen/ }).getByText("Never seen").first()).toBeVisible();
  await expect(page.getByRole("tab", { name: "Audit Logs" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Recent playback reports" })).toHaveCount(0);
  expect(state.requests).not.toContain("/api/v1/proof-of-play");
  expect(state.requests).not.toContain("/api/v1/audit-logs");
  await expect(page.getByRole("button", { name: "Export snapshot PDF" })).toBeEnabled();
});

test("Audit-only role can inspect, filter, page, and export logs without report calls", async ({ page }) => {
  const state = await setup(page, [{ action: "read", subject: "AuditLog" }]);
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Audit Logs" })).toBeVisible();
  await expect(page.getByText("7 logs")).toBeVisible();
  await page.getByRole("button", { name: "Go to next page" }).click();
  await expect(page.getByText("Showing 6–7 of 7")).toBeVisible();
  await page.getByLabel("Action").fill("DELETE");
  await expect(page.getByText("No logs match these filters")).toBeVisible();
  await page.getByLabel("Resource type").fill("Screen");
  const exportRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/v1/audit-logs/export");
  await page.getByRole("button", { name: "Logs PDF" }).click();
  const exportUrl = new URL((await exportRequest).url());
  expect(exportUrl.searchParams.get("resource_type")).toBe("Screen");
  expect(exportUrl.searchParams.get("action")).toBe("DELETE");
  await expect(page.getByRole("tab", { name: "Availability" })).toHaveCount(0);
  expect(state.requests).not.toContain("/api/v1/reports/availability");
  expect(state.requests).not.toContain("/api/v1/proof-of-play");
});

test("availability and audit failures offer retry instead of invented zero data", async ({ page }) => {
  const state = await setup(page, [{ action: "read", subject: "Report" }, { action: "read", subject: "AuditLog" }], { failAvailability: true, failAudit: true });
  await page.goto("/reports");
  await expect(page.getByText("Could not load availability")).toBeVisible();
  await expect(page.getByText("96.15%", { exact: true })).toHaveCount(0);
  state.setAvailabilityFailure(false);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("96.15%", { exact: true }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Audit Logs" }).click();
  await expect(page.getByText("Could not load audit logs")).toBeVisible();
  state.setAuditFailure(false);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("7 logs")).toBeVisible();
});

test("full access shows correct PoP outcome and responsive report views", async ({ page }, testInfo) => {
  await setup(page, [{ action: "read", subject: "Report" }, { action: "read", subject: "AuditLog" }, { action: "read", subject: "ProofOfPlay" }]);
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Recent playback reports" })).toBeVisible();
  await expect(page.getByText("Training clip")).toBeVisible();
  await expect(page.getByText("Incomplete", { exact: true })).toBeVisible();
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`reports-${width}.png`) });
  }
  await page.getByRole("tab", { name: "Audit Logs" }).click();
  await expect(page.getByText("7 logs")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(() => window.localStorage.setItem("theme", "dark"));
  await page.reload();
  await page.getByRole("tab", { name: "Audit Logs" }).click();
  await expect(page.getByRole("tab", { name: "Audit Logs" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Audit Logs" })).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({ path: testInfo.outputPath("audit-dark-390.png") });
});
