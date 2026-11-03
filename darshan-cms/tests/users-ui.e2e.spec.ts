import { expect, test, type Page } from "@playwright/test";
import { ADMIN_TEST_ROLE_ID, ADMIN_TEST_USER_ID, testAuthorization, type TestCapability } from "./helpers/selfAuthorization";

const origin = "http://127.0.0.1:5173";
const actor = { id: ADMIN_TEST_USER_ID, email: "accounts@example.invalid", role_id: ADMIN_TEST_ROLE_ID, role: "CUSTOM", department_id: null };
const account = { id: "00000000-0000-4000-8000-000000000030", email: "person@example.invalid", first_name: "Alex", last_name: "Person", role_id: "custom-role", role: "CUSTOM", department_id: null, is_active: true };
const invitation = { id: "00000000-0000-4000-8000-000000000031", email: "invitee@example.invalid", role: "OPERATOR", invite_status: "PENDING", invited_at: "2026-11-03T00:00:00Z", invite_expires_at: "2026-11-10T00:00:00Z" };

async function setup(page: Page, grants: TestCapability[], options: { failUsers?: boolean; failInvites?: boolean } = {}) {
  let failUsers = Boolean(options.failUsers);
  let failInvites = Boolean(options.failInvites);
  let currentInvitation = invitation;
  const requests: string[] = [];
  await page.context().addCookies([
    { name: "access_token", value: "users-qa-session", url: origin, httpOnly: true, sameSite: "Lax" },
    { name: "csrf_token", value: "users-qa-csrf", url: origin, sameSite: "Lax" },
  ]);
  await page.route("**/config/app-config.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ cms: {
    environment: { name: "development", deploymentId: "qa", cmsId: "qa" },
    api: { baseUrl: new URL(route.request().url()).origin },
    realtime: { socketBaseUrl: new URL(route.request().url()).origin, socketTransports: ["websocket"] },
  } }) }));
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    requests.push(`${route.request().method()} ${url.pathname}${url.search}`);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/v1/auth/me") return json(actor);
    if (url.pathname === "/api/v1/auth/authorization") return json(testAuthorization(actor, grants, { roleId: ADMIN_TEST_ROLE_ID }));
    if (url.pathname === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    if (url.pathname === "/api/v1/roles") return json({ items: [{ id: "custom-role", name: "CUSTOM", is_system: false }], page: 1, limit: 100, total: 1 });
    if (url.pathname === "/api/v1/departments") return json({ items: [], page: 1, limit: 100, total: 0 });
    if (url.pathname === "/api/v1/users") return failUsers ? json({ error: { message: "Service unavailable" } }, 503) : json({ items: [account], pagination: { page: 1, limit: 9, total: 21 } });
    if (url.pathname === "/api/v1/users/invite" && route.request().method() === "POST") {
      currentInvitation = { ...invitation, email: (route.request().postDataJSON() as { email: string }).email };
      return json({ ...currentInvitation, invite_token: "initial-code", invite_expires_at: currentInvitation.invite_expires_at }, 201);
    }
    if (url.pathname === `/api/v1/users/invite/${currentInvitation.id}/reissue` && route.request().method() === "POST") {
      return json({ id: currentInvitation.id, email: currentInvitation.email, invite_token: "replacement-code", invite_expires_at: currentInvitation.invite_expires_at });
    }
    if (url.pathname === "/api/v1/users/invite") {
      if (failInvites) return json({ error: { message: "Service unavailable" } }, 503);
      const matches = !url.searchParams.get("email") || currentInvitation.email.includes(url.searchParams.get("email")!);
      return json({ items: matches ? [currentInvitation] : [], pagination: { page: 1, limit: 9, total: matches ? 1 : 0 } });
    }
    return json({});
  });
  return { requests, restoreUsers: () => { failUsers = false; }, restoreInvites: () => { failInvites = false; } };
}

test("read-only actor sees real total and no account mutations", async ({ page }) => {
  await setup(page, [{ action: "read", subject: "User" }]);
  await page.goto("/users");
  await expect(page.getByRole("tab", { name: "Users (21)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alex Person" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New User" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
});

test("custom-role update grant shows Edit without Create or Delete", async ({ page }) => {
  await setup(page, [{ action: "read", subject: "User" }, { action: "update", subject: "User" }]);
  await page.goto("/users");
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New User" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
});

test("invitation search uses server email filter across pages", async ({ page }) => {
  const state = await setup(page, [{ action: "read", subject: "User" }]);
  await page.goto("/users");
  await page.getByRole("tab", { name: /Invitations/ }).click();
  await expect(page.getByText("invitee@example.invalid")).toBeVisible();
  await page.getByRole("textbox", { name: "Search invitations by email" }).fill("missing@example.invalid");
  await expect(page.getByText("No matching invitations")).toBeVisible();
  expect(state.requests.some((value) => value.includes("email=missing%40example.invalid"))).toBe(true);
});

test("create and renew invitation show only the latest code until dismissed", async ({ page }) => {
  await setup(page, [{ action: "read", subject: "User" }, { action: "create", subject: "User" }, { action: "manage", subject: "User" }]);
  await page.goto("/users");
  await page.getByRole("button", { name: "New User" }).click();
  await page.getByRole("menuitem", { name: "Create Invitation" }).click();
  await page.getByLabel("Email", { exact: true }).fill("new@example.invalid");
  await page.getByRole("button", { name: "Create Invitation" }).click();
  await expect(page.getByRole("dialog", { name: "Invitation code ready" })).toContainText("initial-code");
  await expect(page.getByRole("dialog", { name: "Invitation code ready" })).toContainText("No email was sent");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("initial-code")).toHaveCount(0);
  await page.getByRole("tab", { name: /Invitations/ }).click();
  await expect(page.getByText("new@example.invalid")).toBeVisible();
  await page.getByRole("button", { name: "Renew code" }).click();
  await page.getByRole("button", { name: "Renew Code" }).click();
  await expect(page.getByRole("dialog", { name: "Invitation code ready" })).toContainText("replacement-code");
  await expect(page.getByText("initial-code")).toHaveCount(0);
});

test("initial User and invitation failures have independent Retry", async ({ page }) => {
  const state = await setup(page, [{ action: "read", subject: "User" }], { failUsers: true, failInvites: true });
  await page.goto("/users");
  await expect(page.getByText("Could not load users")).toBeVisible();
  state.restoreUsers();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "Alex Person" })).toBeVisible();
  await page.getByRole("tab", { name: /Invitations/ }).click();
  await expect(page.getByText("Could not load invitations")).toBeVisible();
  state.restoreInvites();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("invitee@example.invalid")).toBeVisible();
});

test("Users roster remains readable at phone, tablet and desktop widths", async ({ page }) => {
  await setup(page, [{ action: "read", subject: "User" }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Alex Person" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "../qa-artifacts/evidence/product-ui-users/phone-light.png", fullPage: true });
  await page.setViewportSize({ width: 820, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "../qa-artifacts/evidence/product-ui-users/desktop-light.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({ path: "../qa-artifacts/evidence/product-ui-users/phone-dark.png", fullPage: true });
});
