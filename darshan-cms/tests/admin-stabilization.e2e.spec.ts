import { expect, test, type Page, type Route } from "@playwright/test";

type MockUser = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role_id: string;
  role: string;
};

type ApiKeyRecord = {
  id: string;
  name: string;
  scopes?: string[];
  secret?: string;
  created_at?: string;
  revoked_at?: string | null;
};

type WebhookRecord = {
  id: string;
  name: string;
  event_types: string[];
  target_url: string;
  is_active?: boolean;
  last_status?: string | null;
  last_status_at?: string | null;
};

type SsoRecord = {
  id: string;
  provider: string;
  issuer: string;
  client_id: string;
  client_secret?: string;
  authorization_url?: string;
  token_url?: string;
  jwks_url?: string;
  redirect_uri?: string;
  scopes?: string[];
  is_active?: boolean;
};

type RequestRecord = {
  id: string;
  title: string;
  description?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  status?: string;
};

type MockState = {
  apiKeys: ApiKeyRecord[];
  webhooks: WebhookRecord[];
  sso: SsoRecord | null;
  requests: RequestRecord[];
};

const adminUser: MockUser = {
  id: "admin-user-id",
  email: "admin@darshan.local",
  first_name: "Admin",
  last_name: "User",
  role_id: "role-admin",
  role: "ADMIN",
};

const limitedUser: MockUser = {
  id: "operator-user-id",
  email: "operator@darshan.local",
  first_name: "Operator",
  last_name: "User",
  role_id: "role-operator",
  role: "OPERATOR",
};

const adminRolesPayload = {
  items: [
    {
      id: "role-admin",
      name: "ADMIN",
      description: "Administrator",
      permissions: {
        inherits: [],
        grants: [{ action: "manage", subject: "all" }],
      },
      is_system: true,
      created_at: "2026-04-15T00:00:00.000Z",
      updated_at: "2026-04-15T00:00:00.000Z",
    },
  ],
  page: 1,
  limit: 100,
  total: 1,
};

const limitedRolesPayload = {
  items: [
    {
      id: "role-operator",
      name: "OPERATOR",
      description: "Operator",
      permissions: {
        inherits: [],
        grants: [{ action: "read", subject: "Dashboard" }],
      },
      is_system: true,
      created_at: "2026-04-15T00:00:00.000Z",
      updated_at: "2026-04-15T00:00:00.000Z",
    },
  ],
  page: 1,
  limit: 100,
  total: 1,
};

const bootstrapSession = async (page: Page, user: MockUser) => {
  await page.addInitScript((bootUser) => {
    window.sessionStorage.setItem(
      "persist:darshan",
      JSON.stringify({
        auth: JSON.stringify({
          token: "cms-token",
          user: bootUser,
          csrfToken: "csrf-token",
        }),
        _persist: JSON.stringify({
          version: 1,
          rehydrated: true,
        }),
      }),
    );
    document.cookie = "csrf_token=csrf-token; path=/";
  }, user);
};

