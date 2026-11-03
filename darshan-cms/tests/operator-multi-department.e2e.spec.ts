import { expect, test, type Page, type Route } from "@playwright/test";
import { ADMIN_TEST_ROLE_ID, ADMIN_TEST_USER_ID, adminAuthorization } from "./helpers/selfAuthorization";

const departments = [
  { id: "department-a", name: "Department A", description: "" },
  { id: "department-b", name: "Department B", description: "" },
  { id: "department-c", name: "Department C", description: "" },
];

const operator = {
  id: "operator-1",
  email: "operator@example.test",
  first_name: "Multi",
  last_name: "Operator",
  role_id: "role-operator",
  role: "OPERATOR",
  department_id: departments[0].id,
  department_ids: [departments[0].id, departments[1].id],
  additional_department_ids: [departments[1].id],
  departments: [
    { id: departments[0].id, name: departments[0].name, is_primary: true },
    { id: departments[1].id, name: departments[1].name, is_primary: false },
  ],
  is_active: true,
};

const administrator = {
  id: ADMIN_TEST_USER_ID,
  email: "administrator@example.test",
  first_name: "Test",
  last_name: "Administrator",
  role_id: ADMIN_TEST_ROLE_ID,
  role: "ADMIN",
  department_id: null,
};

async function prepare(
  page: Page,
  onUpdate?: (payload: Record<string, unknown>) => void,
  updateStatus = 200,
) {
  await page.addInitScript((user) => {
    window.sessionStorage.setItem("persist:darshan", JSON.stringify({
      auth: JSON.stringify({ token: "test-token", user, csrfToken: "test-csrf" }),
      _persist: JSON.stringify({ version: 1, rehydrated: true }),
    }));
    document.cookie = "csrf_token=test-csrf; path=/";
  }, administrator);

  await page.route("**/api/v1/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const respond = (body: unknown) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify(body),
    });
    if (url.pathname === "/api/v1/auth/authorization") {
      return respond(adminAuthorization(administrator));
    }
    if (url.pathname === "/api/v1/roles") {
      return respond({ items: [
        { id: "role-admin", name: "ADMIN", is_system: true, permissions: { inherits: [], grants: [{ action: "manage", subject: "all" }] } },
        { id: "role-operator", name: "OPERATOR", is_system: true, permissions: { inherits: [], grants: [{ action: "read", subject: "User" }] } },
        { id: "role-department", name: "DEPARTMENT", is_system: true, permissions: { inherits: [], grants: [{ action: "read", subject: "User" }] } },
      ], total: 3, page: 1, limit: 100 });
    }
    if (url.pathname === "/api/v1/departments") {
      return respond({ items: departments, total: departments.length, page: 1, limit: 100 });
    }
    if (url.pathname === "/api/v1/users" && method === "GET") {
      return respond({ items: [operator], total: 1, page: 1, limit: 100 });
    }
    if (url.pathname === `/api/v1/users/${operator.id}` && method === "PATCH") {
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      onUpdate?.(payload);
      if (updateStatus !== 200) return route.fulfill({
        status: updateStatus,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "PRIMARY_DEPARTMENT_CONFLICT",
          message: "The new primary department is already additional." } }),
      });
      return respond({ ...operator, ...payload });
    }
    if (url.pathname === "/api/v1/notifications/unread-count") return respond({ unread_total: 0 });
    if (url.pathname === "/api/v1/settings/branding") return respond({ app_name: "DARSHAN CMS" });
    if (url.pathname === "/api/v1/settings/appearance") return respond({ theme_mode: "light" });
    return respond({ items: [], total: 0, page: 1, limit: 100 });
  });
}

