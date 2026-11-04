import { expect, test, type Page } from "@playwright/test";
import { ADMIN_TEST_ROLE_ID, ADMIN_TEST_USER_ID, testAuthorization, type TestCapability } from "./helpers/selfAuthorization";

const origin = "http://127.0.0.1:5173";
const actor = { id: ADMIN_TEST_USER_ID, email: "live@example.invalid", role_id: ADMIN_TEST_ROLE_ID, role: "CUSTOM", department_id: null };
const sourceId = "00000000-0000-4000-8000-000000000701";
const presentationId = "00000000-0000-4000-8000-000000000708";
const preparationId = "00000000-0000-4000-8000-000000000709";
const screenId = "00000000-0000-4000-8000-000000000710";
const assetId = "00000000-0000-4000-8000-000000000711";
const assetHash = "a".repeat(64);
const fallbackManifest = {
  version: 1, presentation: { id: presentationId, layout: null,
    items: [{ id: "00000000-0000-4000-8000-000000000712", order: 0, asset_id: assetId, duration_seconds: 10 }] },
  assets: [{ id: assetId, media_id: "00000000-0000-4000-8000-000000000713", storage_object_id: "00000000-0000-4000-8000-000000000714",
    bucket: "qa", object_key: "fallback.png", sha256: assetHash, size: 16, content_type: "image/png", render_type: "image",
    representation: "original", cache_key: `live_${assetHash}_image` }],
};
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

async function setup(page: Page, grants: TestCapability[], options: { failList?: boolean; occurrenceTotal?: number; emptySources?: boolean; sourceWriteFails?: boolean; reviewJourney?: boolean } = {}) {
  let failList = Boolean(options.failList);
  const sources = options.emptySources ? [] : [source];
  const requests: string[] = [];
  const reviewBodies: Record<string, unknown>[] = [];
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
      : json({ items: sources, pagination: { page: 1, limit: Number(url.searchParams.get("limit") ?? 9), total: sources.length, pages: 1 } });
    if (path === "/api/v1/live-sessions" && method === "POST") {
      if (options.sourceWriteFails) return json({ error: { message: "Response unavailable" } }, 503);
      const input = JSON.parse(route.request().postData() ?? "{}");
      const created = { ...source, ...input, id: "00000000-0000-4000-8000-000000000707", revision: 1 };
      sources.push(created);
      return json(created, 201);
    }
    if (path.startsWith("/api/v1/live-sessions/") && method === "GET") return json(sources.find(item => path.endsWith(item.id)) ?? source);
    if (options.reviewJourney && path === "/api/v1/presentations") return json({ items: [{ id: presentationId, name: "Emergency slate" }], total: 1, page: 1, limit: 100 });
    if (options.reviewJourney && path === "/api/v1/screens") return json({ items: [{ id: screenId, name: "Lobby screen" }], pagination: { page: 1, limit: 25, total: 1, pages: 1 } });
    if (options.reviewJourney && path === "/api/v1/live-fallback-preparations" && method === "POST") return json({ id: preparationId,
      presentation_id: presentationId, source_fingerprint: "b".repeat(64), state: "READY", failure_code: null, manifest: fallbackManifest,
      dispatch_pending: false, created_at: "2026-11-04T09:00:00.000Z", updated_at: "2026-11-04T09:00:00.000Z" });
    if (options.reviewJourney && path === `/api/v1/live-fallback-preparations/${preparationId}`) return json({ id: preparationId,
      presentation_id: presentationId, source_fingerprint: "b".repeat(64), state: "READY", failure_code: null, manifest: fallbackManifest,
      dispatch_pending: false, created_at: "2026-11-04T09:00:00.000Z", updated_at: "2026-11-04T09:00:00.000Z" });
    if (options.reviewJourney && path === `/api/v1/live-fallback-preparations/${preparationId}/preview`) return json({
      preparation_id: preparationId, presentation_id: presentationId, source_fingerprint: "b".repeat(64),
      checked_at: "2026-11-04T09:00:00.000Z", manifest: fallbackManifest,
      downloads: [{ asset_id: assetId, cache_key: `live_${assetHash}_image`, sha256: assetHash, size: 16,
        content_type: "image/png", url: `${origin}/test-live-image.png`, expires_at: "2026-11-04T09:10:00.000Z" }],
    });
    if (options.reviewJourney && path.endsWith("/review") && path.startsWith("/api/v1/live-schedule-drafts/") && method === "POST") {
      const input = JSON.parse(route.request().postData() ?? "{}"); reviewBodies.push(input);
      return json({ draft_id: path.split("/")[4], draft_revision: 1, can_edit: true,
        schedule_id: "00000000-0000-4000-8000-000000000715", schedule_revision: 1, approval_fingerprint: "c".repeat(64),
        items: [{ version: 1, source_kind: "LIVE", schedule_id: "00000000-0000-4000-8000-000000000715",
          schedule_item_id: "00000000-0000-4000-8000-000000000716", schedule_revision: 1, live_session_id: sourceId,
          presenter_user_id: actor.id, policy_revision: 1, microphone: false, screen_share_audio: false,
          start_at: input.start_at, end_at: input.end_at, priority: input.priority, screen_ids: [screenId], screen_group_ids: [],
          fallback: { preparation_id: preparationId, source_fingerprint: "b".repeat(64), manifest: fallbackManifest } }],
      });
    }
    if (options.reviewJourney && path.endsWith("/submit") && path.startsWith("/api/v1/live-schedule-drafts/") && method === "POST")
      return json({ id: "00000000-0000-4000-8000-000000000717", status: "PENDING" });
    if (path === "/api/v1/presentations") return json({ items: [], total: 0, page: 1, limit: 100 });
    return json({});
  });
  return { requests, reviewBodies, restoreList: () => { failList = false; } };
}

