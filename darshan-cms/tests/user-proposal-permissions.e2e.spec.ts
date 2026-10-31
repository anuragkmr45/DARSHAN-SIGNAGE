import { expect, test, type Route } from "@playwright/test";

const departmentId = "dept-a";
const operatorRoleId = "role-operator";
const target = {
  id: "operator-a",
  email: "existing@example.test",
  first_name: "Allowed",
  last_name: "Operator",
  role_id: operatorRoleId,
  role: "OPERATOR",
  department_id: departmentId,
  is_active: true,
  permissions: { can_update: true, can_delete: false, can_reset_password: true },
  created_at: "2026-10-27T00:00:00.000Z",
  updated_at: "2026-10-27T00:00:00.000Z",
};

const actor = {
  id: "conditional-manager",
  email: "manager@example.test",
  first_name: "Conditional",
  last_name: "Manager",
  role_id: "conditional-manager-role",
  role: "CUSTOM_MANAGER",
  department_id: departmentId,
  authorization: {
    is_global_user_manager: false,
    rules: [
      { action: "read", subject: "User" },
      {
        action: "create",
        subject: "User",
        conditions: { email: "allowed@example.test", role_id: operatorRoleId, department_id: departmentId },
      },
      {
        action: "update",
        subject: "User",
        conditions: { id: target.id, first_name: "Allowed", department_id: departmentId },
      },
    ],
  },
};

