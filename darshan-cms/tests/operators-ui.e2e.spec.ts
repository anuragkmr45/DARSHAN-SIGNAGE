import { expect, test, type Page } from "@playwright/test";
import { ADMIN_TEST_ROLE_ID, ADMIN_TEST_USER_ID, testAuthorization, type TestCapability } from "./helpers/selfAuthorization";

const origin = "http://127.0.0.1:5173";
const user = { id: ADMIN_TEST_USER_ID, email: "manager@example.invalid", role_id: ADMIN_TEST_ROLE_ID, role: "CUSTOM", department_id: null };
const operator = { id: "00000000-0000-4000-8000-000000000010", email: "operator@example.invalid", first_name: "Site", last_name: "Operator", role_id: "operator-role", role: "OPERATOR", is_active: true, department_id: "dept-a", department_ids: ["dept-a"], additional_department_ids: [], departments: [{ id: "dept-a", name: "Operations", is_primary: true }] };

async function setup(page: Page, grants: TestCapability[], options: { failList?: boolean } = {}) {
  let failList = Boolean(options.failList);
  const requests: string[] = [];
  await page.context().addCookies([
    { name: "access_token", value: "operators-qa-session", url: origin, httpOnly: true, sameSite: "Lax" },
    { name: "csrf_token", value: "operators-qa-csrf", url: origin, sameSite: "Lax" },
  ]);
  await page.route("**/config/app-config.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ cms: {
    environment: { name: "development", deploymentId: "qa", cmsId: "qa" },
    api: { baseUrl: new URL(route.request().url()).origin },
    realtime: { socketBaseUrl: new URL(route.request().url()).origin, socketTransports: ["websocket"] },
  } }) }));
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    requests.push(`${method} ${url.pathname}`);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/v1/auth/me") return json(user);
    if (url.pathname === "/api/v1/auth/authorization") return json(testAuthorization(user, grants, { roleId: ADMIN_TEST_ROLE_ID }));
    if (url.pathname === "/api/v1/roles") return json({ items: [{ id: "operator-role", name: "OPERATOR", is_system: true }], page: 1, limit: 100, total: 1 });
    if (url.pathname === "/api/v1/departments") return json({ items: [{ id: "dept-a", name: "Operations" }], page: 1, limit: 100, total: 1 });
    if (url.pathname === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    if (url.pathname === "/api/v1/users" && method === "GET") return failList ? json({ error: { message: "Service unavailable" } }, 503) : json({ items: [operator], pagination: { page: 1, limit: 9, total: 1 } });
    if (url.pathname.endsWith(`/users/${operator.id}/reset-password`) && method === "POST") return json({ id: operator.id, temp_password: "local-secret-123A!" });
    return json({});
  });
  return { requests, restoreList: () => { failList = false; } };
}

test("read-only operator sees roster without mutation controls", async ({ page }) => {
  await setup(page, [{ action: "read", subject: "User" }]);
  await page.goto("/operators");
  await expect(page.getByText("Site Operator")).toBeVisible();
  await expect(page.getByRole("button", { name: "New Operator" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Actions for operator@example.invalid" })).toHaveCount(0);
  await expect(page.getByText(operator.id)).toBeHidden();
  await page.getByText("Technical ID").click();
  await expect(page.getByText(operator.id)).toBeVisible();
});

test("update-only operator may edit and reset but not create or delete", async ({ page }) => {
  await setup(page, [{ action: "read", subject: "User" }, { action: "update", subject: "User" }]);
  await page.goto("/operators");
  await expect(page.getByRole("button", { name: "New Operator" })).toHaveCount(0);
  await page.getByRole("button", { name: "Actions for operator@example.invalid" }).click();
  await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Reset Password" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Reset Password" }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Temporary password" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Temporary password" }).getByText("local-secret-123A!")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("local-secret-123A!")).toHaveCount(0);
});

test("create-only grant does not reveal existing-account actions", async ({ page }) => {
  await setup(page, [{ action: "read", subject: "User" }, { action: "create", subject: "User" }]);
  await page.goto("/operators");
  await expect(page.getByRole("button", { name: "New Operator" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Actions for operator@example.invalid" })).toHaveCount(0);
  await page.getByRole("button", { name: "New Operator" }).click();
  await expect(page.getByRole("dialog", { name: "Add Operator" })).toBeVisible();
});

test("delete-only grant shows deletion without edit or password reset", async ({ page }) => {
  await setup(page, [{ action: "read", subject: "User" }, { action: "delete", subject: "User" }]);
  await page.goto("/operators");
  await page.getByRole("button", { name: "Actions for operator@example.invalid" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Reset Password" })).toHaveCount(0);
});

test("failed initial load gives a retry without implying an empty roster", async ({ page }) => {
  const state = await setup(page, [{ action: "read", subject: "User" }], { failList: true });
  await page.goto("/operators");
  await expect(page.getByText("Could not load operators")).toBeVisible();
  state.restoreList();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Site Operator")).toBeVisible();
  expect(state.requests.filter((entry) => entry === "GET /api/v1/users").length).toBeGreaterThanOrEqual(2);
});

test("operator roster stays usable on phone and dark phone", async ({ page }) => {
  await setup(page, [{ action: "read", subject: "User" }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/operators");
  await expect(page.getByText("Site Operator")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "../qa-artifacts/evidence/product-ui-operators/phone-light.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "../qa-artifacts/evidence/product-ui-operators/desktop-light.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(page.getByText("Operations")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "../qa-artifacts/evidence/product-ui-operators/phone-dark.png", fullPage: true });
  await page.setViewportSize({ width: 820, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
