import { expect, test, type Page } from "@playwright/test";
import { ADMIN_TEST_ROLE_ID, ADMIN_TEST_USER_ID, testAuthorization } from "./helpers/selfAuthorization";

const origin = "http://127.0.0.1:5173";
const user = {
  id: ADMIN_TEST_USER_ID, email: "keys-qa@example.invalid", first_name: "Key", last_name: "Operator",
  role_id: ADMIN_TEST_ROLE_ID, role: "ADMIN", department_id: null,
};
type Key = {
  id: string; name: string; token_prefix: string; scopes: string[]; is_revoked: boolean;
  created_at: string; last_used_at: string | null; expires_at?: string | null;
};
const initialKeys: Key[] = [
  { id: "key-active", name: "Site integration", token_prefix: "siteprefix12", scopes: ["read", "write"], is_revoked: false, created_at: "2026-10-31T10:00:00Z", last_used_at: null },
  { id: "key-revoked", name: "Retired integration", token_prefix: "oldprefix123", scopes: ["read"], is_revoked: true, created_at: "2026-10-30T10:00:00Z", last_used_at: null },
  { id: "key-expired", name: "Expired integration", token_prefix: "pastprefix12", scopes: ["read"], is_revoked: false, created_at: "2026-10-29T10:00:00Z", last_used_at: null, expires_at: "2026-10-30T00:00:00Z" },
];

async function setup(page: Page, actions: Array<"create" | "update" | "delete"> = ["create", "update", "delete"], seed = initialKeys) {
  const keys = seed.map((item) => ({ ...item }));
  const requests: string[] = [];
  let listFails = false;
  let revokeFails = false;
  await page.context().addCookies([
    { name: "access_token", value: "keys-qa-session", url: origin, httpOnly: true, sameSite: "Lax" },
    { name: "csrf_token", value: "keys-qa-csrf", url: origin, sameSite: "Lax" },
  ]);
  await page.route("**/config/app-config.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ cms: {
    environment: { name: "development", deploymentId: "qa", cmsId: "qa" },
    api: { baseUrl: new URL(route.request().url()).origin },
    realtime: { socketBaseUrl: new URL(route.request().url()).origin, socketTransports: ["websocket"] },
  } }) }));
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    requests.push(`${route.request().method()} ${url.pathname}`);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/v1/auth/me") return json(user);
    if (url.pathname === "/api/v1/auth/authorization") return json(testAuthorization(user, [
      { action: "read", subject: "ApiKey" },
      ...actions.map((action) => ({ action, subject: "ApiKey" })),
    ], { roleId: ADMIN_TEST_ROLE_ID }));
    if (url.pathname === "/api/v1/roles") return json({ items: [{ id: ADMIN_TEST_ROLE_ID, name: "ADMIN", permissions: { inherits: [], grants: [] } }], page: 1, limit: 100, total: 1 });
    if (url.pathname === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    if (url.pathname === "/api/v1/api-keys" && route.request().method() === "GET") {
      return listFails ? json({ error: "Unavailable" }, 503) : json({ items: keys, page: 1, limit: 100, total: keys.length });
    }
    if (url.pathname === "/api/v1/api-keys" && route.request().method() === "POST") {
      const payload = route.request().postDataJSON() as { name: string; scopes: string[]; roles?: string[] };
      if (payload.roles) return json({ error: "Unexpected role grant" }, 422);
      const key = { id: "key-created", name: payload.name, token_prefix: "createdprefix", scopes: payload.scopes, is_revoked: false, created_at: "2026-11-04T00:00:00Z", last_used_at: null };
      keys.unshift(key);
      return json({ ...key, secret: "one-time-created-secret" }, 201);
    }
    if (url.pathname === "/api/v1/api-keys/key-active/rotate" && route.request().method() === "POST") {
      const key = keys.find((item) => item.id === "key-active")!;
      key.token_prefix = "rotatedprefix";
      return json({ ...key, secret: "one-time-rotated-secret" });
    }
    if (url.pathname.endsWith("/revoke") && route.request().method() === "POST") {
      if (revokeFails) return json({ error: "Unavailable" }, 503);
      const id = url.pathname.split("/")[4];
      const key = keys.find((item) => item.id === id);
      if (key) key.is_revoked = true;
      return json(key ?? {});
    }
    return json({});
  });
  return { keys, requests, setListFails: (value: boolean) => { listFails = value; }, setRevokeFails: (value: boolean) => { revokeFails = value; } };
}

test("stored keys are visible while creation and rotation remain unavailable even with grants", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/api-keys");
  await expect(page.getByText("siteprefix12…", { exact: false })).toBeVisible();
  await expect(page.getByText("API keys cannot authenticate requests in this release.", { exact: false })).toBeVisible();
  await expect(page.getByRole("region", { name: "Retired integration" }).getByText("Revoked")).toBeVisible();
  await expect(page.getByRole("region", { name: "Expired integration" }).getByText("Expired", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Site integration" }).getByText("Stored", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create API Key" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rotate" })).toHaveCount(0);
  expect(state.requests.some((request) => request === "POST /api/v1/api-keys" || request.endsWith("/rotate"))).toBe(false);
});

test("revocation requires confirmation, reports failure, and preserves the key until success", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/api-keys");
  const row = page.getByRole("region", { name: "Site integration" });
  await row.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("dialog", { name: "Revoke API key?" }).getByRole("button", { name: "Cancel" }).click();
  await expect(row.getByText("Stored")).toBeVisible();
  state.setRevokeFails(true);
  await row.getByRole("button", { name: "Revoke" }).click();
  const dialog = page.getByRole("dialog", { name: "Revoke API key?" });
  await dialog.getByRole("button", { name: "Revoke key" }).click();
  await expect(dialog).toBeVisible();
  expect(state.keys[0]?.is_revoked).toBe(false);
  state.setRevokeFails(false);
  await dialog.getByRole("button", { name: "Revoke key" }).click();
  await expect(row.getByText("Revoked")).toBeVisible();
  await expect(row.getByRole("button", { name: "Rotate" })).toHaveCount(0);
});

test("read-only and failed-list states do not offer misleading management actions", async ({ page }) => {
  const state = await setup(page, [], []);
  state.setListFails(true);
  await page.goto("/api-keys");
  await expect(page.getByText("Unable to load API keys")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create API Key" })).toHaveCount(0);
  state.setListFails(false);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("No API keys", { exact: true })).toBeVisible();
});

test("API key list fits phone, tablet, desktop, and dark phone", async ({ page }) => {
  await setup(page);
  await page.goto("/api-keys");
  await expect(page.getByRole("region", { name: "Site integration" })).toBeVisible();
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `../qa-artifacts/evidence/product-ui-api-keys-policy/api-keys-${width}.png` });
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(() => window.localStorage.setItem("theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("region", { name: "Site integration" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
  await page.screenshot({ path: "../qa-artifacts/evidence/product-ui-api-keys-policy/api-keys-dark-390.png" });
});
