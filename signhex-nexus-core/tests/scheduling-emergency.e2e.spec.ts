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
      created_at: "2026-03-14T00:00:00.000Z",
      updated_at: "2026-03-14T00:00:00.000Z",
    },
  ],
  page: 1,
  limit: 100,
  total: 1,
};

const layoutPayload = {
  items: [
    {
      id: "layout-1",
      name: "Lobby Layout",
      description: "Primary lobby layout",
      aspect_ratio: "16:9",
      spec: {
        slots: [{ id: "main", x: 0, y: 0, w: 1, h: 1 }],
      },
      created_at: "2026-03-14T00:00:00.000Z",
      updated_at: "2026-03-14T00:00:00.000Z",
    },
  ],
  pagination: {
    page: 1,
    limit: 100,
    total: 1,
  },
};

const aspectRatioPayload = {
  items: [{ id: "screen-1", name: "Lobby Screen", aspect_ratio: "16:9", aspect_ratio_name: "Widescreen" }],
  defaults: [{ id: null, name: "Widescreen", aspect_ratio: "16:9", aspect_ratio_name: "Widescreen", is_fallback: true }],
};

const mediaPayload = {
  items: [
    {
      id: "media-1",
      name: "Hero Loop",
      filename: "hero-loop.mp4",
      type: "VIDEO",
      status: "READY",
      media_url: "https://cdn.example.com/hero-loop.mp4",
      duration_seconds: 15,
    },
  ],
  page: 1,
  limit: 100,
  total: 1,
};

const screensPayload = {
  items: [
    {
      id: "screen-1",
      name: "Lobby Screen",
      location: "Reception",
      status: "ACTIVE",
    },
  ],
  page: 1,
  limit: 100,
  total: 1,
};

const emptyScheduleRequestList = {
  items: [],
  pagination: {
    page: 1,
    limit: 10,
    total: 0,
  },
};

