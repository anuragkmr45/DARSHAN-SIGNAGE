import { expect, test, type Page, type Route } from "@playwright/test";
import { ADMIN_TEST_ROLE_ID, ADMIN_TEST_USER_ID, adminAuthorization } from "./helpers/selfAuthorization";

const adminUser = {
  id: ADMIN_TEST_USER_ID,
  email: "admin@darshan.local",
  first_name: "Admin",
  last_name: "User",
  role_id: ADMIN_TEST_ROLE_ID,
  role: "ADMIN",
};

const rolesPayload = {
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
  await page.fill("#login-password", "LocalDev@123");
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

    if (pathname === "/api/v1/auth/authorization" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(adminAuthorization(adminUser)) });
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
          schedules: {
            active: 5,
            active_screens_now: overrides?.emptyTimeline ? 0 : 2,
            assigned_screens_now: overrides?.emptyTimeline ? 0 : 2,
            applied_screens_now: overrides?.emptyTimeline ? 0 : 2,
            reporting_playback_now: overrides?.emptyTimeline ? 0 : 1,
            proof_observed_now: overrides?.emptyTimeline ? 0 : 1,
          },
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

    if (pathname === "/api/v1/observability/overview" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        fleet: { total_players: 4, online_players: 2, active_players: 3, inactive_players: 0, offline_players: 1, reachable_players: null, configured_player_targets: null },
        alerts: { available: true, firing: 0, status: "healthy" },
        machines: [],
        grafana: { enabled: true, links: { backend_service: "/grafana/d/darshan-vm2-backend", players_fleet: "/grafana/d/darshan-players-fleet" } },
      }) });
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

    if (pathname === "/api/v1/reports/schedules" && method === "GET") {
      const now = new Date().toISOString();
      const entry = {
        publish_id: "publish-1", schedule_id: "schedule-1", schedule_name: "Lobby rotation",
        target_id: "screen-1", target_name: "Lobby Screen", target_type: "screen",
        published_at: now, taken_down_at: null, schedule_start_at: now,
        schedule_end_at: new Date(Date.now() + 3600000).toISOString(),
        lifecycle_status: "ACTIVE", target_status: "SUCCESS", target_error: null,
        applied_at: now, proof_observed: true, proof_observed_at: now,
      };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        range_start: new Date(Date.now() - 86400000).toISOString(), range_end: now,
        summary: {
          schedules: 1, target_events: 1, assigned_targets: 1, applied_targets: 1,
          proof_observed_targets: 1, pending_targets: 0, successful_targets: 1,
          failed_targets: 0, screens: 1, groups: 0,
        },
        by_screen: [{ target_id: "screen-1", target_name: "Lobby Screen", target_type: "screen", latest_activity_at: now, entries: [entry] }],
        by_group: [],
      }) });
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
  test("explains explicit group targets and untaken-down publishes in the schedule report", async ({ page }) => {
    await installApiMocks(page);
    await login(page);
    await page.getByRole("button", { name: "Schedule Report" }).click();
    const dialog = page.getByRole("dialog", { name: "Schedule Report" });
    await expect(dialog.getByText("By Explicit Screen Group")).toBeVisible();
    await expect(dialog.getByText("No group-targeted schedule activity was found for the selected range.")).toBeVisible();
    await expect(dialog.getByText("Player-applied targets")).toBeVisible();
    await expect(dialog.getByText("Targets with playback proof")).toBeVisible();
    await expect(dialog.getByText(/Applied:/)).toBeVisible();
    await expect(dialog.getByText(/Playback proof:/)).toBeVisible();
    await expect(dialog.getByText("Not taken down").first()).toBeVisible();
  });

  test("shows database fleet totals separately from optional player scrapes and opens valid Grafana links", async ({ page }) => {
    await installApiMocks(page);
    await page.route("**/grafana/api/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ database: "ok" }) }));
    await page.route("**/grafana/login", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "Grafana login" }));
    await login(page);
    await expect(page.getByText("2 screens not online")).toBeVisible();
    await expect(page.getByText("Online (5m) 2 · Status offline 1")).toBeVisible();
    await expect(page.getByText("Direct player scrapes (optional)")).toBeVisible();
    await expect(page.getByText("Players can be online without direct scrape targets")).toBeVisible();
    await expect(page.getByText("2 applied · 1 reporting playback · 1 with proof")).toBeVisible();
    await expect(page.getByRole("link", { name: "Backend" })).toHaveAttribute("href", "/grafana/d/darshan-vm2-backend");
  });

  test("does not offer broken Grafana links when the CMS proxy is unavailable", async ({ page }) => {
    await installApiMocks(page);
    await page.route("**/grafana/api/health", (route) => route.fulfill({ status: 502, body: "Bad Gateway" }));
    await login(page);
    await expect(page.getByText("Grafana unavailable through this CMS")).toBeVisible();
    await expect(page.getByRole("link", { name: "Backend" })).toHaveCount(0);
  });

  test("detects a Grafana login redirect loop despite a healthy API", async ({ page }) => {
    await installApiMocks(page);
    await page.route("**/grafana/api/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ database: "ok" }) }));
    await page.route("**/grafana/login", (route) => route.fulfill({ status: 301, headers: { location: "/grafana/login" } }));
    await login(page);
    await expect(page.getByText("Grafana unavailable through this CMS")).toBeVisible();
    await expect(page.getByRole("link", { name: "Backend" })).toHaveCount(0);
  });

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
