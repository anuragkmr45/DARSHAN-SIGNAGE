import { expect, test, type Page } from "@playwright/test";
import { ADMIN_TEST_ROLE_ID, ADMIN_TEST_USER_ID, testAuthorization } from "./helpers/selfAuthorization";

const origin = "http://127.0.0.1:5173";
const user = {
  id: ADMIN_TEST_USER_ID, email: "media-qa@example.invalid", first_name: "Media", last_name: "Operator",
  role_id: ADMIN_TEST_ROLE_ID, role: "ADMIN", department_id: null,
};
const poster = (color: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="${color}"/><circle cx="400" cy="225" r="85" fill="white" opacity=".6"/></svg>`)}`;
const assets = [
  { id: "image-1", name: "Atrium welcome", filename: "atrium.png", type: "IMAGE", content_type: "image/png", status: "READY", media_url: poster("#a6c5bd"), size: 1_048_576 },
  { id: "document-1", name: "Safety briefing", filename: "safety.pdf", type: "DOCUMENT", content_type: "application/pdf", status: "PROCESSING", media_url: null, page_count: 4 },
  { id: "video-1", name: "Launch reel", filename: "launch.mp4", type: "VIDEO", content_type: "video/mp4", status: "FAILED", status_reason: "Video conversion failed", media_url: null },
  ...Array.from({ length: 12 }, (_value, index) => ({
    id: `image-${index + 2}`, name: `Gallery image ${index + 2}`, filename: `gallery-${index + 2}.png`,
    type: "IMAGE", content_type: "image/png", status: "READY", media_url: poster(index % 2 ? "#c8b4c0" : "#bac9dd"), size: 512_000,
  })),
];

async function setup(page: Page, items: typeof assets = assets, canCreate = true) {
  await page.context().addCookies([
    { name: "access_token", value: "media-qa-session", url: origin, httpOnly: true, sameSite: "Lax" },
    { name: "csrf_token", value: "media-qa-csrf", url: origin, sameSite: "Lax" },
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
    const json = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/v1/auth/me") return json(user);
    if (url.pathname === "/api/v1/auth/authorization") return json(testAuthorization(user, [
      { action: "read", subject: "Media" },
      ...(canCreate ? [{ action: "create", subject: "Media" }, { action: "manage", subject: "Media" }] : []),
    ], { roleId: ADMIN_TEST_ROLE_ID }));
    if (url.pathname === "/api/v1/roles") return json({ items: [{ id: ADMIN_TEST_ROLE_ID, name: "ADMIN", permissions: { inherits: [], grants: [] } }], page: 1, limit: 100, total: 1 });
    if (url.pathname === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    if (url.pathname === "/api/v1/media" && route.request().method() === "GET") {
      const type = url.searchParams.get("type");
      const selected = type ? items.filter((item) => item.type === type) : items;
      const pageNumber = Number(url.searchParams.get("page") || 1);
      const limit = Number(url.searchParams.get("limit") || 6);
      return json({ items: selected.slice((pageNumber - 1) * limit, pageNumber * limit), page: pageNumber, limit, total: selected.length });
    }
    if (url.pathname.startsWith("/api/v1/media/") && route.request().method() === "GET") {
      return json(items.find((item) => `/api/v1/media/${item.id}` === url.pathname) ?? {});
    }
    return json({});
  });
}

test("empty and failed lists explain the state and offer recovery", async ({ page }) => {
  await setup(page, []);
  let unavailable = true;
  await page.route("**/api/v1/media?**", (route) => unavailable
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) })
    : route.fallback());
  await page.goto("/media");
  await expect(page.getByText("Could not load Media Library")).toBeVisible();
  await expect(page.getByText("No media yet")).toHaveCount(0);
  unavailable = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("No media yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload Media" })).toHaveCount(2);
  await expect(page.getByText("Page 1 of 1")).toHaveCount(0);
});

test("file type filters preserve their own page and a keyboard user can preview", async ({ page }) => {
  await setup(page);
  await page.goto("/media");
  await page.getByRole("tab", { name: "Images" }).click();
  await expect(page.getByText("13 files")).toBeVisible();
  await page.getByRole("button", { name: "Go to next page" }).click();
  await page.getByRole("button", { name: "Go to next page" }).click();
  await expect(page.getByRole("group", { name: "Gallery image 13" })).toBeVisible();
  await page.getByRole("tab", { name: "Documents" }).click();
  await expect(page.getByRole("group", { name: "Safety briefing" })).toBeVisible();
  await page.getByRole("tab", { name: "Images" }).click();
  await expect(page.getByRole("group", { name: "Gallery image 13" })).toBeVisible();
  const preview = page.getByRole("group", { name: "Gallery image 13" }).getByRole("button", { name: "Preview" });
  await preview.focus();
  await preview.press("Enter");
  await expect(page.getByRole("dialog", { name: /Gallery image 13/ })).toBeVisible();
});

test("read-only Media role does not see upload or deleted-media actions", async ({ page }) => {
  await setup(page, assets, false);
  await page.goto("/media");
  await expect(page.getByRole("group", { name: "Atrium welcome" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload Media" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Deleted Media" })).toHaveCount(0);
});

test("upload sheet rejects unsupported files and keeps a valid selection editable", async ({ page }) => {
  await setup(page, []);
  await page.goto("/media");
  await page.getByRole("button", { name: "Upload Media" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Upload Media" });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "program.exe", mimeType: "application/octet-stream", buffer: Buffer.from("not-media") });
  await expect(page.getByText("Unsupported file type", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Upload", exact: true })).toBeDisabled();
  await dialog.locator('input[type="file"]').setInputFiles({ name: "Welcome poster.png", mimeType: "image/png", buffer: Buffer.from("test-image") });
  await expect(dialog.getByLabel("Display name")).toHaveValue("Welcome poster");
  await expect(dialog.getByRole("button", { name: "Upload", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});

test("deleted-media sheet distinguishes load failure from an empty list", async ({ page }) => {
  await setup(page, []);
  let unavailable = true;
  await page.route("**/api/v1/media/deleted?**", (route) => unavailable
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) })
    : route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [] }) }));
  await page.goto("/media");
  await page.getByRole("button", { name: "Deleted Media" }).click();
  const dialog = page.getByRole("dialog", { name: "Deleted Media" });
  await expect(dialog.getByText("Unable to load deleted media.")).toBeVisible();
  await expect(dialog.getByText("No deleted media.")).toHaveCount(0);
  unavailable = false;
  await dialog.getByRole("button", { name: "Retry" }).click();
  await expect(dialog.getByText("No deleted media.")).toBeVisible();
});

test("populated library stays readable at three widths and in dark mode", async ({ page }, testInfo) => {
  await setup(page);
  await page.goto("/media");
  await expect(page.getByRole("group", { name: "Atrium welcome" })).toBeVisible();
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`media-${width}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(() => window.localStorage.setItem("theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("group", { name: "Atrium welcome" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("media-dark-390.png") });
});
