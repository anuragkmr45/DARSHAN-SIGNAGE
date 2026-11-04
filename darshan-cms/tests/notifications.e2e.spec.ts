import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { OPERATOR_TEST_ROLE_ID, testAuthorization } from "./helpers/selfAuthorization";

async function setupNotifications(page: Page, context: BrowserContext) {
  const origin = "http://127.0.0.1:5173";
  const user = {
    id: "fe171dd2-226a-4228-91d8-597e9d4658d4", email: "qa@example.invalid", first_name: "QA", last_name: "Operator",
    role_id: OPERATOR_TEST_ROLE_ID, role: "OPERATOR", department_id: null,
  };
  const items = Array.from({ length: 55 }, (_value, index) => ({
    id: `notification-${index + 1}`,
    title: index === 54 ? "New thread reply" : index === 53 ? "You were mentioned" : `System event ${index + 1}`,
    message: `Useful event detail ${index + 1}`,
    type: index === 54 ? "THREAD_REPLY" : index === 53 ? "MENTION" : "INFO",
    data: index === 54 ? {
      conversationId: "conv-thread",
      messageId: "reply-55",
      threadRootId: "root-55",
      notificationType: "THREAD_REPLY",
      snippet: "Thread reply detail",
    } : index === 53 ? {
      conversationId: "conv-mention",
      messageId: "mention-54",
      notificationType: "MENTION",
      snippet: "Hello @fe171dd2-226a-4228-91d8-597e9d4658d4",
    } : null,
    read: false,
    read_at: null,
    created_at: new Date(Date.UTC(2026, 10, 3, 1, 0, index)).toISOString(),
  }));

  await context.addCookies([
    { name: "access_token", value: "qa-session", url: origin, httpOnly: true, sameSite: "Lax" },
    { name: "csrf_token", value: "qa-csrf", url: origin, sameSite: "Lax" },
  ]);
  await page.route("**/config/app-config.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ cms: {
      environment: { name: "development", deploymentId: "qa", cmsId: "qa" },
      api: { baseUrl: new URL(route.request().url()).origin },
      realtime: { socketBaseUrl: new URL(route.request().url()).origin, socketTransports: ["websocket"] },
    } }),
  }));
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const json = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/v1/auth/me") return json(user);
    if (path === "/api/v1/auth/authorization") return json(testAuthorization(user, [
      { action: "read", subject: "Notification" },
      { action: "read", subject: "Conversation" },
    ], { roleId: OPERATOR_TEST_ROLE_ID }));
    if (path === "/api/v1/roles") return json({ items: [{ id: "qa-role", name: "OPERATOR", permissions: { inherits: [], grants: [{ action: "read", subject: "Notification" }, { action: "read", subject: "Conversation" }] } }], page: 1, limit: 100, total: 1 });
    if (path === "/api/v1/notifications/unread-count") return json({ unread_total: items.filter((item) => !item.read).length });
    if (path === "/api/v1/notifications" && method === "GET") {
      const read = url.searchParams.get("read");
      const filtered = items.filter((item) => read === null || String(item.read) === read);
      const pageNumber = Number(url.searchParams.get("page") || 1);
      const limit = Number(url.searchParams.get("limit") || 50);
      return json({ items: filtered.slice((pageNumber - 1) * limit, pageNumber * limit), pagination: {
        page: pageNumber, limit, total: filtered.length, unread_total: items.filter((item) => !item.read).length,
      } });
    }
    const markRead = path.match(/^\/api\/v1\/notifications\/(notification-\d+)\/read$/);
    if (markRead && method === "POST") {
      const item = items.find((entry) => entry.id === markRead[1]);
      if (item) item.read = true;
      return json(item);
    }
    if (path === "/api/v1/notifications/read-all" && method === "POST") {
      items.forEach((item) => { item.read = true; });
      return json({ success: true });
    }
    return json({});
  });

  return { items };
}

