import { expect, test, type Page } from "@playwright/test";
import { ADMIN_TEST_ROLE_ID, ADMIN_TEST_USER_ID, testAuthorization, type TestCapability } from "./helpers/selfAuthorization";

const origin = "http://127.0.0.1:5173";
const actor = { id: ADMIN_TEST_USER_ID, email: "live@example.invalid", role_id: ADMIN_TEST_ROLE_ID, role: "CUSTOM", department_id: null };
const sourceId = "00000000-0000-4000-8000-000000000701";
const source = {
  id: sourceId, name: "Morning assembly", description: "Presenter shares the approved event window.",
  presenter_user_id: actor.id, microphone: false, screen_share_audio: false, is_active: true, revision: 1,
  policy_revision: 1, created_by: actor.id, owner_scope: "ORGANIZATION", owner_department_id: null,
  ownership: { scope: "ORGANIZATION", department_id: null, department_name: null,
    creator: { id: actor.id, display_name: "Live operator", status: "ACTIVE" } },
  permissions: { can_update: true, can_delete: true },
  created_at: "2026-11-04T08:00:00.000Z", updated_at: "2026-11-04T08:00:00.000Z",
};
const read: TestCapability[] = [{ action: "read", subject: "LiveBroadcast" }];
const author: TestCapability[] = [
  ...read, { action: "create", subject: "LiveBroadcast" },
  { action: "read", subject: "Schedule" }, { action: "read", subject: "Presentation" },
  { action: "read", subject: "Media" }, { action: "read", subject: "Screen" },
  { action: "create", subject: "Schedule" }, { action: "create", subject: "ScheduleItem" },
  { action: "create", subject: "ScheduleRequest" },
];

async function setup(page: Page, grants: TestCapability[], options: { failList?: boolean; occurrenceTotal?: number } = {}) {
  let failList = Boolean(options.failList);
  const requests: string[] = [];
  await page.context().addCookies([
    { name: "access_token", value: "live-ui-qa-session", url: origin, httpOnly: true, sameSite: "Lax" },
    { name: "csrf_token", value: "live-ui-qa-csrf", url: origin, sameSite: "Lax" },
  ]);
  await page.route("**/config/app-config.json", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ cms: {
    environment: { name: "development", deploymentId: "qa", cmsId: "qa" },
    api: { baseUrl: new URL(route.request().url()).origin },
    realtime: { socketBaseUrl: new URL(route.request().url()).origin, socketTransports: ["websocket"] },
  } }) }));
  await page.route("**/api/v1/**", route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
    requests.push(`${method} ${path}`);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/v1/auth/me") return json(actor);
    if (path === "/api/v1/auth/authorization") return json(testAuthorization(actor, grants));
    if (path === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    if (path === "/api/v1/settings/branding") return json({ app_name: "DARSHAN CMS" });
    if (path === "/api/v1/live-authority-epoch" && method === "POST") return json({ version: 1,
      nonce: JSON.parse(route.request().postData() ?? "{}").nonce, epoch_id: "00000000-0000-4000-8000-000000000702", server_now: "2026-11-04T09:00:00.000Z" });
    if (path === "/api/v1/live-occurrences") return json({ items: options.occurrenceTotal ? [{
      id: "00000000-0000-4000-8000-000000000703", publish_id: "00000000-0000-4000-8000-000000000704",
      schedule_item_id: "00000000-0000-4000-8000-000000000705", live_session_id: sourceId,
      start_at: "2026-11-04T08:00:00.000Z", end_at: "2026-11-04T10:00:00.000Z",
      control_revision: 1, enabled: true, item_fingerprint: "a".repeat(64), presenter_user_id: actor.id,
      microphone: false, screen_share_audio: false, screen_ids: ["00000000-0000-4000-8000-000000000706"],
      run: null, can_start: false, can_stop: false, can_manage: false,
    }] : [], total: options.occurrenceTotal ?? 0, page: 1, page_size: 25,
      from: url.searchParams.get("from"), until: url.searchParams.get("until") });
    if (path === "/api/v1/live-sessions" && method === "GET") return failList
      ? json({ error: { message: "Unavailable" } }, 503)
      : json({ items: [source], pagination: { page: 1, limit: 9, total: 1, pages: 1 } });
    if (path === `/api/v1/live-sessions/${sourceId}` && method === "GET") return json(source);
    if (path === "/api/v1/presentations") return json({ items: [], total: 0, page: 1, limit: 100 });
    return json({});
  });
  return { requests, restoreList: () => { failList = false; } };
}

test("author sees schedule as the primary task and source creation as secondary", async ({ page }) => {
  const state = await setup(page, author);
  await page.goto("/live-broadcasts");
  await expect(page.getByRole("heading", { name: "Live broadcasts" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Live source library" }).getByRole("article", { name: "Live source Morning assembly" })).toBeVisible();
  await page.getByRole("button", { name: "Schedule live event" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Schedule live event" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "New live source" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Create live source" })).toBeVisible();
  expect(state.requests.filter(request => request.startsWith("POST ")).every(request => request === "POST /api/v1/live-authority-epoch")).toBe(true);
});

test("source-list failure offers Retry and never claims an empty library", async ({ page }) => {
  const state = await setup(page, read, { failList: true });
  await page.goto("/live-broadcasts");
  await expect(page.getByRole("button", { name: "Retry live sources" })).toBeVisible();
  await expect(page.getByText("No live sources found")).toHaveCount(0);
  state.restoreList();
  await page.getByRole("button", { name: "Retry live sources" }).click();
  await expect(page.getByRole("article", { name: "Live source Morning assembly" })).toBeVisible();
  await page.getByRole("button", { name: "View Morning assembly" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Live source details" })).toBeVisible();
  expect(state.requests.some(request => request.startsWith("PATCH ") || request.startsWith("DELETE "))).toBe(false);
});

test("source rows and tasks fit phone, tablet, and desktop widths", async ({ page }) => {
  await setup(page, author);
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/live-broadcasts");
    await expect(page.getByRole("article", { name: "Live source Morning assembly" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `../qa-artifacts/evidence/product-ui-live-page/live-${width}.png`, fullPage: true });
  }
});

test("multi-page runtime navigation wraps within a phone viewport", async ({ page }) => {
  await setup(page, read, { occurrenceTotal: 26 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/live-broadcasts");
  await expect(page.getByRole("button", { name: "Next live page" })).toBeVisible();
  const controls = await page.getByRole("button", { name: "Next live page" }).boundingBox();
  expect(controls).not.toBeNull();
  expect(controls!.x + controls!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "../qa-artifacts/evidence/product-ui-live-page/live-runtime-pagination-390.png", fullPage: true });
});
