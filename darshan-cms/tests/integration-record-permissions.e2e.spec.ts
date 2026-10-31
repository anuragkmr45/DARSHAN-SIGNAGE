import { expect, test } from "@playwright/test";

test("integration controls honor record grants and keep one-time secrets out of persistence", async ({ page }) => {
  const allowedKeyName = "Allowed automation key";
  const allowedWebhookName = "Allowed operations hook";
  const user = {
    id: "integration-user",
    email: "integration@cms.test",
    first_name: "Integration",
    last_name: "Manager",
    role_id: "integration-role",
    role: "INTEGRATION_MANAGER",
    department_id: null,
    authorization: {
      is_global_user_manager: false,
      rules: [
        { action: "read", subject: "ApiKey" },
        { action: "create", subject: "ApiKey", conditions: { name: allowedKeyName } },
        { action: "update", subject: "ApiKey", conditions: { id: "key-allowed" } },
        { action: "delete", subject: "ApiKey", conditions: { id: "key-allowed" } },
        { action: "read", subject: "Webhook" },
        { action: "create", subject: "Webhook", conditions: { name: allowedWebhookName } },
        { action: "update", subject: "Webhook", conditions: { id: "webhook-allowed" } },
        { action: "delete", subject: "Webhook", conditions: { id: "webhook-allowed" } },
      ],
    },
  };
  const keys = [
    {
      id: "key-allowed",
      name: "Existing allowed key",
      token_prefix: "allowedpref1",
      scopes: ["read"],
      roles: ["ADMIN"],
      is_revoked: false,
      created_at: "2026-10-27T00:00:00.000Z",
      last_used_at: null,
    },
    {
      id: "key-denied",
      name: "Existing denied key",
      token_prefix: "deniedpref12",
      scopes: ["read"],
      roles: ["ADMIN"],
      is_revoked: false,
      created_at: "2026-10-27T00:00:00.000Z",
      last_used_at: null,
    },
  ];
  const webhooks = [
    {
      id: "webhook-allowed",
      name: "Existing allowed hook",
      target_url: "https://hooks.example.test/allowed",
      event_types: ["content.published"],
      is_active: true,
      last_status: null,
      last_status_at: null,
    },
    {
      id: "webhook-denied",
      name: "Existing denied hook",
      target_url: "https://hooks.example.test/denied",
      event_types: ["content.published"],
      is_active: true,
      last_status: null,
      last_status_at: null,
    },
  ];

  await page.route("**/config/app-config.json", (route) => {
    const origin = new URL(route.request().url()).origin;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        cms: {
          environment: { name: "development", deploymentId: "integration-permissions", cmsId: "cms-test" },
          api: { baseUrl: origin },
          realtime: { socketBaseUrl: origin, socketTransports: ["websocket"] },
        },
      }),
    });
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const json = (body: unknown, status = 200, headers?: Record<string, string>) => route.fulfill({
      status,
      headers,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
    if (pathname === "/api/v1/auth/me") return json(user);
    if (pathname === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    if (pathname === "/api/v1/api-keys" && request.method() === "GET") {
      return json({ items: keys, total: keys.length, page: 1, limit: 100 });
    }
    if (pathname === "/api/v1/api-keys" && request.method() === "POST") {
      const body = request.postDataJSON() as { name: string; scopes: string[] };
      const created = {
        id: "key-created",
        name: body.name,
        token_prefix: "createdpref1",
        scopes: body.scopes,
        roles: ["ADMIN"],
        is_revoked: false,
        secret: "created-api-key-secret",
        created_at: "2026-10-27T00:00:00.000Z",
      };
      keys.push(created);
      return json(created, 201, { "cache-control": "no-store" });
    }
    if (pathname === "/api/v1/webhooks" && request.method() === "GET") return json({ items: webhooks });
    if (pathname === "/api/v1/webhooks" && request.method() === "POST") {
      const body = request.postDataJSON() as { name: string; target_url: string; event_types: string[] };
      const created = {
        id: "webhook-created",
        name: body.name,
        target_url: body.target_url,
        event_types: body.event_types,
        is_active: true,
        last_status: null,
        last_status_at: null,
        secret: "created-webhook-signing-secret",
      };
      webhooks.push(created);
      return json(created, 201, { "cache-control": "no-store" });
    }
    return json({});
  });

  await page.goto("/api-keys");
  await expect(page.getByText("Existing allowed key", { exact: true })).toBeVisible();
  const allowedKeyRow = page.getByRole("row", { name: /Existing allowed key/ });
  const deniedKeyRow = page.getByRole("row", { name: /Existing denied key/ });
  await expect(allowedKeyRow.getByLabel("Rotate API key")).toBeEnabled();
  await expect(allowedKeyRow.getByLabel("Revoke API key")).toBeEnabled();
  await expect(deniedKeyRow.getByLabel("Rotate API key")).toBeDisabled();
  await expect(deniedKeyRow.getByLabel("Revoke API key")).toBeDisabled();

  await page.getByRole("button", { name: "Create API Key" }).click();
  await page.getByLabel("API Key Name").fill("Denied key name");
  await page.getByLabel("Read").click();
  await expect(page.getByRole("button", { name: "Generate Key" })).toBeDisabled();
  await page.getByLabel("API Key Name").fill(allowedKeyName);
  await page.getByRole("button", { name: "Generate Key" }).click();
  const createdKeyRow = page.getByRole("row", { name: new RegExp(allowedKeyName) });
  await createdKeyRow.getByLabel("Show or hide one-time API key").click();
  await expect(createdKeyRow.getByText("created-api-key-secret", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("persist:darshan") ?? ""))
    .not.toContain("created-api-key-secret");

  await page.goto("/webhooks");
  const allowedWebhookRow = page.getByRole("row", { name: /Existing allowed hook/ });
  const deniedWebhookRow = page.getByRole("row", { name: /Existing denied hook/ });
  await expect(allowedWebhookRow.getByRole("button", { name: "Test" })).toBeEnabled();
  await expect(allowedWebhookRow.getByRole("button", { name: "Deactivate" })).toBeEnabled();
  await expect(allowedWebhookRow.getByRole("button", { name: "Delete" })).toBeEnabled();
  await expect(deniedWebhookRow.getByRole("button", { name: "Test" })).toBeDisabled();
  await expect(deniedWebhookRow.getByRole("button", { name: "Deactivate" })).toBeDisabled();
  await expect(deniedWebhookRow.getByRole("button", { name: "Delete" })).toBeDisabled();

  await page.getByRole("button", { name: "Add Webhook" }).click();
  await page.getByLabel("Name").fill("Denied webhook name");
  await page.getByLabel("Webhook URL").fill("https://hooks.example.test/new");
  await page.getByLabel("Content Published").click();
  await expect(page.getByRole("button", { name: "Create Webhook" })).toBeDisabled();
  await page.getByLabel("Name").fill(allowedWebhookName);
  await page.getByRole("button", { name: "Create Webhook" }).click();
  await expect(page.getByRole("heading", { name: "Copy webhook signing secret" })).toBeVisible();
  await expect(page.getByLabel("Signing secret")).toHaveValue("created-webhook-signing-secret");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("persist:darshan") ?? ""))
    .not.toContain("created-webhook-signing-secret");
});
