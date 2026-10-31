import { expect, test } from "@playwright/test";

test.use({ ignoreHTTPSErrors: process.env.E2E_LOCAL_HTTPS === "true" });

test.beforeEach(async ({ page }) => {
  await page.route("**/config/app-config.json", (route) => {
    const origin = new URL(route.request().url()).origin;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        cms: {
          environment: { name: "development", deploymentId: "invite-test", cmsId: "cms-test" },
          api: { baseUrl: origin },
          realtime: { socketBaseUrl: origin, socketTransports: ["websocket"] },
        },
      }),
    });
  });
});

test("invitee activates from a one-time code before signing in", async ({ page }) => {
  let activation: { token: string; password: string } | undefined;
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/me") {
      return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { message: "Unauthenticated" } }) });
    }
    if (path === "/api/v1/users/activate") {
      activation = route.request().postDataJSON() as { token: string; password: string };
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true, user_id: "invitee-1" }) });
    }
    return route.fulfill({ status: 404 });
  });

  await page.goto("/activate#token=one-time-code");
  await expect(page.getByLabel("Activation code")).toHaveValue("one-time-code");
  await page.getByLabel("New password", { exact: true }).fill("StrongPassword123!");
  await page.getByLabel("Confirm new password").fill("DifferentPassword123!");
  await page.getByRole("button", { name: "Activate account" }).click();
  await expect(page.getByRole("alert")).toContainText("Passwords do not match");
  expect(activation).toBeUndefined();

  await page.getByLabel("Confirm new password").fill("StrongPassword123!");
  await page.getByRole("button", { name: "Activate account" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(activation).toEqual({ token: "one-time-code", password: "StrongPassword123!" });
  expect(page.url()).not.toContain("one-time-code");
});

test("expired token leaves the invitee on the activation page with a clear error", async ({ page }) => {
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/me") {
      return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { message: "Unauthenticated" } }) });
    }
    if (path === "/api/v1/users/activate") {
      return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "BAD_REQUEST", message: "Invite token expired" } }) });
    }
    return route.fulfill({ status: 404 });
  });

  await page.goto("/activate#token=expired-code");
  await page.getByLabel("New password", { exact: true }).fill("StrongPassword123!");
  await page.getByLabel("Confirm new password").fill("StrongPassword123!");
  await page.getByRole("button", { name: "Activate account" }).click();
  await expect(page.getByRole("alert")).toContainText("Invite token expired");
  await expect(page.getByLabel("New password", { exact: true })).toBeEmpty();
  await expect(page).toHaveURL(/\/activate#token=expired-code$/);
});

test("manager receives a one-time link and can replace it without an email-sent claim", async ({ page }) => {
  const manager = {
    id: "manager-1", email: "manager@example.test", first_name: "Manager", last_name: "One",
    role_id: "role-admin", role: "ADMIN", department_id: null,
    authorization: { rules: [{ action: "manage", subject: "all" }], is_global_user_manager: true },
  };
  await page.addInitScript((user) => {
    sessionStorage.setItem("persist:darshan", JSON.stringify({
      auth: JSON.stringify({ token: "manager-token", user, csrfToken: "csrf-token" }),
      _persist: JSON.stringify({ version: 1, rehydrated: true }),
    }));
  }, manager);
  const inviteId = "11111111-1111-4111-8111-111111111111";
  let created = 0;
  let replaced = 0;
  let replacementRequest: unknown;
  await page.route("**/api/v1/**", (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    const json = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/v1/auth/me") return json(manager);
    if (pathname === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    if (pathname === "/api/v1/users/management-options") return json({
      roles: [{ id: "role-operator", name: "OPERATOR" }], departments: [], is_global_user_manager: true,
    });
    if (pathname === "/api/v1/users/invite" && method === "POST") {
      created += 1;
      return json({ email: "invitee@example.test", invite_token: "secret-once", invite_expires_at: "2026-10-29T00:00:00.000Z" });
    }
    if (pathname === `/api/v1/users/invite/${inviteId}/replace` && method === "POST") {
      replaced += 1;
      replacementRequest = route.request().postDataJSON();
      return json({ email: "invitee@example.test", invite_token: "replacement-secret", invite_expires_at: "2026-10-29T00:00:00.000Z" });
    }
    if (pathname === "/api/v1/users/invite") return json({
      items: created ? [{
        id: inviteId, email: "invitee@example.test", role: "OPERATOR", invite_status: "PENDING",
        can_replace: true, updated_at: "2026-10-22T00:00:00.000Z",
      }] : [],
      pagination: { page: 1, limit: 9, total: created ? 1 : 0 },
    });
    if (pathname === "/api/v1/users") return json({ items: [], pagination: { page: 1, limit: 9, total: 0 } });
    return json({});
  });

  await page.goto("/users");
  await page.getByRole("button", { name: "Add User" }).click();
  await page.getByRole("menuitem", { name: "Create Invitation Link" }).click();
  await expect(page.getByRole("dialog", { name: "Invite User" })).toContainText("No email is sent automatically");
  await page.getByLabel("Email").fill("invitee@example.test");
  await page.getByRole("button", { name: "Create Invitation Link" }).click();
  const result = page.getByRole("dialog", { name: "Invitation link created" });
  await expect(result).toBeVisible();
  await expect(result.getByLabel("Activation link")).toHaveValue(/\/activate#token=secret-once$/);
  await expect(result).toContainText("shown only now");
  expect(created).toBe(1);
  await result.getByRole("button", { name: "Done" }).click();
  await expect(result).not.toBeVisible();
  await expect(page.getByLabel("Activation link")).toHaveCount(0);

  await page.getByRole("tab", { name: /Awaiting Activation/ }).click();
  await page.getByRole("button", { name: "Replace link" }).click();
  const confirmation = page.getByRole("dialog", { name: "Replace invitation link?" });
  await expect(confirmation).toContainText("existing link");
  await confirmation.getByRole("button", { name: "Replace link" }).click();
  const replacement = page.getByRole("dialog", { name: "Replacement link created" });
  await expect(replacement.getByLabel("Activation link")).toHaveValue(/\/activate#token=replacement-secret$/);
  expect(replaced).toBe(1);
  expect(replacementRequest).toEqual({ expected_updated_at: "2026-10-22T00:00:00.000Z" });
  await replacement.getByRole("button", { name: "Done" }).click();
  await expect(page.getByLabel("Activation link")).toHaveCount(0);
});
