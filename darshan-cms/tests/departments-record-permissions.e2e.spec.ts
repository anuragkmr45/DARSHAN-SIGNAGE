import { expect, test, type Route } from "@playwright/test";

const actor = {
  id: "department-editor",
  email: "department-editor@example.test",
  role_id: "custom-department-role",
  role: "CUSTOM_DEPARTMENT_ROLE",
  department_id: null,
  authorization: {
    is_global_user_manager: false,
    rules: [
      { action: "read", subject: "Department" },
      { action: "create", subject: "Department", conditions: { name: "Approved New Department" } },
      { action: "update", subject: "Department", conditions: { name: "Editable Department" } },
      { action: "delete", subject: "Department", conditions: { id: "department-a" } },
    ],
  },
};

const department = (id: string, name: string) => ({
  id, name, description: null,
  created_at: "2026-10-22T00:00:00.000Z",
  updated_at: "2026-10-22T00:00:00.000Z",
});

test("Department controls follow matching record and proposed create grants", async ({ page }) => {
  const mutations: string[] = [];
  await page.addInitScript((user) => {
    window.sessionStorage.setItem("persist:darshan", JSON.stringify({
      auth: JSON.stringify({ token: "department-editor-token", user, csrfToken: "csrf-token" }),
      _persist: JSON.stringify({ version: 1, rehydrated: true }),
    }));
    document.cookie = "csrf_token=csrf-token; path=/";
  }, actor);

  await page.route("**/api/v1/**", async (route: Route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/v1/auth/me" && method === "GET") return json(actor);
    if (pathname === "/api/v1/departments" && method === "GET") {
      return json({ items: [department("department-a", "Editable Department"), department("department-b", "Read-only Department")], pagination: { page: 1, limit: 9, total: 2 } });
    }
    if (pathname.startsWith("/api/v1/departments") && method !== "GET") {
      mutations.push(`${method} ${pathname}`);
      return json({ message: "Forbidden" }, 403);
    }
    if (pathname === "/api/v1/notifications/unread-count" && method === "GET") return json({ unread_total: 0 });
    return json({ items: [] });
  });

  await page.goto("/departments");
  await expect(page.getByRole("button", { name: "Actions for Editable Department" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Actions for Read-only Department" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "View Operators" })).toHaveCount(0);

  await page.getByRole("button", { name: "Actions for Editable Department" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.getByPlaceholder("e.g., Marketing").fill("Outside grant");
  await expect(page.getByRole("button", { name: "Update Department" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "New Department" }).click();
  await page.getByPlaceholder("e.g., Marketing").fill("Rejected New Department");
  await expect(page.getByRole("button", { name: "Create Department" })).toBeDisabled();
  await page.getByPlaceholder("e.g., Marketing").fill("Approved New Department");
  await expect(page.getByRole("button", { name: "Create Department" })).toBeEnabled();
  expect(mutations).toEqual([]);
});
