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

const timelinePayload = {
  server_time: "2026-03-12T12:00:00.000Z",
  window_start: "2026-03-12T00:00:00.000Z",
  window_end: "2026-03-13T00:00:00.000Z",
  screens: [
    {
      id: "screen-1",
      name: "Lobby Screen",
      location: "Reception",
      health_state: "ONLINE",
      health_reason: "The screen is healthy and reporting recent heartbeats.",
      playback: {
        source: "SCHEDULE",
        heartbeat_received_at: "2026-03-12T11:59:20.000Z",
        current_media_id: "media-1",
        current_media: {
          id: "media-1",
          name: "Lobby Loop",
          type: "VIDEO",
          status: "READY",
        },
      },
      publish: {
        publish_id: "publish-1",
        schedule_id: "schedule-1",
      },
      timeline_items: [
        {
          id: "item-1",
          presentation_id: "presentation-1",
          presentation_name: "Morning Playlist",
          start_at: "2026-03-12T09:00:00.000Z",
          end_at: "2026-03-12T14:00:00.000Z",
          priority: 5,
          is_current: true,
        },
        {
          id: "item-2",
          presentation_id: "presentation-2",
          presentation_name: "Afternoon Playlist",
          start_at: "2026-03-12T14:00:00.000Z",
          end_at: "2026-03-12T18:00:00.000Z",
          priority: 4,
          is_current: false,
        },
      ],
    },
    {
      id: "screen-2",
      name: "Portrait Screen",
      location: "Lift Lobby",
      health_state: "ONLINE",
      health_reason: "The screen is healthy and reporting recent heartbeats.",
      playback: {
        source: "SCHEDULE",
        heartbeat_received_at: "2026-03-12T11:58:00.000Z",
        current_media_id: "media-2",
        current_media: {
          id: "media-2",
          name: "Portrait Promo",
          type: "IMAGE",
          status: "READY",
        },
      },
      publish: {
        publish_id: "publish-2",
        schedule_id: "schedule-2",
      },
      timeline_items: [
        {
          id: "item-3",
          presentation_id: "presentation-3",
          presentation_name: "Portrait Schedule",
          start_at: "2026-03-12T11:00:00.000Z",
          end_at: "2026-03-12T13:00:00.000Z",
          priority: 3,
          is_current: true,
        },
      ],
    },
  ],
};

const login = async (page: Page) => {
  await page.goto("/login");
  await page.fill("#login-email", adminUser.email);
  await page.fill("#login-password", "ChangeMe123!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
};

const installApiMocks = async (page: Page, overrides?: { emptyTimeline?: boolean }) => {
  const requestCounts = {
    scheduleTimeline: 0,
  };

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
          totals: { screens: 4 },
          screens: { total: 4, online_last_5m: 2, online: 2 },
          schedules: { active: 5, active_screens_now: overrides?.emptyTimeline ? 0 : 2 },
          storage: { media_bytes: 1024 },
          system_health: {
            status: "healthy",
            heartbeats: { last_5m: 2, last_1h: 8 },
            last_heartbeat_at: "2026-03-12T11:59:45.000Z",
          },
        }),
      });
    }

    if (pathname === "/api/v1/health" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "healthy" }) });
    }

    if (pathname === "/api/v1/reports/requests-by-department" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (pathname === "/api/v1/reports/offline-screens" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0, screens: [] }) });
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

    if (pathname === "/api/v1/screens/schedule-timeline" && method === "GET") {
      requestCounts.scheduleTimeline += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...timelinePayload,
          screens: overrides?.emptyTimeline ? [] : timelinePayload.screens,
        }),
      });
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
          playback: timelinePayload.screens[0].playback,
          active_items: [],
          upcoming_items: [],
        }),
      });
    }

    if (pathname === "/api/v1/screens/screen-1/status" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "screen-1",
          name: "Lobby Screen",
          status: "ACTIVE",
        }),
      });
    }

    if (pathname === "/api/v1/screens/overview" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          server_time: "2026-03-12T12:00:00.000Z",
          screens: [],
          groups: [],
          now_playing: [],
        }),
      });
    }

    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });

  return requestCounts;
};

test.describe("Dashboard active scheduled modal", () => {
  test("opens the modal and renders one timeline row per active scheduled screen", async ({ page }) => {
    const requestCounts = await installApiMocks(page);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await login(page);

    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    expect(requestCounts.scheduleTimeline).toBe(0);
    expect(consoleErrors).not.toContain(expect.stringContaining("Maximum update depth exceeded"));

    await page.getByText("Active Scheduled").click();

    await expect(page.getByRole("dialog", { name: "Active Scheduled" })).toBeVisible();
    await expect(page.getByTestId("active-scheduled-modal-rows")).toBeVisible();
    await expect(page.getByTestId("active-scheduled-row")).toHaveCount(2);
    await expect(page.getByText("Lobby Loop")).toBeVisible();
    await expect(page.getByText("Portrait Promo")).toBeVisible();
    await expect(page.getByTestId("active-scheduled-row").nth(0).getByText(/^Schedule$/)).toBeVisible();
    await expect(page.getByTestId("active-scheduled-row").nth(1).getByText(/^Schedule$/)).toBeVisible();
    await expect(page.getByTestId("schedule-timeline-graph")).toHaveCount(2);
    expect(requestCounts.scheduleTimeline).toBe(1);
    expect(consoleErrors).not.toContain(expect.stringContaining("Maximum update depth exceeded"));
  });

  test("shows an empty state when there are no active scheduled screens", async ({ page }) => {
    await installApiMocks(page, { emptyTimeline: true });
    await login(page);

    await page.getByText("Active Scheduled").click();

    await expect(page.getByRole("dialog", { name: "Active Scheduled" })).toBeVisible();
    await expect(page.getByText("No active scheduled screens")).toBeVisible();
  });
});
