import { expect, test } from "@playwright/test";

test("notification totals, older pages, and non-chat read action use server data", async ({ page, context }) => {
  const origin = "http://127.0.0.1:5173";
  const user = {
    id: "qa-user", email: "qa@example.invalid", first_name: "QA", last_name: "Operator",
    role_id: "qa-role", role: "OPERATOR", department_id: null,
  };
  const items = Array.from({ length: 55 }, (_value, index) => ({
    id: `notification-${index + 1}`,
    title: `System event ${index + 1}`,
    message: `Useful event detail ${index + 1}`,
    type: "INFO",
    data: null,
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
    if (path === "/api/v1/roles") return json({ items: [{ id: "qa-role", name: "OPERATOR", permissions: { inherits: [], grants: [{ action: "read", subject: "Notification" }] } }], page: 1, limit: 100, total: 1 });
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

  await page.goto("/notifications");
  await expect(page.getByRole("tab", { name: "Unread (55)" })).toBeVisible();
  await expect(page.getByText("Page 1 of 2 · 55 notifications")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Page 2 of 2 · 55 notifications")).toBeVisible();
  await expect(page.getByText("Useful event detail 51")).toBeVisible();
  await page.getByRole("button", { name: /System event 51/ }).click();
  await expect(page.getByRole("tab", { name: "Unread (54)" })).toBeVisible();
  await expect(page).toHaveURL(/\/notifications$/);
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(page.getByRole("tab", { name: "Unread (0)" })).toBeVisible();
});
