import { expect, test, type Page, type Route } from "@playwright/test";

const adminUser = {
  id: "admin-user-id",
  email: "admin@hexmon.local",
  first_name: "Admin",
  last_name: "User",
  role_id: "role-admin",
  role: "ADMIN",
};

const rolesPayload = {
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
      created_at: "2026-03-12T00:00:00.000Z",
      updated_at: "2026-03-12T00:00:00.000Z",
    },
  ],
  page: 1,
  limit: 100,
  total: 1,
};

const overviewPayload = {
  server_time: "2026-03-12T12:00:00.000Z",
  screens: [
    {
      id: "screen-1",
      name: "Lobby Screen",
      location: "Reception",
      status: "ACTIVE",
      health_state: "ONLINE",
      last_heartbeat_at: "2026-03-12T11:59:30.000Z",
      playback: {
        source: "SCHEDULE",
        current_media_id: "media-1",
        current_media: {
          id: "media-1",
          name: "Lobby Loop",
          filename: "lobby-loop.mp4",
          type: "VIDEO",
          status: "READY",
        },
      },
      preview: {
        captured_at: "2026-03-12T11:59:45.000Z",
        screenshot_url: "https://cdn.example.com/lobby-preview.png",
        stale: false,
      },
    },
    {
      id: "screen-2",
      name: "Portrait Screen",
      location: "Lift Lobby",
      status: "ACTIVE",
      health_state: "ONLINE",
      last_heartbeat_at: "2026-03-12T11:58:40.000Z",
      playback: {
        source: "DEFAULT",
        current_media_id: "media-2",
        current_media: {
          id: "media-2",
          name: "Portrait Fallback",
          filename: "portrait-fallback.png",
          type: "IMAGE",
          status: "READY",
        },
      },
      preview: {
        captured_at: "2026-03-12T11:57:00.000Z",
        screenshot_url: null,
        stale: true,
      },
    },
    {
      id: "screen-3",
      name: "Offline Screen",
      location: "Storage",
      status: "OFFLINE",
      health_state: "OFFLINE",
      last_heartbeat_at: "2026-03-12T09:00:00.000Z",
      playback: {
        source: "UNKNOWN",
        current_media_id: null,
      },
      preview: null,
    },
  ],
  groups: [],
  now_playing: [],
  stats: {
    total_screens: 3,
    active_screens: 2,
    offline_screens: 1,
    total_groups: 0,
  },
};

const login = async (page: Page) => {
  await page.goto("/login");
  await page.fill("#login-email", adminUser.email);
  await page.fill("#login-password", "ChangeMe123!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
};

const installApiMocks = async (page: Page) => {
  await page.route("**/api/v1/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    const method = route.request().method();

    if (pathname === "/api/v1/auth/login" && method === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "cms-token",
          csrf_token: "csrf-token",
          user: adminUser,
        }),
      });
    }

    if (pathname === "/api/v1/auth/logout" && method === "POST") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
    }

    if (pathname === "/api/v1/roles" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rolesPayload) });
    }

    if (pathname === "/api/v1/notifications/unread-count" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ unread_total: 0 }) });
    }

    if (pathname === "/api/v1/metrics/overview" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totals: { screens: 3 },
          screens: { total: 3, online_last_5m: 2, online: 2 },
          schedules: { active: 1 },
          storage: { media_bytes: 1024 },
          system_health: {
            status: "healthy",
            heartbeats: { last_5m: 2, last_1h: 6 },
            last_heartbeat_at: "2026-03-12T11:59:45.000Z",
          },
        }),
      });
    }

    if (pathname === "/api/v1/health" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "healthy" }),
      });
    }

    if (pathname === "/api/v1/reports/requests-by-department" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (pathname === "/api/v1/reports/offline-screens" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 1, screens: [] }) });
    }

    if (pathname === "/api/v1/reports/storage" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ storage: { media_bytes: 1024, quota_bytes: 4096, quota_percent: 25 } }),
      });
    }

    if (pathname === "/api/v1/reports/system-health" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          transcode_queue: { pending: 0 },
          jobs: { failed_last_24h: 0 },
          publishes: { last_published_at: "2026-03-12T11:00:00.000Z" },
          operators: { active: 1 },
        }),
      });
    }

    if (pathname === "/api/v1/screens/overview" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(overviewPayload) });
    }

    if (pathname === "/api/v1/screens/screen-1" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "screen-1",
          name: "Lobby Screen",
          location: "Reception",
          status: "ACTIVE",
        }),
      });
    }

    if (pathname === "/api/v1/screens/screen-1/now-playing" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          server_time: "2026-03-12T12:00:00.000Z",
          screen_id: "screen-1",
          status: "ACTIVE",
          health_state: "ONLINE",
          health_reason: "The screen is healthy and reporting recent heartbeats.",
          last_heartbeat_at: "2026-03-12T11:59:30.000Z",
          playback: overviewPayload.screens[0].playback,
          preview: overviewPayload.screens[0].preview,
          active_items: [],
          upcoming_items: [],
        }),
      });
    }

    if (pathname === "/api/v1/screens/screen-1/availability" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ screen_id: "screen-1", is_available: true, current_schedule_id: "schedule-1" }),
      });
    }

    if (pathname === "/api/v1/screens/screen-1/snapshot" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ screen_id: "screen-1", publish: null, snapshot: null, emergency: null, default_media: null }),
      });
    }

    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });
};

test.describe("Dashboard online screens modal", () => {
  test("shows only online screens with latest preview and actual media", async ({ page }) => {
    await installApiMocks(page);
    await login(page);

    await page.getByRole("button", { name: /online screens/i }).click();

    await expect(page.getByRole("dialog", { name: "Online Screens Details" })).toBeVisible();
    await expect(page.getByTestId("online-screens-grid")).toHaveClass(/xl:grid-cols-3/);
    await expect(page.getByTestId("online-screen-card")).toHaveCount(2);

    await expect(page.getByText("Lobby Screen", { exact: true })).toBeVisible();
    await expect(page.getByText("Playing Lobby Loop", { exact: true })).toBeVisible();
    await expect(page.getByText("No screenshot yet", { exact: true })).toBeVisible();
    await expect(page.getByText("Offline Screen", { exact: true })).not.toBeVisible();

    await page.getByLabel("Open details for Lobby Screen").click();
    await expect(page.getByRole("dialog", { name: /lobby screen/i })).toBeVisible();
  });
});
