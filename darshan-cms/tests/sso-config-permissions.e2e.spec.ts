import { expect, test, type Page, type Route } from "@playwright/test";

const actor = (rules: Array<{ action: string; subject: string; conditions?: { id: string } }>) => ({
  id: "sso-permission-user",
  email: "sso-permission@example.test",
  role_id: "sso-permission-role",
  role: "SSO_PERMISSION_ROLE",
  department_id: null,
  authorization: { is_global_user_manager: false, rules },
});

async function mockSession(page: Page, rules: ReturnType<typeof actor>["authorization"]["rules"]) {
  const user = actor(rules);
  await page.addInitScript((signedInUser) => {
    window.sessionStorage.setItem("persist:darshan", JSON.stringify({
      auth: JSON.stringify({ token: "sso-permission-token", user: signedInUser, csrfToken: "csrf-token" }),
      _persist: JSON.stringify({ version: 1, rehydrated: true }),
    }));
    document.cookie = "csrf_token=csrf-token; path=/";
  }, user);
  const mutations: string[] = [];
  await page.route("**/api/v1/**", async (route: Route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/v1/auth/me") return json(user);
    if (pathname === "/api/v1/sso-config" && method === "GET") {
      return json({ items: [{
        id: "sso-config-one", provider: "oidc", issuer: "https://issuer.example.test",
        client_id: "fixture-client", client_secret: "fixture-only-secret", is_active: true,
      }] });
    }
    if (pathname.startsWith("/api/v1/sso-config") && method !== "GET") mutations.push(`${method} ${pathname}`);
    if (pathname === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    return json({ items: [] });
  });
  return mutations;
}

test("conditional SSO read does not open the global settings page", async ({ page }) => {
  const mutations = await mockSession(page, [
    { action: "read", subject: "Dashboard" },
    { action: "read", subject: "SsoConfig", conditions: { id: "sso-config-one" } },
  ]);
  await page.goto("/sso-config");
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(mutations).toEqual([]);
});

test("read-only SSO access keeps configuration mutation controls disabled", async ({ page }) => {
  const mutations = await mockSession(page, [{ action: "read", subject: "SsoConfig" }]);
  await page.goto("/sso-config");
  await expect(page.getByRole("heading", { name: "SSO / OIDC Configuration" })).toBeVisible();
  await expect(page.getByLabel("Issuer")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save Configuration" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeDisabled();
  expect(mutations).toEqual([]);
});