test("notification totals, older pages, and non-chat read action use server data", async ({ page, context }) => {
  await setupNotifications(page, context);
  await page.goto("/notifications");
  await expect(page.getByRole("tab", { name: "Unread (55)" })).toBeVisible();
  await expect(page.getByText("Page 1 of 2 · 55 notifications")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Page 2 of 2 · 55 notifications")).toBeVisible();
  await expect(page.getByText("Useful event detail 51")).toBeVisible();
  await expect(page.getByText("Hello @you")).toBeVisible();
  await page.getByRole("article").filter({ hasText: "System event 51" }).getByRole("button", { name: "Mark read" }).click();
  await expect(page.getByRole("tab", { name: "Unread (54)" })).toBeVisible();
  await expect(page).toHaveURL(/\/notifications$/);
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(page.getByRole("tab", { name: "Unread (0)" })).toBeVisible();
  await page.getByRole("article").filter({ hasText: "New thread reply" }).getByRole("button", { name: "Open conversation" }).click();
  await expect(page).toHaveURL(/\/chat\/conv-thread\/thread\/root-55\?focusReplyId=reply-55$/);
});

test("failed list remains an error until Retry succeeds", async ({ page, context }) => {
  await setupNotifications(page, context);
  let unavailable = true;
  await page.route("**/api/v1/notifications?**", (route) => {
    if (unavailable) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) });
    return route.fallback();
  });
  await page.goto("/notifications");
  await expect(page.getByText("Could not load notifications")).toBeVisible();
  await expect(page.getByText("No notifications yet")).toHaveCount(0);
  unavailable = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "System event 1", exact: true })).toBeVisible();
});

test("failed read action remains retryable and a chat link still opens", async ({ page, context }) => {
  await setupNotifications(page, context);
  let unavailable = true;
  await page.route("**/api/v1/notifications/notification-1/read", (route) => {
    if (unavailable) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) });
    return route.fallback();
  });
  await page.goto("/notifications");
  const event = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "System event 1", exact: true }) });
  await event.getByRole("button", { name: "Mark read" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Could not mark this notification read" })).toBeVisible();
  await expect(event.getByText("Unread")).toBeVisible();
  unavailable = false;
  await event.getByRole("button", { name: "Mark read" }).click();
  await expect(event.getByText("Read", { exact: true })).toBeVisible();

  await page.route("**/api/v1/notifications/notification-55/read", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) }));
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("article").filter({ hasText: "New thread reply" }).getByRole("button", { name: "Open conversation" }).click();
  await expect(page).toHaveURL(/\/chat\/conv-thread\/thread\/root-55/);
  await expect(page.getByText("Notification still unread", { exact: true })).toBeVisible();
});

test("mark all failure is visible and unread filter recovers to its first page", async ({ page, context }) => {
  await setupNotifications(page, context);
  let unavailable = true;
  await page.route("**/api/v1/notifications/read-all", (route) => {
    if (unavailable) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) });
    return route.fallback();
  });
  await page.goto("/notifications");
  await page.getByRole("tab", { name: "Unread (55)" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Could not mark all notifications read" })).toBeVisible();
  await expect(page.getByText("Page 2 of 2 · 55 notifications")).toBeVisible();
  unavailable = false;
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(page.getByText("You're all caught up")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Unread (0)" })).toBeVisible();
});

test("row-derived unread count wins when the separate counter is stale", async ({ page, context }) => {
  await setupNotifications(page, context);
  await page.route("**/api/v1/notifications/unread-count", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ unread_total: 0 }),
  }));
  await page.goto("/notifications");
  await expect(page.getByRole("tab", { name: "Unread (55)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark all read" })).toBeEnabled();
});

test("notification list stays usable at phone, tablet, and desktop widths", async ({ page, context }, testInfo) => {
  await setupNotifications(page, context);
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "System event 1", exact: true })).toBeVisible();
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await expect(page.getByRole("article").first().getByRole("button", { name: "Mark read" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`notifications-${width}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(() => window.localStorage.setItem("theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("notifications-dark-390.png") });
});
