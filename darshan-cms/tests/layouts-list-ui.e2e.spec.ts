import { expect, test, type Page } from "@playwright/test";
import { ADMIN_TEST_ROLE_ID, ADMIN_TEST_USER_ID, testAuthorization } from "./helpers/selfAuthorization";

const origin = "http://127.0.0.1:5173";
const user = {
  id: ADMIN_TEST_USER_ID, email: "layouts-qa@example.invalid", first_name: "Layout", last_name: "Operator",
  role_id: ADMIN_TEST_ROLE_ID, role: "ADMIN", department_id: null,
};
const slots = [{ id: "main", x: 0, y: 0, w: 0.7, h: 1 }, { id: "aside", x: 0.7, y: 0, w: 0.3, h: 1 }];
const layouts = [
  { id: "layout-welcome", name: "Welcome Mosaic", description: "Main announcement with a narrow side panel", aspect_ratio: "16:9", spec: { slots }, permissions: { can_update: true, can_delete: true }, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-03T00:00:00Z" },
  { id: "layout-portrait", name: "Portrait Notice", description: "Tall reception display", aspect_ratio: "9:16", spec: { slots: [{ id: "full", x: 0, y: 0, w: 1, h: 1 }] }, permissions: { can_update: true, can_delete: true }, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-03T00:00:00Z" },
  ...Array.from({ length: 9 }, (_value, index) => ({ id: `layout-${index + 3}`, name: `Zone layout ${index + 3}`, description: "Department display arrangement", aspect_ratio: "16:9", spec: { slots }, permissions: { can_update: true, can_delete: true }, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-03T00:00:00Z" })),
];

async function setup(page: Page, canCreate = true, initial = layouts) {
  const items = [...initial];
  await page.context().addCookies([
    { name: "access_token", value: "layout-qa-session", url: origin, httpOnly: true, sameSite: "Lax" },
    { name: "csrf_token", value: "layout-qa-csrf", url: origin, sameSite: "Lax" },
  ]);
  await page.route("**/config/app-config.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ cms: {
    environment: { name: "development", deploymentId: "qa", cmsId: "qa" },
    api: { baseUrl: new URL(route.request().url()).origin },
    realtime: { socketBaseUrl: new URL(route.request().url()).origin, socketTransports: ["websocket"] },
  } }) }));
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/v1/auth/me") return json(user);
    if (url.pathname === "/api/v1/auth/authorization") return json(testAuthorization(user, [
      { action: "read", subject: "Layout" },
      ...(canCreate ? [{ action: "create", subject: "Layout" }] : []),
    ], { roleId: ADMIN_TEST_ROLE_ID }));
    if (url.pathname === "/api/v1/roles") return json({ items: [{ id: ADMIN_TEST_ROLE_ID, name: "ADMIN", permissions: { inherits: [], grants: [] } }], page: 1, limit: 100, total: 1 });
    if (url.pathname === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    if (url.pathname === "/api/v1/layouts" && route.request().method() === "GET") {
      const search = (url.searchParams.get("search") || "").toLowerCase();
      const ratio = url.searchParams.get("aspect_ratio");
      const selected = items.filter((item) => (!ratio || item.aspect_ratio === ratio) && (!search || `${item.name} ${item.description}`.toLowerCase().includes(search)));
      const pageNumber = Number(url.searchParams.get("page") || 1);
      const limit = Number(url.searchParams.get("limit") || 9);
      return json({ items: selected.slice((pageNumber - 1) * limit, pageNumber * limit), pagination: { page: pageNumber, limit, total: selected.length } });
    }
    if (url.pathname.startsWith("/api/v1/layouts/") && route.request().method() === "DELETE") {
      const index = items.findIndex((item) => `/api/v1/layouts/${item.id}` === url.pathname);
      if (index >= 0) items.splice(index, 1);
      return route.fulfill({ status: 204, body: "" });
    }
    return json({});
  });
  return items;
}

test("failed list shows Retry and a truly empty library has a create path", async ({ page }) => {
  await setup(page, true, []);
  let unavailable = true;
  await page.route("**/api/v1/layouts?**", (route) => unavailable
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) })
    : route.fallback());
  await page.goto("/layouts");
  await expect(page.getByText("Unable to load layouts")).toBeVisible();
  unavailable = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("No layouts yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create layout" })).toBeVisible();
});

test("server search, ratio filter, and paging show the requested layouts", async ({ page }) => {
  await setup(page);
  await page.goto("/layouts");
  await expect(page.getByText("11 layouts")).toBeVisible();
  await page.getByRole("button", { name: "Go to next page" }).click();
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "9:16" }).click();
  await expect(page.getByRole("table").getByText("Portrait Notice")).toBeVisible();
  await expect(page.getByText("Welcome Mosaic")).toHaveCount(0);
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "All Ratios" }).click();
  await page.getByRole("textbox", { name: "Search" }).fill("Welcome");
  await expect(page.getByRole("table").getByText("Welcome Mosaic")).toBeVisible();
  await expect(page.getByText("1 layout", { exact: true })).toBeVisible();
});

test("read-only operator sees no create action and can inspect a portrait on phone", async ({ page }) => {
  await setup(page, false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/layouts");
  await expect(page.getByRole("button", { name: "New Layout" })).toHaveCount(0);
  const card = page.getByRole("article", { name: "Portrait Notice" });
  await card.getByRole("button", { name: "View" }).click();
  const dialog = page.getByRole("dialog", { name: "Portrait Notice" });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box && box.width <= 390 && box.height <= 844).toBeTruthy();
});

test("mobile delete requires the exact layout name and removes the selected record", async ({ page }) => {
  const items = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/layouts");
  const card = page.getByRole("article", { name: "Welcome Mosaic" });
  await card.getByRole("button", { name: "More actions for Welcome Mosaic" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete layout?" });
  await expect(dialog.getByRole("button", { name: "Delete" })).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Confirm layout name" }).fill("Welcome Mosaic");
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect.poll(() => items.some((item) => item.id === "layout-welcome")).toBe(false);
  await expect(card).toHaveCount(0);
});

test("list is readable at phone, tablet, desktop, and dark phone", async ({ page }, testInfo) => {
  await setup(page);
  await page.goto("/layouts");
  await expect(page.getByRole("table").getByText("Welcome Mosaic")).toBeVisible();
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`layouts-${width}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(() => window.localStorage.setItem("theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("article", { name: "Welcome Mosaic" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("layouts-dark-390.png") });
});