const login = async (page: Page) => {
  await page.goto("/login");
  await page.fill("#login-email", adminUser.email);
  await page.fill("#login-password", "ChangeMe123!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
};

test.describe("Scheduling and emergency operator flow", () => {
  test("schedule creator persists audit timezone when creating a schedule", async ({ page }) => {
    let capturedSchedulePayload: Record<string, unknown> | null = null;

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

      if (pathname === "/api/v1/layouts" && method === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(layoutPayload) });
      }

      if (pathname === "/api/v1/screens/aspect-ratios" && method === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(aspectRatioPayload) });
      }

      if (pathname === "/api/v1/presentations" && method === "POST") {
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: "presentation-1",
            name: "Lobby Layout",
            layout_id: "layout-1",
          }),
        });
      }

      if (pathname === "/api/v1/presentations/presentation-1/slots" && method === "POST") {
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: "slot-assignment-1",
            presentation_id: "presentation-1",
            slot_id: "main",
            media_id: "media-1",
          }),
        });
      }

      if (pathname === "/api/v1/media" && method === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mediaPayload) });
      }

      if (pathname === "/api/v1/screens" && method === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(screensPayload) });
      }

      if (pathname === "/api/v1/screen-groups" && method === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [], page: 1, limit: 100, total: 0 }),
        });
      }

      if (pathname === "/api/v1/screens/screen-1/snapshot" && method === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ snapshot: { schedule: { items: [] } }, emergency: null }),
        });
      }

      if (pathname === "/api/v1/schedules" && method === "POST") {
        capturedSchedulePayload = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: "schedule-1",
            name: capturedSchedulePayload.name,
            description: capturedSchedulePayload.description,
            timezone: capturedSchedulePayload.timezone,
            start_at: capturedSchedulePayload.start_at,
            end_at: capturedSchedulePayload.end_at,
          }),
        });
      }

      if (pathname === "/api/v1/schedules/schedule-1/items" && method === "POST") {
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: "schedule-item-1",
            schedule_id: "schedule-1",
            presentation_id: "presentation-1",
          }),
        });
      }

      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    });

    await login(page);
    await page.goto("/schedule/new");

    await page.getByText("Lobby Layout", { exact: true }).click();
    await page.getByRole("button", { name: /^next$/i }).click();

    await page.getByRole("button", { name: "Add Media", exact: true }).click();
    await page.getByText("hero-loop.mp4", { exact: true }).click();
    await page.getByRole("button", { name: /^next$/i }).click();

    await page.getByText("Lobby Screen", { exact: true }).click();
    await page.getByRole("button", { name: /^next$/i }).click();

    await page.fill("#schedule-name", "Lobby Morning");
    await page.getByLabel("Schedule timezone").click();
    await page.getByRole("option", { name: "Asia/Kolkata" }).click();
    await page.fill("#start-at", "2026-03-15T09:00");
    await page.fill("#end-at", "2026-03-15T18:00");
    await page.getByRole("button", { name: /^next$/i }).click();

    await expect(page.getByText("Audit Timezone")).toBeVisible();
    await expect(page.getByText("Asia/Kolkata", { exact: true })).toBeVisible();
    expect(capturedSchedulePayload).not.toBeNull();
    expect(capturedSchedulePayload?.timezone).toBe("Asia/Kolkata");
  });

  test("emergency modal triggers and clears audited emergencies", async ({ page }) => {
    const state = {
      activeEmergencies: [
        {
          id: "emergency-1",
          message: "Lift outage advisory",
          severity: "HIGH",
          created_at: "2026-03-14T10:00:00.000Z",
          triggered_at: "2026-03-14T10:00:00.000Z",
          cleared_at: null,
          target_all: false,
          scope: "GROUP",
          screen_group_ids: ["group-1"],
          screen_ids: [],
          audit_note: "Ops escalation",
          is_active: true,
        },
      ],
    };

    let capturedTriggerPayload: Record<string, unknown> | null = null;
    let capturedClearPayload: Record<string, unknown> | null = null;

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

      if (pathname === "/api/v1/schedule-requests/status-summary" && method === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ counts: { pending: 0, approved: 0, rejected: 0, published: 0, expired: 0 } }),
        });
      }

      if (pathname === "/api/v1/schedule-requests" && method === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(emptyScheduleRequestList),
        });
      }

      if (pathname === "/api/v1/emergency/status" && method === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            active: state.activeEmergencies.length > 0,
            active_count: state.activeEmergencies.length,
            emergency: state.activeEmergencies[0] ?? null,
            active_emergencies: state.activeEmergencies,
          }),
        });
      }

      if (pathname === "/api/v1/media" && method === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mediaPayload) });
      }

      if (pathname === "/api/v1/screens" && method === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(screensPayload) });
      }

      if (pathname === "/api/v1/screen-groups" && method === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [
              {
                id: "group-1",
                name: "Reception Group",
                description: "Lobby and reception screens",
                screen_ids: ["screen-1"],
              },
            ],
            page: 1,
            limit: 100,
            total: 1,
          }),
        });
      }

      if (pathname === "/api/v1/emergency/trigger" && method === "POST") {
        capturedTriggerPayload = route.request().postDataJSON() as Record<string, unknown>;
        const created = {
          id: "emergency-2",
          message: String(capturedTriggerPayload.message ?? ""),
          severity: capturedTriggerPayload.severity ?? "CRITICAL",
          created_at: "2026-03-14T11:00:00.000Z",
          triggered_at: "2026-03-14T11:00:00.000Z",
          cleared_at: null,
          target_all: Boolean(capturedTriggerPayload.target_all),
          scope: "GLOBAL",
          screen_group_ids: [],
          screen_ids: [],
          audit_note: capturedTriggerPayload.audit_note ?? null,
          expires_at: capturedTriggerPayload.expires_at ?? null,
          is_active: true,
        };
        state.activeEmergencies = [created, ...state.activeEmergencies];
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            active: true,
            active_count: state.activeEmergencies.length,
            emergency: state.activeEmergencies[0],
            active_emergencies: state.activeEmergencies,
          }),
        });
      }

      if (pathname === "/api/v1/emergency/emergency-1/clear" && method === "POST") {
        capturedClearPayload = route.request().postDataJSON() as Record<string, unknown>;
        state.activeEmergencies = state.activeEmergencies.filter((entry) => entry.id !== "emergency-1");
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "emergency-1",
            cleared_at: "2026-03-14T11:05:00.000Z",
            clear_reason: capturedClearPayload.clear_reason,
          }),
        });
      }

      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    });

    await login(page);
    await page.goto("/schedule");

    await page.getByRole("button", { name: /emergency takeover/i }).click();

    const dialog = page.getByRole("dialog", { name: /emergency takeover/i });
    await expect(dialog.getByText("Lift outage advisory")).toBeVisible();

    await dialog.getByRole("button", { name: /^clear$/i }).click();
    await dialog.locator("#clear-reason-emergency-1").fill("Incident resolved");
    await dialog.getByRole("button", { name: /confirm clear/i }).click();
    await expect.poll(() => capturedClearPayload?.clear_reason).toBe("Incident resolved");

    await dialog.locator("#emergency-message").fill("Evacuate immediately");
    await dialog.getByLabel("Emergency severity").click();
    await page.getByRole("option", { name: "CRITICAL" }).click();
    await dialog.locator("#emergency-audit-note").fill("Fire drill initiated by facilities");
    await dialog.locator("#emergency-expires-at").fill("2026-03-14T18:00");
    await dialog.getByLabel("Emergency scope").click();
    await page.getByRole("option", { name: "All screens" }).click();
    await expect(dialog.getByText("System-wide override")).toBeVisible();
    await dialog.getByLabel("Emergency scope").click();
    await page.getByRole("option", { name: "Screen groups" }).click();
    await dialog.getByText("Reception Group", { exact: true }).click();
    await dialog.getByRole("button", { name: /activate emergency/i }).click();

    await expect.poll(() => capturedTriggerPayload).not.toBeNull();
    expect(capturedTriggerPayload?.screen_group_ids).toEqual(["group-1"]);
    expect(capturedTriggerPayload?.severity).toBe("CRITICAL");
    expect(capturedTriggerPayload?.audit_note).toBe("Fire drill initiated by facilities");
    expect(typeof capturedTriggerPayload?.expires_at).toBe("string");
    await expect(dialog.getByText("Evacuate immediately")).toBeVisible();
  });
});