test("User, invitation and Operator forms guard stored and proposed conditional records", async ({ page }) => {
  await page.addInitScript((user) => {
    window.sessionStorage.setItem("persist:darshan", JSON.stringify({
      auth: JSON.stringify({ token: "conditional-manager-token", user, csrfToken: "csrf-token" }),
      _persist: JSON.stringify({ version: 1, rehydrated: true }),
    }));
    document.cookie = "csrf_token=csrf-token; path=/";
  }, actor);

  await page.route("**/api/v1/**", async (route: Route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (pathname === "/api/v1/auth/me" && method === "GET") return json(actor);
    if (pathname === "/api/v1/users/management-options" && method === "GET") {
      return json({
        roles: [{ id: operatorRoleId, name: "OPERATOR" }],
        departments: [{ id: departmentId, name: "Department A" }],
        is_global_user_manager: false,
      });
    }
    if (pathname === "/api/v1/users/invite" && method === "GET") {
      return json({ items: [], pagination: { page: 1, limit: 9, total: 0 } });
    }
    if (pathname === "/api/v1/users" && method === "GET") {
      return json({ items: [target], pagination: { page: 1, limit: 9, total: 1 } });
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

  await page.goto("/users");
  await page.getByRole("button", { name: "Add User" }).click();
  await page.getByRole("menuitem", { name: "Create User Directly" }).click();
  const createDialog = page.getByRole("dialog", { name: "Create New User" });
  await createDialog.getByLabel("Email").fill("denied@example.test");
  await createDialog.getByLabel("First Name").fill("New");
  await createDialog.getByLabel("Last Name").fill("Operator");
  await createDialog.getByLabel("Password", { exact: true }).fill("ValidPass1!");
  await expect(createDialog.getByRole("button", { name: "Show password" })).toBeVisible();
  await expect(createDialog.getByRole("button", { name: "Create User" })).toBeDisabled();
  await expect(createDialog.getByRole("alert")).toContainText("outside your current permission scope");
  await createDialog.getByLabel("Email").fill("allowed@example.test");
  await expect(createDialog.getByRole("button", { name: "Create User" })).toBeEnabled();
  await expect(createDialog.getByRole("alert")).toHaveCount(0);
  await createDialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Add User" }).click();
  await page.getByRole("menuitem", { name: "Create Invitation Link" }).click();
  const inviteDialog = page.getByRole("dialog", { name: "Invite User" });
  await inviteDialog.getByLabel("Email").fill("denied@example.test");
  await expect(inviteDialog.getByRole("button", { name: "Create Invitation Link" })).toBeDisabled();
  await expect(inviteDialog.getByRole("alert").filter({ hasText: "outside your current permission scope" })).toBeVisible();
  await inviteDialog.getByLabel("Email").fill("allowed@example.test");
  await expect(inviteDialog.getByRole("button", { name: "Create Invitation Link" })).toBeEnabled();
  await expect(inviteDialog.getByRole("alert").filter({ hasText: "outside your current permission scope" })).toHaveCount(0);
  await inviteDialog.getByRole("button", { name: "Cancel" }).click();

  const userCard = page.locator("div.rounded-lg.border").filter({ hasText: target.email }).first();
  await userCard.getByRole("button", { name: "Edit" }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit User" });
  await expect(editDialog.getByLabel("Email")).toBeDisabled();
  await editDialog.getByLabel("First Name").fill("Denied");
  await expect(editDialog.getByRole("button", { name: "Update User" })).toBeDisabled();
  await editDialog.getByLabel("First Name").fill("Allowed");
  await expect(editDialog.getByRole("button", { name: "Update User" })).toBeEnabled();
  await editDialog.getByRole("button", { name: "Cancel" }).click();

  await page.goto("/operators");
  await page.getByRole("button", { name: "Add Operator" }).click();
  const operatorDialog = page.getByRole("dialog", { name: "Add Operator" });
  await operatorDialog.getByLabel("Email").fill("denied@example.test");
  await operatorDialog.getByLabel("Password", { exact: true }).fill("ValidPass1!");
  await operatorDialog.getByLabel("Confirm password").fill("ValidPass1!");
  await expect(operatorDialog.getByRole("button", { name: "Create" })).toBeDisabled();
  await expect(operatorDialog.getByRole("alert")).toContainText("outside your current permission scope");
  await operatorDialog.getByLabel("Email").fill("allowed@example.test");
  await expect(operatorDialog.getByRole("button", { name: "Create" })).toBeEnabled();
});

test("a global custom User manager receives minimal options and can target any returned role and department", async ({ page }) => {
  const globalActor = {
    id: "global-custom-manager",
    email: "global-manager@example.test",
    first_name: "Global",
    last_name: "Manager",
    role_id: "role-global-manager",
    role: "CUSTOM_GLOBAL_MANAGER",
    department_id: null,
    authorization: {
      is_global_user_manager: true,
      rules: [{ action: "manage", subject: "User" }],
    },
  };
  const options = {
    roles: [
      { id: operatorRoleId, name: "OPERATOR" },
      { id: "role-admin", name: "ADMIN" },
      { id: "role-custom-editor", name: "CONTENT_EDITOR" },
    ],
    departments: [
      { id: departmentId, name: "Department A" },
      { id: "dept-b", name: "Department B" },
    ],
    is_global_user_manager: true,
  };
  let createPayload: Record<string, unknown> | null = null;
  let invitePayload: Record<string, unknown> | null = null;
  let operatorPayload: Record<string, unknown> | null = null;
  let roleCatalogueRequests = 0;

  await page.addInitScript((user) => {
    window.sessionStorage.setItem("persist:darshan", JSON.stringify({
      auth: JSON.stringify({ token: "global-manager-token", user, csrfToken: "csrf-token" }),
      _persist: JSON.stringify({ version: 1, rehydrated: true }),
    }));
    document.cookie = "csrf_token=csrf-token; path=/";
  }, globalActor);

  await page.route("**/api/v1/**", async (route: Route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (pathname === "/api/v1/auth/me" && method === "GET") return json(globalActor);
    if (pathname === "/api/v1/users/management-options" && method === "GET") return json(options);
    if (pathname === "/api/v1/roles" && method === "GET") {
      roleCatalogueRequests += 1;
      return json({ message: "Forbidden" }, 403);
    }
    if (pathname === "/api/v1/users/invite" && method === "GET") {
      return json({ items: [], pagination: { page: 1, limit: 9, total: 0 } });
    }
    if (pathname === "/api/v1/users" && method === "GET") {
      return json({ items: [], pagination: { page: 1, limit: 9, total: 0 } });
    }
    if (pathname === "/api/v1/users" && method === "POST") {
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      if (payload.role_id === operatorRoleId) operatorPayload = payload;
      else createPayload = payload;
      return json({
        ...target,
        id: payload.role_id === operatorRoleId ? "created-operator" : "created-admin",
        email: payload.email,
        first_name: payload.first_name,
        last_name: payload.last_name,
        role_id: payload.role_id,
        role: payload.role_id === operatorRoleId ? "OPERATOR" : "ADMIN",
        department_id: payload.department_id,
      }, 201);
    }
    if (pathname === "/api/v1/users/invite" && method === "POST") {
      invitePayload = route.request().postDataJSON() as Record<string, unknown>;
      return json({
        email: invitePayload.email,
        invite_token: "one-time-global-invite-token",
        invite_expires_at: "2026-10-28T00:00:00.000Z",
      }, 201);
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

  await page.goto("/users");
  await page.getByRole("button", { name: "Add User" }).click();
  await page.getByRole("menuitem", { name: "Create User Directly" }).click();
  const createDialog = page.getByRole("dialog", { name: "Create New User" });
  await createDialog.getByLabel("Email").fill("new-admin@example.test");
  await createDialog.getByLabel("First Name").fill("New");
  await createDialog.getByLabel("Last Name").fill("Admin");
  await createDialog.getByLabel("Password", { exact: true }).fill("ValidPass1!");
  await createDialog.getByLabel("Role").click();
  await page.getByRole("option", { name: "ADMIN" }).click();
  await createDialog.getByLabel("Department (Optional)").click();
  await page.getByRole("option", { name: "Department B" }).click();
  await expect(createDialog.getByRole("button", { name: "Create User" })).toBeEnabled();
  await createDialog.getByRole("button", { name: "Create User" }).click();
  await expect.poll(() => createPayload).toMatchObject({
    email: "new-admin@example.test",
    role_id: "role-admin",
    department_id: "dept-b",
  });

  await page.getByRole("button", { name: "Add User" }).click();
  await page.getByRole("menuitem", { name: "Create Invitation Link" }).click();
  const inviteDialog = page.getByRole("dialog", { name: "Invite User" });
  await inviteDialog.getByLabel("Email").fill("new-editor@example.test");
  await inviteDialog.getByLabel("Role").click();
  await page.getByRole("option", { name: "CONTENT_EDITOR" }).click();
  await inviteDialog.getByLabel("Department (Optional)").click();
  await page.getByRole("option", { name: "Department A" }).click();
  await expect(inviteDialog.getByRole("button", { name: "Create Invitation Link" })).toBeEnabled();
  await inviteDialog.getByRole("button", { name: "Create Invitation Link" }).click();
  await expect.poll(() => invitePayload).toMatchObject({
    email: "new-editor@example.test",
    role_id: "role-custom-editor",
    department_id: departmentId,
  });

  await page.goto("/operators");
  await page.getByRole("button", { name: "Add Operator" }).click();
  const operatorDialog = page.getByRole("dialog", { name: "Add Operator" });
  await operatorDialog.getByLabel("Email").fill("new-operator@example.test");
  await operatorDialog.getByLabel("Password", { exact: true }).fill("ValidPass1!");
  await operatorDialog.getByLabel("Confirm password").fill("ValidPass1!");
  await operatorDialog.getByLabel("Department").click();
  await page.getByRole("option", { name: "Department B" }).click();
  await expect(operatorDialog.getByRole("button", { name: "Create" })).toBeEnabled();
  await operatorDialog.getByRole("button", { name: "Create" }).click();
  await expect.poll(() => operatorPayload).toMatchObject({
    email: "new-operator@example.test",
    role_id: operatorRoleId,
    department_id: "dept-b",
  });
  expect(roleCatalogueRequests).toBe(0);
});

test("withdrawn User mutation permission closes invitation-only state and returns to the user directory", async ({ page }) => {
  let canCreate = true;
  const currentActor = () => ({
    ...actor,
    authorization: {
      is_global_user_manager: false,
      rules: [
        { action: "read", subject: "User" },
        ...(canCreate ? [{ action: "create", subject: "User" }] : []),
      ],
    },
  });

  await page.addInitScript((user) => {
    window.sessionStorage.setItem("persist:darshan", JSON.stringify({
      auth: JSON.stringify({ token: "permission-withdrawal-token", user, csrfToken: "csrf-token" }),
      _persist: JSON.stringify({ version: 1, rehydrated: true }),
    }));
    document.cookie = "csrf_token=csrf-token; path=/";
  }, currentActor());

  await page.route("**/api/v1/**", async (route: Route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (pathname === "/api/v1/auth/me" && method === "GET") return json(currentActor());
    if (pathname === "/api/v1/users/invite" && method === "GET") {
      return json({ items: [], pagination: { page: 1, limit: 9, total: 0 } });
    }
    if (pathname === "/api/v1/users" && method === "GET") {
      return json({ items: [target], pagination: { page: 1, limit: 9, total: 1 } });
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

  await page.goto("/users");
  await page.getByRole("tab", { name: /Awaiting Activation/ }).click();
  await expect(page.getByText("No invitations awaiting activation")).toBeVisible();

  canCreate = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));

  await expect(page.getByRole("tab", { name: /Awaiting Activation/ })).toHaveCount(0);
  await expect(page.getByText(target.email)).toBeVisible();
});
