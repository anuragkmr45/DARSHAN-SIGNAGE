import { installDarkSiteAppearance } from "./helpers/siteAppearance";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_TEST_ROLE_ID, ADMIN_TEST_USER_ID, testAuthorization, type TestCapability } from "./helpers/selfAuthorization";

const origin = "http://127.0.0.1:5173";
const departmentA = "00000000-0000-4000-8000-000000000101";
const departmentB = "00000000-0000-4000-8000-000000000102";
const user = { id: ADMIN_TEST_USER_ID, email: "departments-qa@example.invalid", first_name: "Site", last_name: "Manager", role_id: ADMIN_TEST_ROLE_ID, role: "CUSTOM", department_id: null };
const initialDepartments = [
  { id: departmentA, name: "Operations", description: "Main site operations" },
  { id: departmentB, name: "Reception", description: "Visitor information" },
];

async function setup(page: Page, grants: TestCapability[], options: { failList?: boolean } = {}) {
  let departments = [...initialDepartments];
  let blockDelete = true;
  let failList = Boolean(options.failList);
  const requests: string[] = [];
  await page.context().addCookies([
    { name: "access_token", value: "departments-qa-session", url: origin, httpOnly: true, sameSite: "Lax" },
    { name: "csrf_token", value: "departments-qa-csrf", url: origin, sameSite: "Lax" },
  ]);
  await page.route("**/config/app-config.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ cms: {
    environment: { name: "development", deploymentId: "qa", cmsId: "qa" },
    api: { baseUrl: new URL(route.request().url()).origin },
    realtime: { socketBaseUrl: new URL(route.request().url()).origin, socketTransports: ["websocket"] },
  } }) }));
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    requests.push(`${method} ${url.pathname}${url.search}`);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/v1/auth/me") return json(user);
    if (url.pathname === "/api/v1/auth/authorization") return json(testAuthorization(user, grants, { roleId: ADMIN_TEST_ROLE_ID }));
    if (url.pathname === "/api/v1/roles") return json({ items: [{ id: ADMIN_TEST_ROLE_ID, name: "CUSTOM", permissions: { grants } }], page: 1, limit: 100, total: 1 });
    if (url.pathname === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    if (url.pathname === "/api/v1/departments" && method === "GET") {
      if (failList) return json({ error: { message: "Service unavailable" } }, 503);
      const search = (url.searchParams.get("search") || "").toLowerCase();
      const selected = departments.filter((item) => !search || item.name.toLowerCase().includes(search) || item.description.toLowerCase().includes(search));
      return json({ items: selected, pagination: { page: 1, limit: 9, total: selected.length } });
    }
    if (url.pathname === "/api/v1/departments" && method === "POST") {
      const payload = route.request().postDataJSON() as { name: string; description?: string };
      const created = { id: "00000000-0000-4000-8000-000000000103", ...payload };
      departments = [created, ...departments];
      return json(created, 201);
    }
    if (url.pathname.startsWith("/api/v1/departments/") && method === "PATCH") {
      const id = url.pathname.split("/").at(-1);
      const payload = route.request().postDataJSON() as { name?: string; description?: string };
      departments = departments.map((item) => item.id === id ? { ...item, ...payload } : item);
      return json(departments.find((item) => item.id === id));
    }
    if (url.pathname.startsWith("/api/v1/departments/") && method === "DELETE") {
      if (blockDelete) return json({ error: { code: "DEPARTMENT_IN_USE", message: "Department cannot be deleted while it owns users or content.", details: { users: 1, additional_users: 2, media: 3 } } }, 409);
      const id = url.pathname.split("/").at(-1);
      departments = departments.filter((item) => item.id !== id);
      return json({ message: "Department deleted successfully", id });
    }
    if (url.pathname === "/api/v1/users") {
      const id = url.searchParams.get("department_id");
      const pageNumber = Number(url.searchParams.get("page") || 1);
      const members = id === departmentA ? Array.from({ length: 11 }, (_value, index) => ({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        first_name: index === 0 ? "Primary" : "Additional", last_name: `Operator ${index}`,
        email: `operator-${index}@example.invalid`, role: "OPERATOR", is_active: true,
        department_id: index === 0 ? departmentA : departmentB,
      })) : [];
      return json({ items: members.slice((pageNumber - 1) * 10, pageNumber * 10), pagination: { page: pageNumber, limit: 10, total: members.length } });
    }
    return json({});
  });
  return { requests, allowDelete: () => { blockDelete = false; }, restoreList: () => { failList = false; } };
}

