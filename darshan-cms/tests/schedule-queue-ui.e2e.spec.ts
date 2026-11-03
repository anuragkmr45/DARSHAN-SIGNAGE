import { expect, test, type Page } from "@playwright/test";
import { ADMIN_TEST_ROLE_ID, ADMIN_TEST_USER_ID, testAuthorization, type TestCapability } from "./helpers/selfAuthorization";

const origin = "http://127.0.0.1:5173";
const actor = { id: ADMIN_TEST_USER_ID, email: "queue@example.invalid", role_id: ADMIN_TEST_ROLE_ID, role: "CUSTOM", department_id: null };
const reader: TestCapability[] = [{ action: "read", subject: "ScheduleRequest" }];
const creator: TestCapability[] = [
  ...reader,
  { action: "read", subject: "Layout" }, { action: "read", subject: "Media" }, { action: "read", subject: "Screen" },
  { action: "create", subject: "Presentation" }, { action: "update", subject: "Presentation" },
  { action: "create", subject: "Schedule" }, { action: "create", subject: "ScheduleItem" },
  { action: "create", subject: "ScheduleRequest" },
];
const requestItem = {
  id: "00000000-0000-4000-8000-000000000501", status: "PENDING", created_at: "2026-11-04T08:00:00Z",
  schedule: { id: "00000000-0000-4000-8000-000000000502", name: "Morning briefing", start_at: "2026-11-04T09:00:00Z", end_at: "2026-11-04T10:00:00Z" },
  screens: [{ id: "00000000-0000-4000-8000-000000000503", name: "Lobby screen" }],
};

async function setup(page: Page, grants: TestCapability[], options: { listFails?: boolean; summaryFailsAfterSearch?: boolean; snapshotFails?: boolean; published?: boolean } = {}) {
  let listFails = Boolean(options.listFails);
  let snapshotFails = Boolean(options.snapshotFails);
  const requests: string[] = [];
  await page.context().addCookies([
    { name: "access_token", value: "queue-qa-session", url: origin, httpOnly: true, sameSite: "Lax" },
    { name: "csrf_token", value: "queue-qa-csrf", url: origin, sameSite: "Lax" },
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
    requests.push(`${method} ${path}${url.search}`);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/v1/auth/me") return json(actor);
    if (path === "/api/v1/auth/authorization") return json(testAuthorization(actor, grants));
    if (path === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    if (path === "/api/v1/settings/branding") return json({ app_name: "DARSHAN CMS" });
    if (path === "/api/v1/schedule-requests/status-summary") {
      if (options.summaryFailsAfterSearch && url.searchParams.get("q")) return json({ error: { message: "Unavailable" } }, 503);
      return json({ counts: { pending: options.published ? 0 : 1, approved: 0, rejected: 0, published: options.published ? 1 : 0, taken_down: 0, expired: 0 } });
    }
    if (path === "/api/v1/schedule-requests" && method === "GET") {
      if (listFails) return json({ error: { message: "Unavailable" } }, 503);
      const status = url.searchParams.get("status");
      const q = url.searchParams.get("q");
      const items = status === (options.published ? "PUBLISHED" : "PENDING") && !q
        ? [{ ...requestItem, status: options.published ? "PUBLISHED" : "PENDING" }] : [];
      return json({ items, pagination: { page: 1, limit: 10, total: items.length } });
    }
    if (path.includes("/snapshot") && method === "GET") return snapshotFails
      ? json({ error: { message: "Unavailable" } }, 503)
      : json({ snapshot: { schedule: { id: requestItem.schedule.id, items: [] } }, publish: null, media_urls: {}, media_assets: {} });
    return json({});
  });
  return { requests, restoreList: () => { listFails = false; }, restoreSnapshot: () => { snapshotFails = false; } };
}

test("read-only queue hides the incomplete creator action and direct URL explains access", async ({ page }) => {
  const state = await setup(page, reader);
  await page.goto("/schedule");
  await expect(page.getByRole("heading", { name: "Schedule Queue" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Schedule" })).toHaveCount(0);
  await page.goto("/schedule/new");
  await expect(page.getByRole("heading", { name: "Schedule creation unavailable" })).toBeVisible();
  expect(state.requests.some((request) => request.startsWith("POST ") || request.startsWith("PUT "))).toBe(false);
});

test("list failure stays an error until Retry and a row opens from the keyboard", async ({ page }) => {
  const state = await setup(page, creator, { listFails: true });
  await page.goto("/schedule");
  await expect(page.getByText("Could not load schedule requests")).toBeVisible();
  await expect(page.getByText("No requests found")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create Schedule" })).toBeVisible();
  state.restoreList();
  await page.getByRole("button", { name: "Retry" }).click();
  const row = page.getByRole("button", { name: "Open Morning briefing request details" });
  await expect(row).toBeVisible();
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Close request details" })).toBeVisible();
});

test("failed counts after a search do not reuse the previous filter totals", async ({ page }) => {
  await setup(page, reader, { summaryFailsAfterSearch: true });
  await page.goto("/schedule");
  await expect(page.getByRole("tab", { name: "Pending 1" })).toBeVisible();
  await page.getByLabel("Search schedule requests").fill("missing");
  await expect(page.getByText("Could not update status counts.", { exact: false })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Pending 0" })).toBeVisible();
  await expect(page.getByText("No requests found")).toBeVisible();
});

test("published snapshot wording does not claim player receipt", async ({ page }) => {
  const state = await setup(page, reader, { published: true, snapshotFails: true });
  await page.goto("/schedule");
  await page.getByRole("tab", { name: "Published 1" }).click();
  await page.getByRole("button", { name: "Open Morning briefing request details" }).click();
  await expect(page.getByText("This does not confirm the player received or displayed it.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry snapshot" })).toBeVisible();
  state.restoreSnapshot();
  await page.getByRole("button", { name: "Retry snapshot" }).click();
  await expect(page.getByText("No schedule items were returned for this device.")).toBeVisible();
});

test("queue controls and detail remain within phone, tablet and desktop widths", async ({ page }) => {
  await setup(page, creator);
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/schedule");
    await expect(page.getByRole("button", { name: "Open Morning briefing request details" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width !== 820) await page.screenshot({ path: `../qa-artifacts/evidence/product-ui-schedule-queue/${width}-list.png`, fullPage: true });
    if (width === 390) {
      await page.getByRole("button", { name: "Filters" }).click();
      await expect(page.getByLabel("From")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: "../qa-artifacts/evidence/product-ui-schedule-queue/390-filters.png", fullPage: true });
    }
  }
});

test("date filters use the displayed local day and reject reversed ranges", async ({ page }) => {
  const state = await setup(page, reader);
  await page.goto("/schedule");
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByLabel("From").fill("2026-11-05");
  await page.getByLabel("To").fill("2026-11-04");
  await expect(page.getByText("The From date must be on or before the To date.")).toBeVisible();
  await expect(page.getByText("Correct the date range to load requests.")).toBeVisible();
  await page.getByLabel("To").fill("2026-11-06");
  const expectedStart = await page.evaluate(() => new Date("2026-11-05T00:00:00.000").toISOString());
  await expect.poll(() => state.requests.find((request) => request.startsWith("GET /api/v1/schedule-requests?") && new URL(request, origin).searchParams.get("date_from") === expectedStart)).toBeTruthy();
});