const installCommonMocks = async (
  page: Page,
  {
    user,
    rolesPayload,
    state,
  }: {
    user: MockUser;
    rolesPayload: typeof adminRolesPayload;
    state: MockState;
  },
) => {
  await page.route("**/api/v1/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    const method = route.request().method();

    if (pathname === "/api/v1/auth/logout" && method === "POST") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
    }

    if (pathname === "/api/v1/roles" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rolesPayload) });
    }

    if (pathname === "/api/v1/notifications/unread-count" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ unread_total: 0 }) });
    }

    if (pathname === "/api/v1/settings/branding" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          app_name: "DARSHAN CMS",
          logo_media_id: null,
          icon_media_id: null,
          favicon_media_id: null,
          logo_url: null,
          icon_url: null,
          favicon_url: null,
        }),
      });
    }

    if (pathname === "/api/v1/settings/appearance" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          theme_mode: "light",
          accent_preset: "amber",
          sidebar_mode: "expanded",
        }),
      });
    }

    if (pathname === "/api/v1/api-keys" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: state.apiKeys,
          page: 1,
          limit: 100,
          total: state.apiKeys.length,
        }),
      });
    }

    if (pathname === "/api/v1/api-keys" && method === "POST") {
      const payload = route.request().postDataJSON() as { name: string; scopes?: string[] };
      const created: ApiKeyRecord = {
        id: `key-${Date.now()}`,
        name: payload.name,
        scopes: payload.scopes ?? [],
        secret: "sk_live_new_key",
        created_at: "2026-04-15T10:00:00.000Z",
        revoked_at: null,
      };
      state.apiKeys.unshift(created);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(created) });
    }

    if (/^\/api\/v1\/api-keys\/[^/]+\/rotate$/.test(pathname) && method === "POST") {
      const id = pathname.split("/")[4]!;
      const current = state.apiKeys.find((item) => item.id === id);
      const rotated = {
        ...current,
        secret: "sk_live_rotated_key",
      };
      state.apiKeys = state.apiKeys.map((item) => (item.id === id ? rotated : item));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rotated) });
    }

    if (/^\/api\/v1\/api-keys\/[^/]+\/revoke$/.test(pathname) && method === "POST") {
      const id = pathname.split("/")[4]!;
      state.apiKeys = state.apiKeys.map((item) =>
        item.id === id ? { ...item, revoked_at: "2026-04-15T10:05:00.000Z" } : item,
      );
      const revoked = state.apiKeys.find((item) => item.id === id);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(revoked) });
    }

    if (pathname === "/api/v1/webhooks" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: state.webhooks }) });
    }

    if (pathname === "/api/v1/webhooks" && method === "POST") {
      const payload = route.request().postDataJSON() as {
        name: string;
        target_url: string;
        event_types: string[];
      };
      const created: WebhookRecord = {
        id: `webhook-${Date.now()}`,
        name: payload.name,
        target_url: payload.target_url,
        event_types: payload.event_types,
        is_active: true,
        last_status: null,
        last_status_at: null,
      };
      state.webhooks.unshift(created);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(created) });
    }

    if (/^\/api\/v1\/webhooks\/[^/]+$/.test(pathname) && method === "PATCH") {
      const id = pathname.split("/")[4]!;
      const payload = route.request().postDataJSON() as Partial<WebhookRecord>;
      state.webhooks = state.webhooks.map((item) => (item.id === id ? { ...item, ...payload } : item));
      const updated = state.webhooks.find((item) => item.id === id);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(updated) });
    }

    if (/^\/api\/v1\/webhooks\/[^/]+$/.test(pathname) && method === "DELETE") {
      const id = pathname.split("/")[4]!;
      state.webhooks = state.webhooks.filter((item) => item.id !== id);
      return route.fulfill({ status: 204, body: "" });
    }

    if (/^\/api\/v1\/webhooks\/[^/]+\/test$/.test(pathname) && method === "POST") {
      const id = pathname.split("/")[4]!;
      state.webhooks = state.webhooks.map((item) =>
        item.id === id
          ? {
              ...item,
              last_status: "SUCCESS",
              last_status_at: "2026-04-15T10:10:00.000Z",
            }
          : item,
      );
      const record = state.webhooks.find((item) => item.id === id)!;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          attempted: record.target_url,
          status_code: 202,
          sent_at: "2026-04-15T10:10:00.000Z",
        }),
      });
    }

    if (pathname === "/api/v1/sso-config" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: state.sso ? [state.sso] : [] }),
      });
    }

    if (pathname === "/api/v1/sso-config" && method === "POST") {
      const payload = route.request().postDataJSON() as SsoRecord;
      state.sso = {
        ...payload,
        id: state.sso?.id ?? "sso-config-1",
        is_active: true,
      };
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(state.sso) });
    }

    if (/^\/api\/v1\/sso-config\/[^/]+\/deactivate$/.test(pathname) && method === "POST") {
      const id = pathname.split("/")[4]!;
      const responseBody = state.sso ? { ...state.sso, id, is_active: false } : { id, is_active: false };
      state.sso = null;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(responseBody) });
    }

    if (pathname === "/api/v1/requests" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: state.requests,
          pagination: {
            page: 1,
            limit: 100,
            total: state.requests.length,
          },
        }),
      });
    }

    if (pathname === "/api/v1/requests" && method === "POST") {
      const payload = route.request().postDataJSON() as RequestRecord;
      const created: RequestRecord = {
        id: `request-${Date.now()}`,
        title: payload.title,
        description: payload.description,
        priority: payload.priority ?? "MEDIUM",
        status: "OPEN",
      };
      state.requests.unshift(created);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(created) });
    }

    if (pathname === "/api/v1/proof-of-play" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [],
          pagination: {
            page: 1,
            limit: 25,
            total: 0,
          },
        }),
      });
    }

    if (pathname === "/api/v1/reports/summary" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          notifications: { unread_total: 0 },
          proof_of_play: { total_events: 0, completed_events: 0, incomplete_events: 0 },
        }),
      });
    }

    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) });
  });
};