const adminGrants: TestCapability[] = [
  { action: "read", subject: "Department" }, { action: "create", subject: "Department" },
  { action: "update", subject: "Department" }, { action: "delete", subject: "Department" },
  { action: "read", subject: "User" },
];

test("department-only reader sees no User data or mutation controls", async ({ page }) => {
  const state = await setup(page, [{ action: "read", subject: "Department" }]);
  await page.goto("/departments");
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Department" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "View Operators" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Actions for Operations" })).toHaveCount(0);
  await expect(page.getByPlaceholder("Search departments…")).toBeVisible();
  expect(state.requests.some((request) => request.startsWith("GET /api/v1/users"))).toBe(false);
});

test("create, edit, blocked delete, then permitted delete keeps server authority", async ({ page }) => {
  const state = await setup(page, adminGrants);
  await page.goto("/departments");
  await page.getByRole("button", { name: "New Department" }).click();
  await page.getByLabel("Department Name *").fill("Training");
  await page.getByRole("button", { name: "Create Department" }).click();
  await expect(page.getByRole("heading", { name: "Training" })).toBeVisible();
  await page.getByRole("button", { name: "Actions for Training" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.getByLabel("Description").fill("Staff learning");
  await page.getByRole("button", { name: "Update Department" }).click();
  await expect(page.getByText("Staff learning")).toBeVisible();
  await page.getByRole("button", { name: "Actions for Training" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: "Delete Department" })).toBeDisabled();
  await page.getByLabel("Department name").fill("Training");
  await page.getByRole("button", { name: "Delete Department" }).click();
  await expect(page.getByText("This department is still in use.")).toBeVisible();
  await expect(page.getByText("Additional members: 2")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Training" })).toBeVisible();
  state.allowDelete();
  await page.getByRole("button", { name: "Actions for Training" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByLabel("Department name").fill("Training");
  await page.getByRole("button", { name: "Delete Department" }).click();
  await expect(page.getByRole("heading", { name: "Training" })).toHaveCount(0);
  expect(state.requests.filter((request) => request.startsWith("DELETE /api/v1/departments/"))).toHaveLength(2);
});

test("operator list loads on demand with primary and additional membership, then pages", async ({ page }) => {
  const state = await setup(page, adminGrants);
  await page.goto("/departments");
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  expect(state.requests.some((request) => request.startsWith("GET /api/v1/users"))).toBe(false);
  const row = page.getByRole("heading", { name: "Operations" }).locator("xpath=../../..");
  await row.getByRole("button", { name: "View Operators" }).click();
  await expect(page.getByRole("dialog").getByText("11 operators")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Primary", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Additional", { exact: true }).first()).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Go to next page" }).click();
  await expect(page.getByRole("dialog").getByText("operator-10@example.invalid")).toBeVisible();
  expect(state.requests.some((request) => request.includes(`department_id=${departmentA}`) && request.includes("page=2"))).toBe(true);
});

test("failed list has Retry; responsive light and dark layouts do not overflow", async ({ page }, testInfo) => {
  const state = await setup(page, adminGrants, { failList: true });
  await page.goto("/departments");
  await expect(page.getByText("Could not load departments")).toBeVisible();
  state.restoreList();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`departments-${width}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await installDarkSiteAppearance(page);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("departments-dark-390.png") });
});
