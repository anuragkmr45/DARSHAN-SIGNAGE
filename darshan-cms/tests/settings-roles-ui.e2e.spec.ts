import { expect, test, type Page } from "@playwright/test";
import { ADMIN_TEST_ROLE_ID, ADMIN_TEST_USER_ID, testAuthorization, type TestCapability } from "./helpers/selfAuthorization";

const origin = "http://127.0.0.1:5173";
const actor = { id: ADMIN_TEST_USER_ID, email: "roles@example.invalid", role_id: ADMIN_TEST_ROLE_ID, role: "SUPER_ADMIN", department_id: null };
const fixedRole = { id: ADMIN_TEST_ROLE_ID, name: "ADMIN", description: "Built-in administrator", permissions: { inherits: [], grants: [{ action: "manage", subject: "all" }] }, is_system: true };
const customRole = { id: "00000000-0000-4000-8000-000000000090", name: "SIGNAGE_REVIEWER", description: "Review content", permissions: { inherits: [], grants: [{ action: "read", subject: "Dashboard" }] }, is_system: false };
const roleGrants: TestCapability[] = [
  { action: "read", subject: "OrgSettings" },
  ...["read", "create", "update", "delete"].map((action) => ({ action, subject: "Role" })),
];

async function setup(page: Page, grants: TestCapability[], options: { metadataFails?: boolean; deleteFails?: boolean; failPage2?: boolean; actorRole?: string; extraRoles?: number } = {}) {
  const user = { ...actor, role: options.actorRole ?? actor.role };
  let metadataFails = Boolean(options.metadataFails);
  let deleteFails = Boolean(options.deleteFails);
  let failPage2 = Boolean(options.failPage2);
  const writes: { method: string; path: string; body?: unknown }[] = [];
  const roles = [fixedRole, customRole];
  const rolePages: number[] = [];
  for (let index = 0; index < (options.extraRoles ?? 0); index += 1) {
    roles.push({ ...customRole, id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`, name: `ROLE_${index}` });
  }

  await page.context().addCookies([
    { name: "access_token", value: "roles-qa-session", url: origin, httpOnly: true, sameSite: "Lax" },
    { name: "csrf_token", value: "roles-qa-csrf", url: origin, sameSite: "Lax" },
  ]);
  await page.route("**/config/app-config.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ cms: {
    environment: { name: "development", deploymentId: "qa", cmsId: "qa" },
    api: { baseUrl: new URL(route.request().url()).origin },
    realtime: { socketBaseUrl: new URL(route.request().url()).origin, socketTransports: ["websocket"] },
  } }) }));
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/v1/auth/me") return json(user);
    if (path === "/api/v1/auth/authorization") return json(testAuthorization(user, grants));
    if (path === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    if (path === "/api/v1/settings/general") return json({ company_name: "DARSHAN", timezone: "Asia/Kolkata", language: "en" });
    if (path === "/api/v1/settings/branding") return json({ app_name: "DARSHAN CMS", logo_media_id: null, icon_media_id: null, favicon_media_id: null, logo_url: null, icon_url: null, favicon_url: null });
    if (path === "/api/v1/settings/security") return json({ idle_timeout_minutes: 30, password_policy: { min_length: 12, require_uppercase: true, require_lowercase: true, require_number: true, require_special: true } });
    if (path === "/api/v1/settings/appearance") return json({ theme_mode: "light", accent_preset: "crimson", sidebar_mode: "expanded" });
    if (path === "/api/v1/settings/backups") return json({ automatic_enabled: true, interval_hours: 24, log_level: "info", external_sidecar: false, manual_run_supported: true });
    if (path === "/api/v1/settings/backups/history" || path === "/api/v1/settings/logs") return json({ items: [] });
    if (path === "/api/v1/roles" && method === "GET") {
      const pageNumber = Number(url.searchParams.get("page") ?? 1);
      const limit = Number(url.searchParams.get("limit") ?? 100);
      rolePages.push(pageNumber);
      if (pageNumber === 2 && failPage2) return json({ error: { message: "Unavailable" } }, 503);
      return json({ items: roles.slice((pageNumber - 1) * limit, pageNumber * limit), pagination: { page: pageNumber, limit, total: roles.length } });
    }
    if (path === "/api/v1/permissions/metadata") return metadataFails ? json({ error: { message: "Unavailable" } }, 503) : json({ actions: ["read", "create"], subjects: ["Dashboard", "Media"] });
    if (path === "/api/v1/roles" && method === "POST") {
      const body = route.request().postDataJSON();
      writes.push({ method, path, body });
      return json({ ...customRole, ...body, id: "00000000-0000-4000-8000-000000000091" }, 201);
    }
    if (path.startsWith("/api/v1/roles/") && method === "DELETE") {
      writes.push({ method, path });
      if (deleteFails) return json({ error: { message: "Role is assigned to users" } }, 409);
      roles.splice(roles.findIndex((role) => role.id === customRole.id), 1);
      return json({ success: true });
    }
    if (path.startsWith("/api/v1/roles/") && method === "PUT") {
      writes.push({ method, path, body: route.request().postDataJSON() });
      return json(customRole);
    }
    return json({});
  });
  return { writes, rolePages, restoreMetadata: () => { metadataFails = false; }, restoreDelete: () => { deleteFails = false; }, restorePage2: () => { failPage2 = false; } };
}

test("built-in roles are fixed; a read-only role sees no mutations", async ({ page }) => {
  const state = await setup(page, [{ action: "read", subject: "OrgSettings" }, { action: "read", subject: "Role" }], { actorRole: "CUSTOM_READER" });
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Roles" }).click();
  await expect(page.getByText("Built-in roles are fixed.", { exact: false })).toBeVisible();
  await expect(page.getByText("ADMIN", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Role" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});

test("custom role form requires complete unique grants and sends a valid description", async ({ page }) => {
  const state = await setup(page, roleGrants);
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Roles" }).click();
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(1);
  await page.getByRole("button", { name: "New Role" }).click();
  const dialog = page.getByRole("dialog", { name: "Create Role" });
  await dialog.getByLabel("Role name").fill("EVENT_REVIEWER");
  await dialog.getByRole("button", { name: "Add Grant" }).click();
  await expect(dialog.getByRole("button", { name: "Create Role" })).toBeDisabled();
  await dialog.getByRole("combobox", { name: "Permission 1 action" }).click();
  await page.getByRole("option", { name: "read" }).click();
  await dialog.getByRole("combobox", { name: "Permission 1 resource" }).click();
  await page.getByRole("option", { name: "Dashboard" }).click();
  await dialog.getByRole("button", { name: "Add Grant" }).click();
  await dialog.getByRole("combobox", { name: "Permission 2 action" }).click();
  await page.getByRole("option", { name: "read" }).click();
  await dialog.getByRole("combobox", { name: "Permission 2 resource" }).click();
  await page.getByRole("option", { name: "Dashboard" }).click();
  await expect(dialog.getByText("Each action and resource pair can be added once.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Create Role" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Remove permission 2" }).click();
  await dialog.getByRole("button", { name: "Create Role" }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0].body).toMatchObject({ name: "EVENT_REVIEWER", permissions: { inherits: [], grants: [{ action: "read", subject: "Dashboard" }] } });
  expect((state.writes[0].body as { description?: unknown }).description).toBeUndefined();
});

test("metadata failure prevents editing and Delete needs exact name; a conflict keeps the role", async ({ page }) => {
  const state = await setup(page, roleGrants, { metadataFails: true, deleteFails: true });
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Roles" }).click();
  await expect(page.getByText("Permission options could not be loaded.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Role" })).toBeDisabled();
  state.restoreMetadata();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("button", { name: "New Role" })).toBeEnabled();
  await page.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete role?" });
  await dialog.getByLabel("Role name").fill("wrong");
  await expect(dialog.getByRole("button", { name: "Delete" })).toBeDisabled();
  await dialog.getByLabel("Role name").fill(customRole.name);
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("dialog", { name: "Delete role?" })).toBeVisible();
  expect(state.writes.filter((item) => item.method === "DELETE")).toHaveLength(1);
  state.restoreDelete();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(customRole.name)).toHaveCount(0);
});

test("roles remain usable at phone, tablet and desktop widths", async ({ page }) => {
  await setup(page, roleGrants);
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Roles" }).click();
    await page.getByRole("button", { name: "New Role" }).click();
    await expect(page.getByRole("dialog", { name: "Create Role" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width !== 820) await page.screenshot({ path: `../qa-artifacts/evidence/product-ui-roles/${width}-dialog.png`, fullPage: true });
  }
});

test("roles beyond the first API page remain searchable and available for inheritance", async ({ page }) => {
  const state = await setup(page, roleGrants, { extraRoles: 105 });
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Roles" }).click();
  await expect.poll(() => state.rolePages).toContain(2);
  await expect(page.getByText("Showing 1–20 of 107 roles")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Showing 21–40 of 107 roles")).toBeVisible();
  await page.getByLabel("Find a role").fill("ROLE_104");
  await expect(page.getByText("ROLE_104", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New Role" }).click();
  const dialog = page.getByRole("dialog", { name: "Create Role" });
  await dialog.getByLabel("Role name").fill("INHERITS_LAST_PAGE");
  await dialog.getByText("ROLE_104", { exact: true }).click();
  await dialog.getByRole("button", { name: "Create Role" }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect((state.writes[0].body as { permissions: { inherits: string[] } }).permissions.inherits).toContain("00000000-0000-4000-8000-000000000204");
});

test("a later-page failure does not show a partial role directory", async ({ page }) => {
  const state = await setup(page, roleGrants, { extraRoles: 105, failPage2: true });
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Roles" }).click();
  await expect(page.getByText("Could not load roles.")).toBeVisible();
  await expect(page.getByText(customRole.name)).toHaveCount(0);
  state.restorePage2();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByLabel("Find a role")).toBeVisible();
  await expect.poll(() => state.rolePages.filter((value) => value === 2).length).toBe(2);
});
