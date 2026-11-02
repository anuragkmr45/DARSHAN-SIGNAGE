import { expect, test, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pdfBytes = readFileSync(resolve(process.cwd(), "tests/fixtures/preview-two-pages.pdf"));
const origin = process.env.E2E_BASE_URL || "http://127.0.0.1:5173";
const adminUser = {
  id: "admin-user-id",
  email: "admin@darshan.local",
  first_name: "Admin",
  last_name: "User",
  role_id: "role-admin",
  role: "ADMIN",
};
const document = (fresh: boolean) => ({
  id: "document-1",
  filename: "Quarterly report",
  name: "Quarterly report",
  type: "DOCUMENT",
  status: "READY",
  source_content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  content_type: "application/pdf",
  page_count: 2,
  media_url: `${origin}/media-ready/${fresh ? "fresh" : "list"}.pdf`,
});

test("document cards and the detail modal show the original format and a navigable PDF preview", async ({ page }) => {
  let freshLinkRequests = 0;
  await page.route("**/media-ready/**", async (route: Route) => {
    if (route.request().url().includes("/fresh.pdf")) freshLinkRequests += 1;
    await route.fulfill({ status: 200, contentType: "application/pdf", body: pdfBytes });
  });
  await page.route("**/api/v1/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === "/api/v1/auth/login" && method === "POST") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "cms-token", csrf_token: "csrf-token", user: adminUser }) });
    }
    if (url.pathname === "/api/v1/roles" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ id: "role-admin", name: "ADMIN", permissions: { inherits: [], grants: [{ action: "manage", subject: "all" }] }, is_system: true }], page: 1, limit: 100, total: 1 }) });
    }
    if (url.pathname === "/api/v1/notifications/unread-count" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ unread_total: 0 }) });
    }
    if (url.pathname === "/api/v1/media/document-1" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(document(true)) });
    }
    if (url.pathname === "/api/v1/media" && method === "GET") {
      const type = url.searchParams.get("type");
      const items = !type || type === "DOCUMENT" ? [document(false)] : [];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, page: 1, limit: Number(url.searchParams.get("limit") || 6), total: items.length }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });

  await page.goto("/login");
  await page.fill("#login-email", adminUser.email);
  await page.fill("#login-password", "LocalDev@123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
  await page.goto("/media");
  await page.getByRole("tab", { name: /Documents/ }).click();

  const card = page.getByText("Quarterly report", { exact: true }).first().locator('xpath=ancestor::*[contains(@class,"cursor-pointer")][1]');
  await expect(card.getByText("DOCX", { exact: true })).toBeVisible();
  await expect(card.getByText("Original format: Word (.docx)")).toBeVisible();
  await expect(card.locator("canvas")).toHaveCSS("opacity", "1", { timeout: 15_000 });

  await card.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Converted to PDF for screen playback")).toBeVisible();
  await expect(dialog.locator("canvas")).toHaveCSS("opacity", "1", { timeout: 15_000 });
  await expect(dialog.getByText("Page 1 of 2")).toBeVisible();
  const firstPage = await dialog.locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await dialog.getByRole("button", { name: "Next page" }).click();
  await expect(dialog.getByText("Page 2 of 2")).toBeVisible();
  await expect.poll(() => dialog.locator("canvas").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(firstPage);
  expect(freshLinkRequests).toBeGreaterThan(0);
});
