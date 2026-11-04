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

async function setup(page: Page, grants: TestCapability[], options: { listFails?: boolean; summaryFailsAfterSearch?: boolean; snapshotFails?: boolean; published?: boolean; initialStatus?: "APPROVED"; secondRequest?: boolean; holdPreflight?: boolean; targetMode?: "group" | "mixed"; groupFails?: boolean; approveFails?: boolean; approveCommitsBeforeFailure?: boolean; publishFails?: boolean; takeDownFails?: boolean; cancelFails?: boolean; cancelCommitsBeforeFailure?: boolean } = {}) {
  let listFails = Boolean(options.listFails);
  let snapshotFails = Boolean(options.snapshotFails);
  let groupFails = Boolean(options.groupFails);
  let approveFails = Boolean(options.approveFails);
  let publishFails = Boolean(options.publishFails);
  let takeDownFails = Boolean(options.takeDownFails);
  let cancelFails = Boolean(options.cancelFails);
  let currentStatus = options.initialStatus ?? (options.published ? "PUBLISHED" : "PENDING");
  let releasePreflight: (() => void) | undefined;
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
  await page.route("**/api/v1/**", async (route) => {
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
      const first = (status: string) => Number(currentStatus === status);
      const second = (status: string) => Number(Boolean(options.secondRequest && status === "APPROVED"));
      return json({ counts: { pending: first("PENDING"), approved: first("APPROVED") + second("APPROVED"), rejected: 0, cancelled: first("CANCELLED"), published: first("PUBLISHED"), taken_down: first("TAKEN_DOWN"), expired: 0 } });
    }
    if (path === "/api/v1/schedule-requests" && method === "GET") {
      if (listFails) return json({ error: { message: "Unavailable" } }, 503);
      const status = url.searchParams.get("status");
      const q = url.searchParams.get("q");
      const group = { id: "00000000-0000-4000-8000-000000000504", name: "East wing" };
      const items: Record<string, unknown>[] = status === currentStatus && !q
        ? [{ ...requestItem, status: currentStatus,
          screens: options.targetMode === "group" ? [] : options.targetMode === "mixed"
            ? [...requestItem.screens, { id: "00000000-0000-4000-8000-000000000505", name: "Reception screen" }] : requestItem.screens,
          screen_groups: options.targetMode ? [group] : [],
        }] : [];
      if (options.secondRequest && status === "APPROVED" && !q) items.push({ ...requestItem, id: "00000000-0000-4000-8000-000000000508", status: "APPROVED", schedule: { ...requestItem.schedule, name: "Evening briefing" } });
      return json({ items, pagination: { page: 1, limit: 10, total: items.length } });
    }
    if (path === `/api/v1/schedule-requests/${requestItem.id}` && method === "GET") return json({ ...requestItem, status: currentStatus });
    if (path === "/api/v1/schedules/display-preflight" && method === "POST") {
      if (options.holdPreflight) await new Promise<void>((resolve) => { releasePreflight = resolve; });
      return json({ compatible: true, issues: [] });
    }
    if (path === `/api/v1/schedule-requests/${requestItem.id}/approve` && method === "POST") {
      if (approveFails) {
        if (options.approveCommitsBeforeFailure) currentStatus = "APPROVED";
        return json({ error: { message: "Service unavailable" } }, 503);
      }
      currentStatus = "APPROVED";
      return json({ id: requestItem.id, status: currentStatus });
    }
    if (path === `/api/v1/schedule-requests/${requestItem.id}/publish` && method === "POST") {
      if (publishFails) return json({ error: { message: "Service unavailable" } }, 503);
      currentStatus = "PUBLISHED";
      return json({ id: requestItem.id, status: currentStatus });
    }
    if (path === `/api/v1/schedule-requests/${requestItem.id}/cancel` && method === "POST") {
      if (cancelFails) {
        if (options.cancelCommitsBeforeFailure) currentStatus = "CANCELLED";
        return json({ error: { message: "Service unavailable" } }, 503);
      }
      currentStatus = "CANCELLED";
      return json({ id: requestItem.id, status: currentStatus, reservation_summary: { state: "CANCELLED" } });
    }
    if (path === `/api/v1/schedule-requests/${requestItem.id}/take-down` && method === "POST") {
      if (takeDownFails) return json({ error: { message: "Service unavailable" } }, 503);
      currentStatus = "TAKEN_DOWN";
      return json({ id: requestItem.id, status: currentStatus });
    }
    if (path === "/api/v1/screen-groups/00000000-0000-4000-8000-000000000504" && method === "GET") return groupFails
      ? json({ error: { message: "Unavailable" } }, 503)
      : json({ id: "00000000-0000-4000-8000-000000000504", name: "East wing", screen_ids: [
        "00000000-0000-4000-8000-000000000506", "00000000-0000-4000-8000-000000000507",
      ] });
    if (path.includes("/snapshot") && method === "GET") return snapshotFails
      ? json({ error: { message: "Unavailable" } }, 503)
      : json({ snapshot: { schedule: { id: requestItem.schedule.id, items: [] } }, publish: null, media_urls: {}, media_assets: {} });
    return json({});
  });
  return { requests, restoreList: () => { listFails = false; }, restoreSnapshot: () => { snapshotFails = false; }, restoreGroup: () => { groupFails = false; }, restoreApproval: () => { approveFails = false; }, restorePublish: () => { publishFails = false; }, restoreTakeDown: () => { takeDownFails = false; }, restoreCancel: () => { cancelFails = false; }, releasePreflight: () => releasePreflight?.() };
}