test("operator form preserves former primary access and sends explicit memberships", async ({ page }) => {
  let updatePayload: Record<string, unknown> | undefined;
  await prepare(page, (payload) => { updatePayload = payload; });
  await page.goto("/operators");
  await expect(page.getByText("Primary: Department A")).toBeVisible();
  await expect(page.getByText("Additional: Department B")).toBeVisible();
  await page.getByRole("button", { name: "Actions for operator@example.test" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("checkbox", { name: "Additional department Department B" })).toBeChecked();
  await page.getByRole("combobox", { name: "Primary department" }).click();
  await page.getByRole("option", { name: "Department B" }).click();
  await expect(page.getByRole("checkbox", { name: "Additional department Department A" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Additional department Department B" })).toHaveCount(0);
  await page.getByRole("button", { name: "Update" }).click();
  await expect.poll(() => updatePayload).toMatchObject({
    department_id: departments[1].id,
    additional_department_ids: [departments[0].id],
  });
});

test("stale operator edit keeps the dialog open and shows the server conflict", async ({ page }) => {
  await prepare(page, undefined, 409);
  await page.goto("/operators");
  await page.getByRole("button", { name: "Actions for operator@example.test" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Update" }).click();
  await expect(page.getByRole("dialog", { name: "Edit Operator" })).toBeVisible();
  await expect(page.getByText("The new primary department is already additional.", { exact: true })).toBeVisible();
});

test("department cards show one operator as primary in A and additional in B", async ({ page }) => {
  await prepare(page);
  await page.goto("/departments");
  for (const [name, relationship] of [["Department A", "Primary"], ["Department B", "Additional"]]) {
    const card = page.getByRole("heading", { name }).locator("xpath=../../..");
    await card.getByRole("button", { name: "View Operators" }).click();
    await expect(page.getByRole("dialog").getByText(relationship, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  }
  const cCard = page.getByRole("heading", { name: "Department C" }).locator("xpath=../../..");
  await cCard.getByRole("button", { name: "View Operators" }).click();
  await expect(page.getByRole("dialog").getByText("No operators are assigned")).toBeVisible();
});

test("operator search finds a later-page account through the server", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/v1/users?**", async (route) => {
    const url = new URL(route.request().url());
    const searching = url.searchParams.get("search") === operator.email;
    const decoys = Array.from({ length: 9 }, (_, index) => ({
      ...operator, id: `decoy-${index}`, email: `decoy-${index}@example.test`,
      first_name: "Decoy", last_name: String(index),
    }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      items: searching ? [operator] : decoys,
      total: searching ? 1 : 10,
      page: 1,
      limit: 9,
    }) });
  });
  await page.goto("/operators");
  await expect(page.getByText("Decoy 0")).toBeVisible();
  await page.getByRole("textbox", { name: "Search" }).fill(operator.email);
  await expect(page.getByText("Multi Operator")).toBeVisible();
  await expect(page.getByText("Decoy 0")).toHaveCount(0);
});

test("department search returns both primary and additional matches beyond page one", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/v1/departments?**", async (route) => {
    const url = new URL(route.request().url());
    const searching = url.searchParams.get("search") === operator.email;
    const decoys = Array.from({ length: 9 }, (_, index) => ({
      id: `decoy-department-${index}`, name: `Decoy Department ${index}`, description: "",
    }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      items: searching ? departments.slice(0, 2) : decoys,
      total: searching ? 2 : 12,
      page: 1,
      limit: 9,
    }) });
  });
  await page.goto("/departments");
  await expect(page.getByRole("heading", { name: "Decoy Department 0" })).toBeVisible();
  await page.getByRole("textbox", { name: "Search" }).fill(operator.email);
  await expect(page.getByRole("heading", { name: "Department A" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Department B" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Decoy Department 0" })).toHaveCount(0);
});

test("changing an operator to another role warns and clears additional departments", async ({ page }) => {
  let updatePayload: Record<string, unknown> | undefined;
  await prepare(page, (payload) => { updatePayload = payload; });
  await page.route("**/api/v1/users?**", async (route) => {
    const searching = new URL(route.request().url()).searchParams.get("search") === operator.email;
    const decoys = Array.from({ length: 9 }, (_, index) => ({
      ...operator, id: `user-decoy-${index}`, email: `user-decoy-${index}@example.test`,
      first_name: "Decoy", last_name: String(index),
    }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      items: searching ? [operator] : decoys,
      total: searching ? 1 : 10,
      page: 1,
      limit: 9,
    }) });
  });
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Decoy 0" })).toBeVisible();
  await page.getByPlaceholder("Search users by name, email, or role...").fill(operator.email);
  await expect(page.getByRole("heading", { name: "Multi Operator" })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("combobox", { name: "Role" }).click();
  await page.getByRole("option", { name: "DEPARTMENT" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Saving a non-operator role will remove this user’s additional department assignments"
  );
  await page.getByRole("button", { name: "Update User" }).click();
  await expect.poll(() => updatePayload).toMatchObject({
    role_id: "role-department",
    additional_department_ids: [],
  });
});