test.describe("live final review", () => {
  test.use({ timezoneId: "Asia/Kolkata" });

  test("shows source, audience and explicit timezone before a single approval submission", async ({ page }) => {
    const state = await setup(page, author, { reviewJourney: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/live-broadcasts");
    await page.getByRole("button", { name: "Schedule live event" }).click();
    const dialog = page.getByRole("dialog", { name: "Schedule live event" });
    await dialog.getByLabel("Live source", { exact: true }).selectOption(sourceId);
    await dialog.getByLabel("Required fallback presentation").selectOption(presentationId);
    await dialog.getByRole("button", { name: "Prepare immutable fallback" }).click();
    await expect(dialog.getByText("READY", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    await dialog.getByRole("checkbox", { name: "Select Lobby screen" }).check();
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    await dialog.locator("#schedule-name").fill("Assembly rehearsal");
    await dialog.locator("#start-at").fill("2026-11-10T14:00");
    await dialog.locator("#end-at").fill("2026-11-10T14:30");
    await dialog.getByRole("button", { name: "Review live event" }).click();
    await expect(dialog.getByText("Time zone: Asia/Kolkata")).toBeVisible();
    await expect(dialog.getByText("Morning assembly", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Emergency slate", { exact: true })).toBeVisible();
    await expect(dialog.getByText("1 distinct approved screen")).toBeVisible();
    await expect(dialog.getByText("Starts Nov 10, 2026, 2:00 PM")).toBeVisible();
    await expect(dialog.getByText("Ends Nov 10, 2026, 2:30 PM")).toBeVisible();
    const summary = dialog.getByRole("region", { name: "Live event review summary" });
    expect(await summary.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await summary.screenshot({ path: "../qa-artifacts/evidence/product-ui-live-page/live-review-summary-390.png" });
    expect(state.reviewBodies).toHaveLength(1);
    expect(state.reviewBodies[0].timezone).toBe("Asia/Kolkata");
    await dialog.getByRole("checkbox", { name: "Acknowledge frozen live review" }).check();
    await dialog.getByRole("button", { name: "Submit live event for approval" }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.requests.filter(request => request.endsWith("/submit") && request.startsWith("POST "))).toHaveLength(1);
  });
});

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

test("an empty source step creates a source and returns to the same event draft", async ({ page }) => {
  const state = await setup(page, author, { emptySources: true });
  await page.goto("/live-broadcasts");
  await page.getByRole("button", { name: "Schedule live event" }).click();
  await expect(page.getByText("No enabled live sources are available.")).toBeVisible();
  await expect(page.getByText("Webpages use their frozen preview image.")).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: "Create live source" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Create live source" })).toBeVisible();
  await page.getByRole("dialog").getByLabel("Source name").fill("QA assembly source");
  await page.getByRole("dialog").getByRole("button", { name: "Create live source" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Schedule live event" })).toBeVisible();
  await expect(page.getByLabel("Live source", { exact: true }).locator("option", { hasText: "QA assembly source" })).toHaveCount(1);
  expect(state.requests.filter(request => request === "POST /api/v1/live-sessions")).toHaveLength(1);
});

test("cancelling source creation returns to the draft with its existing choice", async ({ page }) => {
  const state = await setup(page, author);
  await page.goto("/live-broadcasts");
  await page.getByRole("button", { name: "Schedule live event" }).click();
  await page.getByLabel("Live source", { exact: true }).selectOption(sourceId);
  await page.getByRole("dialog").getByRole("button", { name: "Create live source" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Schedule live event" })).toBeVisible();
  await expect(page.getByLabel("Live source", { exact: true })).toHaveValue(sourceId);
  expect(state.requests.filter(request => request === "POST /api/v1/live-sessions")).toHaveLength(0);
});

test("an uncertain source write returns to the library for verification", async ({ page }) => {
  const state = await setup(page, author, { emptySources: true, sourceWriteFails: true });
  await page.goto("/live-broadcasts");
  await page.getByRole("button", { name: "Schedule live event" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Create live source" }).click();
  await page.getByRole("dialog").getByLabel("Source name").fill("Uncertain QA source");
  await page.getByRole("dialog").getByRole("button", { name: "Create live source" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Close and refresh list" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close and refresh list" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Live source library" })).toBeVisible();
  expect(state.requests.filter(request => request === "POST /api/v1/live-sessions")).toHaveLength(1);
});

test("live wizard keeps Back and Next visible while step content scrolls on compact screens", async ({ page }) => {
  await setup(page, author);
  for (const viewport of [{ width: 390, height: 844 }, { width: 640, height: 360 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/live-broadcasts");
    await page.getByRole("button", { name: "Schedule live event" }).click();
    const dialog = page.getByRole("dialog");
    const next = dialog.getByRole("button", { name: "Next", exact: true });
    const close = dialog.getByRole("button", { name: "Save draft and close" });
    await dialog.getByText("Choose an image, document or video presentation.", { exact: false }).scrollIntoViewIfNeeded();
    for (const action of [next, close]) {
      const box = await action.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    }
    await page.screenshot({ path: `../qa-artifacts/evidence/product-ui-live-page/live-wizard-${viewport.width}x${viewport.height}.png`, fullPage: true });
  }
});