test("pending request can be withdrawn only with update permission and a confirmation", async ({ page }) => {
  const state = await setup(page, [...reader, { action: "update", subject: "ScheduleRequest" }]);
  await page.goto("/schedule");
  await page.getByRole("button", { name: "Open Morning briefing request details" }).click();
  await page.getByRole("button", { name: "Cancel Request" }).click();
  const dialog = page.getByRole("dialog", { name: "Cancel request" });
  await expect(dialog.getByText("held screen time", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Keep request" }).click();
  expect(state.requests.filter(request => request.endsWith("/cancel") && request.startsWith("POST "))).toHaveLength(0);
  await page.getByRole("button", { name: "Cancel Request" }).click();
  await dialog.getByRole("button", { name: "Cancel request" }).click();
  await expect(page.getByRole("tab", { name: "Pending 0" })).toBeVisible();
  await page.getByRole("tab", { name: "Cancelled 1" }).click();
  await expect(page.getByRole("button", { name: "Open Morning briefing request details" })).toBeVisible();
  expect(state.requests.filter(request => request.endsWith("/cancel") && request.startsWith("POST "))).toHaveLength(1);
});

test("approved request remains available in Cancelled history after withdrawal", async ({ page }) => {
  await setup(page, [...reader, { action: "update", subject: "ScheduleRequest" }], { initialStatus: "APPROVED" });
  await page.goto("/schedule");
  await page.getByRole("tab", { name: "Approved 1" }).click();
  await page.getByRole("button", { name: "Open Morning briefing request details" }).click();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel Request" }).click();
  await page.getByRole("dialog", { name: "Cancel request" }).getByRole("button", { name: "Cancel request" }).click();
  await page.getByRole("tab", { name: "Cancelled 1" }).click();
  await expect(page.getByRole("button", { name: "Open Morning briefing request details" })).toBeVisible();
});

test("cancel uncertainty requires a reload and does not automatically send a second write", async ({ page }) => {
  const state = await setup(page, [...reader, { action: "update", subject: "ScheduleRequest" }], { cancelFails: true, cancelCommitsBeforeFailure: true });
  await page.goto("/schedule");
  await page.getByRole("button", { name: "Open Morning briefing request details" }).click();
  await page.getByRole("button", { name: "Cancel Request" }).click();
  await page.getByRole("dialog", { name: "Cancel request" }).getByRole("button", { name: "Cancel request" }).click();
  await expect(page.getByText("The server may have completed the action.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Reload request" }).last().click();
  await expect(page.getByRole("button", { name: "Cancel Request" })).toHaveCount(0);
  expect(state.requests.filter(request => request.endsWith("/cancel") && request.startsWith("POST "))).toHaveLength(1);
});

test("a changed search hides old rows before the debounced result arrives", async ({ page }) => {
  await setup(page, [...reader, { action: "update", subject: "ScheduleRequest" }]);
  await page.goto("/schedule");
  const row = page.getByRole("button", { name: "Open Morning briefing request details" });
  await row.waitFor();
  await page.getByLabel("Search schedule requests").fill("missing");
  await expect(page.getByRole("status").getByText("Updating requests…")).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect(page.getByText("No requests found")).toBeVisible();
});

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
  await expect(page.getByRole("button", { name: "Cancel Request" })).toHaveCount(0);
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

test("group-only publish chooses a current member and recovers from a failed membership request", async ({ page }) => {
  const state = await setup(page, [...reader, { action: "read", subject: "ScreenGroup" }], { published: true, targetMode: "group", groupFails: true });
  await page.goto("/schedule");
  await page.getByRole("tab", { name: "Published 1" }).click();
  await page.getByRole("button", { name: "Open Morning briefing request details" }).click();
  await expect(page.getByText("Could not load the group's current members.")).toBeVisible();
  expect(state.requests.some((request) => request.includes("/device/") && request.includes("/snapshot"))).toBe(false);
  state.restoreGroup();
  await page.getByRole("button", { name: "Retry group members" }).click();
  await expect(page.getByText("Group membership is current", { exact: false })).toBeVisible();
  expect(state.requests.some((request) => request.includes("/device/") && request.includes("/snapshot"))).toBe(false);
  await page.getByRole("combobox", { name: "Choose group Screen" }).click();
  await page.getByRole("option", { name: "Screen ···00000507" }).click();
  await expect.poll(() => state.requests.some((request) => request.includes("/device/00000000-0000-4000-8000-000000000507/snapshot"))).toBe(true);
});

test("multi-target publish requires a target and never silently chooses the first Screen", async ({ page }) => {
  const state = await setup(page, [...reader, { action: "read", subject: "ScreenGroup" }], { published: true, targetMode: "mixed" });
  await page.goto("/schedule");
  await page.getByRole("tab", { name: "Published 1" }).click();
  await page.getByRole("button", { name: "Open Morning briefing request details" }).click();
  await expect(page.getByText("Choose a Screen above to inspect its current backend snapshot.")).toBeVisible();
  expect(state.requests.some((request) => request.includes("/device/") && request.includes("/snapshot"))).toBe(false);
  await page.getByRole("combobox", { name: "Choose snapshot target" }).click();
  await page.getByRole("option", { name: "Screen: Reception screen" }).click();
  await expect.poll(() => state.requests.some((request) => request.includes("/device/00000000-0000-4000-8000-000000000505/snapshot"))).toBe(true);
  await page.getByRole("combobox", { name: "Choose snapshot target" }).click();
  await page.getByRole("option", { name: "Group: East wing" }).click();
  await expect(page.getByText("Group membership is current", { exact: false })).toBeVisible();
  await expect(page.getByText("Choose a Screen above to inspect its current backend snapshot.")).toBeVisible();
  await page.getByRole("combobox", { name: "Choose group Screen" }).click();
  await page.getByRole("option", { name: "Screen ···00000506" }).click();
  await expect.poll(() => state.requests.some((request) => request.includes("/device/00000000-0000-4000-8000-000000000506/snapshot"))).toBe(true);
});

test("a request reader without Screen Group access sees no group membership", async ({ page }) => {
  const state = await setup(page, reader, { published: true, targetMode: "group" });
  await page.goto("/schedule");
  await page.getByRole("tab", { name: "Published 1" }).click();
  await page.getByRole("button", { name: "Open Morning briefing request details" }).click();
  await expect(page.getByText("Screen Group access is needed to inspect its current members.")).toBeVisible();
  expect(state.requests.some((request) => request.includes("/screen-groups/") || request.includes("/device/"))).toBe(false);
});

test("failed approval is sent once and keeps its note until the operator reloads", async ({ page }) => {
  const state = await setup(page, [...reader, { action: "approve", subject: "ScheduleRequest" }], { approveFails: true });
  await page.goto("/schedule");
  await page.getByRole("button", { name: "Open Morning briefing request details" }).click();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByPlaceholder("Add a note for this action").fill("Reviewed with facilities");
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("The server may have completed the action.", { exact: false })).toBeVisible();
  await expect(page.getByPlaceholder("Add a note for this action")).toHaveValue("Reviewed with facilities");
  await expect(page.getByRole("button", { name: "Confirm" })).toBeDisabled();
  await page.waitForTimeout(1300);
  expect(state.requests.filter((request) => request.endsWith("/approve") && request.startsWith("POST "))).toHaveLength(1);
  state.restoreApproval();
  await page.getByRole("button", { name: "Reload request" }).last().click();
  await expect(page.getByRole("dialog", { name: "Approve request" })).toHaveCount(0);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect.poll(() => state.requests.filter((request) => request.endsWith("/approve") && request.startsWith("POST ")).length).toBe(2);
});

test("lost approval response after commit resolves to Approved without repeating the write", async ({ page }) => {
  const state = await setup(page, [...reader, { action: "approve", subject: "ScheduleRequest" }], { approveFails: true, approveCommitsBeforeFailure: true });
  await page.goto("/schedule");
  await page.getByRole("button", { name: "Open Morning briefing request details" }).click();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("The server may have completed the action.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Reload request" }).last().click();
  await page.getByRole("tab", { name: "Approved 1" }).click();
  await expect(page.getByRole("button", { name: "Open Morning briefing request details" })).toBeVisible();
  expect(state.requests.filter((request) => request.endsWith("/approve") && request.startsWith("POST "))).toHaveLength(1);
});

