import { expect, test, type Page, type Route } from "@playwright/test";
import {
  ADMIN_TEST_ROLE_ID,
  ADMIN_TEST_USER_ID,
  OPERATOR_TEST_ROLE_ID,
  adminCapabilities,
  testAuthorization,
} from "./helpers/selfAuthorization";

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
  token_prefix?: string;
  is_revoked?: boolean;
  created_at?: string;
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
  requests: RequestRecord[];
};

const adminUser: MockUser = {
  id: ADMIN_TEST_USER_ID,
  email: "admin@darshan.local",
  first_name: "Admin",
  last_name: "User",
  role_id: ADMIN_TEST_ROLE_ID,
  role: "ADMIN",
};

const limitedUser: MockUser = {
  id: "00000000-0000-4000-8000-000000000004",
  email: "operator@darshan.local",
  first_name: "Operator",
  last_name: "User",
  role_id: OPERATOR_TEST_ROLE_ID,
  role: "OPERATOR",
};

const adminRolesPayload = {
  items: [
    {
      id: ADMIN_TEST_ROLE_ID,
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
      id: OPERATOR_TEST_ROLE_ID,
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

    if (pathname === "/api/v1/auth/authorization" && method === "GET") {
      const capabilities = user.role === "ADMIN"
        ? adminCapabilities
        : [{ action: "read", subject: "Dashboard" }];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(testAuthorization(user, capabilities, { roleId: user.role_id })),
      });
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
        token_prefix: "sk_live_new_",
        is_revoked: false,
        created_at: "2026-04-15T10:00:00.000Z",
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
        item.id === id ? { ...item, is_revoked: true } : item,
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

    if (pathname === "/api/v1/reports/availability" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          range: {
            start_at: "2026-04-08T12:00:00.000Z",
            end_at: "2026-04-15T12:00:00.000Z",
            timezone: "Asia/Kolkata",
            offline_threshold_seconds: 90,
          },
          summary: {
            screens: 2,
            monitored_seconds: 1209600,
            online_seconds: 600000,
            estimated_offline_seconds: 3600,
            unknown_seconds: 605000,
            known_seconds: 603600,
            uptime_percent: 99.4,
          },
          screens: [
            {
              screen_id: "screen-seen",
              screen_name: "Reception Screen",
              last_heartbeat_at: "2026-04-15T11:59:30.000Z",
              never_seen: false,
              online_seconds: 600000,
              estimated_offline_seconds: 3600,
              unknown_seconds: 1000,
              known_seconds: 603600,
              uptime_percent: 99.4,
            },
            {
              screen_id: "screen-never-seen",
              screen_name: "New Screen",
              last_heartbeat_at: null,
              never_seen: true,
              online_seconds: 0,
              estimated_offline_seconds: 0,
              unknown_seconds: 604000,
              known_seconds: 0,
              uptime_percent: null,
            },
          ],
          daily: [],
        }),
      });
    }

    if (pathname === "/api/v1/audit-logs" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], total: 0 }) });
    }
    if (pathname === "/api/v1/notifications" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
    }
    if (pathname === "/api/v1/emergencies/status" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ active: false, active_count: 0 }) });
    }

    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) });
  });
};

test.describe("admin stabilization surfaces", () => {
  test("shows historical player availability without inventing downtime for never-seen screens", async ({ page }) => {
    await bootstrapSession(page, adminUser);
    await installCommonMocks(page, {
      user: adminUser,
      rolesPayload: adminRolesPayload,
      state: { apiKeys: [], webhooks: [], requests: [] },
    });

    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Reports & Logs" })).toBeVisible();
    await expect(page.getByText("99.4%", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "Reception Screen" })).toBeVisible();
    await expect(page.getByRole("row", { name: /New Screen/ }).getByText("Never seen").first()).toBeVisible();
    await expect(page.getByText(/Unknown time is excluded from uptime percentage/)).toBeVisible();
  });

  test("guards sensitive admin routes and omits unavailable global search", async ({ page }) => {
    await bootstrapSession(page, limitedUser);
    await installCommonMocks(page, {
      user: limitedUser,
      rolesPayload: limitedRolesPayload,
      state: {
        apiKeys: [],
        webhooks: [],
        requests: [],
      },
    });

    await page.goto("/dashboard");
    await expect(page.getByLabel("Global search unavailable")).toHaveCount(0);

    for (const path of ["/api-keys", "/webhooks", "/proof-of-play"]) {
      await page.goto(path);
      await page.waitForURL(/\/dashboard/);
    }
    await page.goto("/sso-config");
    await expect(page.getByRole("heading", { name: "This page could not be found" })).toBeVisible();
  });

  test("renders live admin surfaces from API-backed state instead of local placeholders", async ({ page }) => {
    const state: MockState = {
      apiKeys: [
        {
          id: "key-1",
          name: "Primary key",
          scopes: ["read", "write"],
          token_prefix: "sk_live_prim",
          is_revoked: false,
          created_at: "2026-04-15T09:00:00.000Z",
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
    await expect(page.getByText("Rotations key", { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Save this API key secret" })).toBeVisible();

    await page.goto("/webhooks");
    await expect(page.getByText("Publishing Alerts")).toBeVisible();
    await page.getByRole("button", { name: /add webhook/i }).click();
    await page.locator("#webhook-name").fill("Ops hook");
    await page.locator("#webhook-url").fill("https://hooks.example.test/ops");
    await page.getByLabel("Screen Comes Online").click();
    await page.getByRole("button", { name: /create webhook/i }).click();
    await expect(page.getByText("Ops hook")).toBeVisible();
    await page.getByRole("region", { name: "Publishing Alerts" }).getByRole("button", { name: "Test" }).click();
    await expect(page.getByText("Last test succeeded")).toBeVisible();

    await page.goto("/sso-config");
    await expect(page.getByRole("heading", { name: "This page could not be found" })).toBeVisible();

    await page.goto("/requests");
    await expect(page.getByRole("heading", { name: "This page could not be found" })).toBeVisible();
  });

  test("unknown routes stay inside the workspace and offer an authorized return path", async ({ page }, testInfo) => {
    await bootstrapSession(page, limitedUser);
    await installCommonMocks(page, {
      user: limitedUser,
      rolesPayload: limitedRolesPayload,
      state: { apiKeys: [], webhooks: [], requests: [] },
    });
    await page.goto("/unrecognized-page");
    await expect(page.getByRole("heading", { name: "This page could not be found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Dashboard" })).toHaveAttribute("href", "/dashboard");
    for (const width of [390, 820, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`not-found-${width}.png`) });
    }
    await page.getByRole("link", { name: "Open Dashboard" }).click();
    await page.waitForURL(/\/dashboard/);
  });
});
