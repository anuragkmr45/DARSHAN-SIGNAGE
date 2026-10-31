import { expect, test, type Route } from "@playwright/test";

const actor = {
  id: "role-editor-user",
  email: "role-editor@example.test",
  role_id: "role-editor-custom",
  role: "CUSTOM_ROLE_EDITOR",
  department_id: null,
  authorization: {
    is_global_user_manager: false,
    rules: [
      { action: "read", subject: "OrgSettings" },
      { action: "read", subject: "BrandingSettings" },
      { action: "read", subject: "Role" },
      { action: "create", subject: "Role", conditions: { name: "Allowed Role" } },
      { action: "update", subject: "Role", conditions: { id: "role-edit" } },
      { action: "update", subject: "Role", conditions: { name: "Name-limited Role" } },
      { action: "delete", subject: "Role", conditions: { id: "role-edit" } },
    ],
  },
};

const role = (id: string, name: string, isSystem = false) => ({
  id,
  name,
  description: null,
  permissions: { inherits: [], grants: [] },
  is_system: isSystem,
  created_at: "2026-10-22T00:00:00.000Z",
  updated_at: "2026-10-22T00:00:00.000Z",
});

test("record-limited Role grants enable controls only on the matching role", async ({ page }) => {
  const roles = [
    role("role-edit", "Editable Role"),
    role("role-other", "Other Role"),
    role("role-name-limited", "Name-limited Role"),
    role("role-super-admin", "SUPER_ADMIN", true),
    role("role-admin", "ADMIN", true),
    role("role-department", "DEPARTMENT", true),
    role("role-operator", "OPERATOR", true),
  ];
  const mutations: string[] = [];
  await page.addInitScript((user) => {
    window.sessionStorage.setItem("persist:darshan", JSON.stringify({
      auth: JSON.stringify({ token: "role-editor-token", user, csrfToken: "csrf-token" }),
      _persist: JSON.stringify({ version: 1, rehydrated: true }),
    }));
    document.cookie = "csrf_token=csrf-token; path=/";
  }, actor);

  await page.route("**/api/v1/**", async (route: Route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (pathname === "/api/v1/auth/me" && method === "GET") return json(actor);
    if (pathname === "/api/v1/roles" && method === "GET") {
      return json({ items: roles, pagination: { page: 1, limit: 100, total: roles.length } });
    }
    if (pathname === "/api/v1/permissions/metadata" && method === "GET") {
      return json({ actions: ["read", "update", "delete"], subjects: ["Role"] });
    }
    if (pathname === "/api/v1/roles/role-edit" && method === "PUT") {
      mutations.push(pathname);
      const body = route.request().postDataJSON() as { name: string };
      roles[0] = { ...roles[0], name: body.name };
      return json(roles[0]);
    }
    if (pathname.startsWith("/api/v1/roles/") && method !== "GET") {
      mutations.push(pathname);
      return json({ message: "Forbidden" }, 403);
    }
    if (pathname === "/api/v1/settings/appearance" && method === "GET") {
      return json({ theme_mode: "light", accent_preset: "crimson", sidebar_mode: "expanded" });
    }
    if (pathname === "/api/v1/settings/branding" && method === "GET") {
      return json({ app_name: "DARSHAN CMS", logo_media_id: null, icon_media_id: null, favicon_media_id: null });
    }
    if (pathname === "/api/v1/notifications/unread-count" && method === "GET") return json({ unread_total: 0 });
    return json({ items: [] });
  });

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Roles" }).click();

  const editable = page.locator("div.rounded-md.border.p-3").filter({ has: page.getByRole("heading", { name: "Editable Role" }) });
  const other = page.locator("div.rounded-md.border.p-3").filter({ has: page.getByRole("heading", { name: "Other Role" }) });
  const nameLimited = page.locator("div.rounded-md.border.p-3").filter({ has: page.getByRole("heading", { name: "Name-limited Role" }) });
  await expect(editable.getByRole("button", { name: "Edit" })).toBeEnabled();
  await expect(editable.getByRole("button", { name: "Delete" })).toBeEnabled();
  await expect(other.getByRole("button", { name: "Edit" })).toBeDisabled();
  await expect(other.getByRole("button", { name: "Delete" })).toBeDisabled();
  await expect(nameLimited.getByRole("button", { name: "Edit" })).toBeEnabled();
  for (const builtInName of ["SUPER_ADMIN", "ADMIN", "DEPARTMENT", "OPERATOR"]) {
    const builtIn = page.locator("div.rounded-md.border.p-3").filter({
      has: page.getByRole("heading", { name: builtInName, exact: true }),
    });
    await expect(builtIn.getByText("System")).toBeVisible();
    await expect(builtIn.getByRole("button", { name: "Edit" })).toBeDisabled();
    await expect(builtIn.getByRole("button", { name: "Delete" })).toBeDisabled();
  }

  await nameLimited.getByRole("button", { name: "Edit" }).click();
  await page.getByPlaceholder("Role name").fill("Escaped Role");
  await expect(page.getByRole("button", { name: "Update Role" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel" }).click();

  await editable.getByRole("button", { name: "Edit" }).click();
  await page.getByPlaceholder("Role name").fill("Edited Role");
  await page.getByRole("button", { name: "Update Role" }).click();
  await expect(page.getByRole("heading", { name: "Edited Role" })).toBeVisible();
  expect(mutations).toEqual(["/api/v1/roles/role-edit"]);

  await page.getByRole("button", { name: "New Role" }).click();
  await page.getByPlaceholder("Role name").fill("Denied Role");
  await expect(page.getByRole("button", { name: "Create Role" })).toBeDisabled();
  await page.getByPlaceholder("Role name").fill("Allowed Role");
  await expect(page.getByRole("button", { name: "Create Role" })).toBeEnabled();
});