test("approve then publish failure does not repeat approval and can publish from Approved", async ({ page }) => {
  const state = await setup(page, [...reader, { action: "approve", subject: "ScheduleRequest" }, { action: "publish", subject: "ScheduleRequest" }], { publishFails: true });
  await page.goto("/schedule");
  await page.getByRole("button", { name: "Open Morning briefing request details" }).click();
  await page.getByRole("button", { name: "Approve & Publish" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByLabel("Notifications (F8)").getByText("Approval was saved, but publishing failed.", { exact: false })).toBeVisible();
  await page.waitForTimeout(1300);
  expect(state.requests.filter((request) => request.endsWith("/approve") && request.startsWith("POST "))).toHaveLength(1);
  expect(state.requests.filter((request) => request.endsWith("/publish") && request.startsWith("POST "))).toHaveLength(1);
  state.restorePublish();
  await page.getByRole("tab", { name: "Approved 1" }).click();
  await page.getByRole("button", { name: "Open Morning briefing request details" }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect.poll(() => state.requests.filter((request) => request.endsWith("/publish") && request.startsWith("POST ")).length).toBe(2);
  expect(state.requests.filter((request) => request.endsWith("/approve") && request.startsWith("POST "))).toHaveLength(1);
});

test("take-down failure is sent once and requires reload before retry", async ({ page }) => {
  const state = await setup(page, [...reader, { action: "publish", subject: "ScheduleRequest" }], { published: true, takeDownFails: true });
  await page.goto("/schedule");
  await page.getByRole("tab", { name: "Published 1" }).click();
  await page.getByRole("button", { name: "Open Morning briefing request details" }).click();
  await page.getByRole("button", { name: "Take Down Schedule" }).click();
  await page.getByPlaceholder("Add an optional takedown note").fill("Window cancelled");
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("The server may have completed the action.", { exact: false })).toBeVisible();
  await expect(page.getByPlaceholder("Add an optional takedown note")).toHaveValue("Window cancelled");
  await page.waitForTimeout(1300);
  expect(state.requests.filter((request) => request.endsWith("/take-down") && request.startsWith("POST "))).toHaveLength(1);
  state.restoreTakeDown();
  await page.getByRole("button", { name: "Reload request" }).last().click();
  await page.getByRole("button", { name: "Take Down Schedule" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect.poll(() => state.requests.filter((request) => request.endsWith("/take-down") && request.startsWith("POST ")).length).toBe(2);
});

test("a late display preflight cannot publish a request after the operator selects another", async ({ page }) => {
  const state = await setup(page, [...reader, { action: "publish", subject: "ScheduleRequest" }], { initialStatus: "APPROVED", secondRequest: true, holdPreflight: true });
  await page.goto("/schedule");
  await page.getByRole("tab", { name: "Approved 2" }).click();
  await page.getByRole("button", { name: "Open Morning briefing request details" }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect.poll(() => state.requests.some((request) => request === "POST /api/v1/schedules/display-preflight")).toBe(true);
  await page.getByRole("button", { name: "Open Evening briefing request details" }).click();
  await expect(page.getByRole("heading", { name: "Evening briefing", level: 2 })).toBeVisible();
  state.releasePreflight();
  await page.waitForTimeout(300);
  expect(state.requests.some((request) => request.endsWith("/publish") && request.startsWith("POST "))).toBe(false);
  await expect(page.getByRole("dialog", { name: "Confirm letterboxing" })).toHaveCount(0);
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
  await page.getByLabel("To", { exact: true }).fill("2026-11-04");
  await expect(page.getByText("The From date must be on or before the To date.")).toBeVisible();
  await expect(page.getByText("Correct the date range to load requests.")).toBeVisible();
  await page.getByLabel("To", { exact: true }).fill("2026-11-06");
  const expectedStart = await page.evaluate(() => new Date("2026-11-05T00:00:00.000").toISOString());
  await expect.poll(() => state.requests.find((request) => request.startsWith("GET /api/v1/schedule-requests?") && new URL(request, origin).searchParams.get("date_from") === expectedStart)).toBeTruthy();
});