test.describe("admin stabilization surfaces", () => {
  test("guards sensitive admin routes and disables the global header search affordance", async ({ page }) => {
    await bootstrapSession(page, limitedUser);
    await installCommonMocks(page, {
      user: limitedUser,
      rolesPayload: limitedRolesPayload,
      state: {
        apiKeys: [],
        webhooks: [],
        sso: null,
        requests: [],
      },
    });

    await page.goto("/dashboard");
    await expect(page.getByLabel("Global search unavailable")).toBeDisabled();

    for (const path of ["/api-keys", "/webhooks", "/sso-config", "/proof-of-play", "/requests"]) {
      await page.goto(path);
      await page.waitForURL(/\/dashboard/);
    }
  });

  test("renders live admin surfaces from API-backed state instead of local placeholders", async ({ page }) => {
    const state: MockState = {
      apiKeys: [
        {
          id: "key-1",
          name: "Primary key",
          scopes: ["read", "write"],
          secret: "sk_live_primary",
          created_at: "2026-04-15T09:00:00.000Z",
          revoked_at: null,
        },
      ],
      webhooks: [
        {
          id: "webhook-1",
          name: "Publishing Alerts",
          target_url: "https://hooks.example.test/darshan",
          event_types: ["content.published"],
          is_active: true,
          last_status: null,
          last_status_at: null,
        },
      ],
      sso: {
        id: "sso-1",
        provider: "oidc",
        issuer: "https://issuer.example.test",
        client_id: "cms-client",
        client_secret: "super-secret",
        authorization_url: "https://issuer.example.test/authorize",
        token_url: "https://issuer.example.test/token",
        jwks_url: "https://issuer.example.test/jwks",
        redirect_uri: "http://127.0.0.1:5173/auth/callback",
        scopes: ["openid", "profile", "email"],
        is_active: true,
      },
      requests: [
        {
          id: "request-1",
          title: "Front desk announcement",
          description: "Refresh the lobby messaging.",
          priority: "HIGH",
          status: "OPEN",
        },
      ],
    };

    await bootstrapSession(page, adminUser);
    await installCommonMocks(page, {
      user: adminUser,
      rolesPayload: adminRolesPayload,
      state,
    });

    await page.goto("/api-keys");
    await expect(page.getByText("Primary key")).toBeVisible();
    await page.getByRole("button", { name: /create api key/i }).click();
    await page.locator("#key-name").fill("Rotations key");
    await page.getByLabel("Read").click();
    await page.getByRole("button", { name: /generate key/i }).click();
    await expect(page.getByText("Rotations key")).toBeVisible();

    await page.goto("/webhooks");
    await expect(page.getByText("Publishing Alerts")).toBeVisible();
    await page.getByRole("button", { name: /add webhook/i }).click();
    await page.locator("#webhook-name").fill("Ops hook");
    await page.locator("#webhook-url").fill("https://hooks.example.test/ops");
    await page.getByLabel("Screen Comes Online").click();
    await page.getByRole("button", { name: /create webhook/i }).click();
    await expect(page.getByText("Ops hook")).toBeVisible();
    await page.getByRole("row", { name: /publishing alerts/i }).getByRole("button", { name: /test/i }).click();
    await expect(page.getByText("Healthy")).toBeVisible();

    await page.goto("/sso-config");
    await expect(page.locator("#issuer")).toHaveValue("https://issuer.example.test");
    await expect(page.getByRole("button", { name: /test connection/i })).toHaveCount(0);
    await page.locator("#issuer").fill("https://issuer.updated.test");
    await page.getByRole("button", { name: /save configuration/i }).click();
    await page.reload();
    await expect(page.locator("#issuer")).toHaveValue("https://issuer.updated.test");
    await page.getByRole("button", { name: /disconnect/i }).click();
    await page.reload();
    await expect(page.getByText("Active")).toHaveCount(0);

    await page.goto("/requests");
    await expect(page.getByText("Front desk announcement")).toBeVisible();
    await page.getByRole("button", { name: /new request/i }).click();
    await page.locator("#request-title").fill("Poster correction");
    await page.locator("#request-description").fill("Fix the room number on the portrait poster.");
    await page.getByRole("button", { name: /^submit$/i }).click();
    await expect(page.getByText("Poster correction")).toBeVisible();
  });
});
