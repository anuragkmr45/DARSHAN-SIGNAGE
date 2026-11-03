import { expect, test, type Page, type Route } from "@playwright/test";

type ScreenRecord = {
  id: string;
  name: string;
  location?: string | null;
  status: string;
  health_state?: string;
  health_reason?: string | null;
  auth_diagnostics?: {
    state?: string;
    reason?: string;
  } | null;
  active_pairing?: {
    id?: string;
    mode?: string | null;
    confirmed?: boolean;
    expires_at?: string | null;
  } | null;
  last_heartbeat_at?: string | null;
  active_items?: unknown[];
  upcoming_items?: unknown[];
};

type MockState = {
  screens: ScreenRecord[];
  groups: Array<{ id: string; name: string; screen_ids?: string[] }>;
  pairings: Array<Record<string, unknown>>;
  recoveryByDeviceId: Record<string, unknown>;
  confirmModeByCode: Record<string, "PAIRING" | "RECOVERY">;
  screenDeleteBlocked?: boolean;
  groupDeleteBlocked?: boolean;
  observabilityScrapeStatus?: "up" | "unconfigured" | "unavailable";
  observabilityMetricsSource?: "prometheus" | "backend_heartbeat";
  grafanaEmbed?: boolean;
  grafanaAuthenticated?: boolean;
};

const adminUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@darshan.local",
  first_name: "Admin",
  last_name: "User",
  role_id: "00000000-0000-4000-8000-000000000002",
  role: "ADMIN",
};

const rolesPayload = {
  items: [
    {
      id: "00000000-0000-4000-8000-000000000002",
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

const permissionActions = ["create", "read", "update", "delete", "manage", "approve", "publish"];
const permissionSubjects = [
  "User", "Department", "Media", "Layout", "Presentation", "Schedule", "ScheduleItem",
  "ScheduleRequest", "LiveBroadcast", "Screen", "ScreenGroup", "Notification", "AuditLog",
  "DevicePairing", "Emergency", "EmergencyType", "ApiKey", "Webhook", "SsoConfig",
  "OrgSettings", "Conversation", "ProofOfPlay", "Dashboard", "Report", "Role", "all",
];
const authorizationPayload = {
  version: 1,
  user_id: adminUser.id,
  role: { id: adminUser.role_id, name: adminUser.role },
  department_id: null,
  department_ids: [],
  capabilities: permissionActions.flatMap((action) => permissionSubjects.map((subject) => ({ action, subject }))),
};

const login = async (page: Page) => {
  await page.addInitScript((user) => {
    window.sessionStorage.setItem(
      "persist:darshan",
      JSON.stringify({
        auth: JSON.stringify({
          token: "cms-token",
          user,
          csrfToken: "csrf-token",
        }),
        _persist: JSON.stringify({
          version: 1,
          rehydrated: true,
        }),
      }),
    );
    document.cookie = "csrf_token=csrf-token; path=/";
  }, adminUser);
  await page.goto("/dashboard");
  await page.waitForURL(/\/dashboard/);
};

const openScreensPage = async (page: Page) => {
  await page.goto("/screens");
  // Screens is a route-level lazy chunk. A direct navigation must wait for its
  // actual UI, not merely for the document navigation to finish.
  await expect(page.locator("main").getByRole("heading", { name: "Screens", exact: true })).toBeVisible({ timeout: 15_000 });
};

const installApiMocks = async (page: Page, state: MockState) => {
  await page.route("**/grafana/api/health", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ database: "ok" }),
  }));
  await page.route("**/grafana/login", (route) => route.fulfill({ status: 200, body: "Grafana login" }));
  await page.route("**/grafana/api/user", (route) => route.fulfill({ status: state.grafanaAuthenticated === false ? 401 : 200, contentType: "application/json", body: state.grafanaAuthenticated === false ? "{}" : '{"id":1}' }));
  await page.route("**/grafana/d/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>Grafana trends</body></html>" }));
  await page.route("**/api/v1/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const { pathname, searchParams } = url;
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
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(authorizationPayload),
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

    // The screens workspace uses paginated summary endpoints. Keep these
    // fixtures aligned with the production client.
    if (pathname === "/api/v1/screens/summary" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          server_time: "2026-03-12T12:00:00.000Z",
          total: state.screens.length,
          online: state.screens.filter((screen) => screen.health_state === "ONLINE").length,
          recovery: state.screens.filter((screen) => screen.health_state === "RECOVERY_REQUIRED").length,
          stale: state.screens.filter((screen) => screen.health_state === "STALE").length,
          offline: state.screens.filter((screen) => screen.health_state === "OFFLINE").length,
          error: state.screens.filter((screen) => screen.health_state === "ERROR").length,
        }),
      });
    }

    if (pathname === "/api/v1/screens" && method === "GET") {
      const pageNum = Number(searchParams.get("page") || 1);
      const limit = Number(searchParams.get("limit") || 100);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          server_time: "2026-03-12T12:00:00.000Z",
          items: state.screens,
          pagination: { page: pageNum, limit, total: state.screens.length },
        }),
      });
    }

    if (pathname === "/api/v1/screen-groups" && method === "GET") {
      const pageNum = Number(searchParams.get("page") || 1);
      const limit = Number(searchParams.get("limit") || 100);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          server_time: "2026-03-12T12:00:00.000Z",
          items: state.groups,
          pagination: { page: pageNum, limit, total: state.groups.length },
        }),
      });
    }

    if (/^\/api\/v1\/screen-groups\/[^/]+$/.test(pathname) && method === "GET") {
      const group = state.groups.find((entry) => entry.id === pathname.split("/").pop());
      return route.fulfill({ status: group ? 200 : 404, contentType: "application/json", body: JSON.stringify(group ?? { error: { code: "NOT_FOUND", message: "Group not found" } }) });
    }

    if (/^\/api\/v1\/screens\/[^/]+$/.test(pathname) && method === "GET") {
      const screenId = pathname.split("/").pop()!;
      const screen = state.screens.find((entry) => entry.id === screenId);
      return route.fulfill({
        status: screen ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(
          screen ?? {
            error: { message: "Screen not found" },
          },
        ),
      });
    }

    if (/^\/api\/v1\/screens\/[^/]+\/status$/.test(pathname) && method === "GET") {
      const screenId = pathname.split("/")[4]!;
      const screen = state.screens.find((entry) => entry.id === screenId);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: screenId,
          name: screen?.name ?? "Unknown Screen",
          status: screen?.status ?? "ACTIVE",
          health_state: screen?.health_state ?? "ONLINE",
          health_reason: screen?.health_reason ?? null,
          last_heartbeat_at: screen?.last_heartbeat_at ?? "2026-03-12T11:59:00.000Z",
          latest_heartbeat: {
            id: `heartbeat-${screenId}`,
            status: "ONLINE",
            created_at: "2026-03-12T11:59:00.000Z",
            payload: {
              cpu_usage: 14.2,
              memory_total_mb: 4096,
              memory_used_mb: 1024,
            },
          },
        }),
      });
    }

    if (/^\/api\/v1\/screens\/[^/]+\/now-playing$/.test(pathname) && method === "GET") {
      const screenId = pathname.split("/")[4]!;
      const screen = state.screens.find((entry) => entry.id === screenId);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          server_time: "2026-03-12T12:00:00.000Z",
          screen_id: screenId,
          status: screen?.status ?? "ACTIVE",
          health_state: screen?.health_state ?? "ONLINE",
          health_reason: screen?.health_reason ?? null,
          auth_diagnostics: screen?.auth_diagnostics ?? null,
          active_pairing: screen?.active_pairing ?? null,
          last_heartbeat_at: screen?.last_heartbeat_at ?? "2026-03-12T11:59:00.000Z",
          active_item_summaries: [],
          upcoming_item_summaries: [],
          playback: {
            source: "HEARTBEAT",
            current_media_id: null,
          },
          preview: null,
        }),
      });
    }

    if (/^\/api\/v1\/screens\/[^/]+\/availability$/.test(pathname) && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          is_available_now: true,
          booked_until: null,
          current_item_summaries: [],
          current_items: [],
          next_item_summary: null,
          publish: null,
        }),
      });
    }

    if (/^\/api\/v1\/screens\/[^/]+\/snapshot$/.test(pathname) && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          preview: null,
        }),
      });
    }

    if (/^\/api\/v1\/observability\/screens\/[^/]+$/.test(pathname) && method === "GET") {
      const screenId = pathname.split("/").pop()!;
      const screen = state.screens.find((entry) => entry.id === screenId);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generated_at: "2026-03-12T12:00:00.000Z",
          screen: {
            id: screenId,
            name: screen?.name ?? "Unknown Screen",
            status: screen?.status ?? "ACTIVE",
            health_state: screen?.health_state ?? "ONLINE",
            health_reason: screen?.health_reason ?? null,
            last_backend_heartbeat_at: screen?.last_heartbeat_at ?? "2026-03-12T11:59:00.000Z",
          },
          player_scrape: {
            configured: state.observabilityScrapeStatus === undefined || state.observabilityScrapeStatus === "up",
            status: state.observabilityScrapeStatus ?? "up",
            last_successful_player_heartbeat_at: "2026-03-12T11:59:30.000Z",
          },
          latest_player_metrics_source: state.observabilityMetricsSource ?? "prometheus",
          latest_player_metrics_observed_at: "2026-03-12T11:59:30.000Z",
          latest_player_metrics: {
            cpu_percent: 12.5,
            memory_used_bytes: 1073741824,
            memory_total_bytes: 4294967296,
            disk_used_bytes: 21474836480,
            disk_total_bytes: 68719476736,
            temperature_celsius: 41.2,
            battery_percent: null,
            power_connected: true,
            request_queue_items: 2,
            request_queue_oldest_age_seconds: 18,
            cache_used_bytes: 1073741824,
            cache_total_bytes: 2147483648,
            last_schedule_sync_at: "2026-03-12T11:58:00.000Z",
            display_count: 1,
          },
          latest_backend_telemetry: {
            cpu_usage: 14.2,
            memory_used_mb: 1024,
            hostname: "lobby-player",
            player_version: "1.0.0",
          },
          grafana: {
            enabled: true,
            embed_enabled: state.grafanaEmbed ?? false,
            embed_url: state.grafanaEmbed ? "/grafana/d/darshan-players-fleet?var-screen_id=" + screenId : null,
            links: [
              {
                label: "Open player fleet dashboard",
                url: "/grafana/d/darshan-players-fleet?var-screen_id=" + screenId,
              },
            ],
          },
        }),
      });
    }

    if (pathname === "/api/v1/device-pairing" && method === "GET") {
      const pageNum = Number(searchParams.get("page") || 1);
      const limit = Number(searchParams.get("limit") || 10);
      const status = searchParams.get("status") || "all";
      const now = Date.now();
      const filtered = state.pairings.filter((pair) => {
        const active = pair.used !== true &&
          typeof pair.expires_at === "string" && Date.parse(pair.expires_at) > now;
        return status === "active" ? active : status === "history" ? !active : true;
      });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: filtered.slice((pageNum - 1) * limit, pageNum * limit),
          pagination: { page: pageNum, limit, total: filtered.length },
        }),
      });
    }

    if (pathname === "/api/v1/device-pairing/confirm" && method === "POST") {
      const payload = route.request().postDataJSON() as { pairing_code?: string; name?: string; location?: string };
      const mode = payload.pairing_code ? state.confirmModeByCode[payload.pairing_code] ?? "PAIRING" : "PAIRING";
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: mode === "RECOVERY" ? "Recovery confirmed. Awaiting device completion." : "Pairing confirmed. Awaiting device completion.",
          pairing: {
            id: `pairing-${payload.pairing_code}`,
            device_id: mode === "RECOVERY" ? state.screens[0]?.id ?? "screen-1" : "device-new",
            pairing_code: payload.pairing_code,
            expires_at: "2026-03-12T13:00:00.000Z",
            confirmed_at: "2026-03-12T12:05:00.000Z",
          },
          recovery: {
            mode,
            recommended_action:
              mode === "RECOVERY" ? "WAIT_FOR_DEVICE_RECOVERY_COMPLETE" : "WAIT_FOR_DEVICE_COMPLETE",
          },
        }),
      });
    }

    if (pathname.startsWith("/api/v1/device-pairing/recovery/") && method === "GET") {
      const deviceId = pathname.split("/").pop()!;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(state.recoveryByDeviceId[deviceId] ?? {}),
      });
    }

    if (pathname.startsWith("/api/v1/device-pairing/recovery/") && method === "POST") {
      const deviceId = pathname.split("/").pop()!;
      const pairingCode = `REC-${deviceId.slice(0, 4).toUpperCase()}`;
      state.confirmModeByCode[pairingCode] = "RECOVERY";
      state.pairings = [
        {
          id: `pairing-${pairingCode}`,
          device_id: deviceId,
          pairing_code: pairingCode,
          used: false,
          used_at: null,
          expires_at: "2026-03-12T13:00:00.000Z",
          created_at: "2026-03-12T12:00:00.000Z",
          recovery: {
            mode: "RECOVERY",
            recommended_action: "WAIT_FOR_DEVICE_RECOVERY_COMPLETE",
          },
          specs: null,
        },
      ];
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: `pairing-${pairingCode}`,
          pairing_code: pairingCode,
          expires_at: "2026-03-12T13:00:00.000Z",
          expires_in: 900,
          recovery: {
            mode: "RECOVERY",
            recommended_action: "CONFIRM_RECOVERY",
            device_id: deviceId,
            screen: state.screens.find((screen) => screen.id === deviceId) ?? null,
          },
          diagnostics: {
            auth_state: "EXPIRED_CERTIFICATE",
            reason: "The latest device certificate has expired.",
            recommended_action: "RECOVER_IN_PLACE",
          },
        }),
      });
    }

    if (pathname.startsWith("/api/v1/screens/") && method === "DELETE") {
      const screenId = pathname.split("/").pop()!;
      if (state.screenDeleteBlocked) {
        return route.fulfill({
          status: 409, contentType: "application/json",
          body: JSON.stringify({ success: false, error: { code: "SCREEN_IN_USE", message: "Remove references before deleting.", details: { blockers: { schedule_items: 1, defaults: 1 } } } }),
        });
      }
      state.screens = state.screens.filter((screen) => screen.id !== screenId);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: screenId,
          message: "Screen deleted with related data cleaned up",
          cleanup: {},
          storage_cleanup: { deleted: [], failed: [] },
        }),
      });
    }

    if (/^\/api\/v1\/screen-groups\/[^/]+$/.test(pathname) && method === "DELETE") {
      if (state.groupDeleteBlocked) {
        return route.fulfill({
          status: 409, contentType: "application/json",
          body: JSON.stringify({ success: false, error: { code: "SCREEN_GROUP_IN_USE", message: "Remove references before deleting.", details: { blockers: { active_emergencies: 1 } } } }),
        });
      }
      state.groups = state.groups.filter((group) => group.id !== pathname.split("/").pop());
      return route.fulfill({ status: 204 });
    }

    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });
};

test.describe("Screens operator flow", () => {
  test("renders screen health and recovery info and handles delete refresh", async ({ page }) => {
    const state: MockState = {
      screens: [
        {
          id: "screen-1",
          name: "Lobby Screen",
          location: "Reception",
          status: "ACTIVE",
          health_state: "RECOVERY_REQUIRED",
          health_reason: "Recovery pairing is in progress for this screen.",
          auth_diagnostics: {
            state: "EXPIRED_CERTIFICATE",
            reason: "The latest device certificate has expired.",
          },
          active_pairing: {
            id: "pairing-1",
            mode: "RECOVERY",
            confirmed: true,
            expires_at: "2026-03-12T13:00:00.000Z",
          },
          last_heartbeat_at: "2026-03-12T11:59:00.000Z",
          active_items: [],
          upcoming_items: [],
        },
      ],
      groups: [],
      pairings: [],
      recoveryByDeviceId: {},
      confirmModeByCode: {},
    };

    await installApiMocks(page, state);
    await login(page);

    await openScreensPage(page);
    await expect(page.getByRole("button", { name: "Pair Device" }).first()).toBeVisible();
    await expect(page.getByText("Lobby Screen")).toBeVisible();
    await expect(page.getByText("Recovery Required")).toBeVisible();
    await expect(page.getByText("Certificate expired")).toBeVisible();
    await expect(page.getByText(/Recovery pending/)).toBeVisible();

    await page.getByRole("button", { name: "Details" }).click();
    await expect(page.getByRole("tab", { name: "Observability" })).toBeVisible();
    await page.getByRole("tab", { name: "Observability" }).click();
    await expect(page.getByText("Direct scrape reachable")).toBeVisible();
    await expect(page.getByRole("link", { name: /Open player fleet dashboard/i })).toBeVisible();
    await page.getByRole("button", { name: /Close/i }).click();

    await page.getByRole("button", { name: "Delete Screen Lobby Screen" }).click();
    await page.getByRole("button", { name: "Delete Screen" }).click();
    await expect(page.getByRole("button", { name: "Delete Screen Lobby Screen" })).toHaveCount(0);
  });

  test("explains heartbeat fallback and shows readable details and Grafana trends", async ({ page }) => {
    const state: MockState = {
      screens: [{ id: "screen-1", name: "Lobby Screen", status: "ACTIVE", active_items: [], upcoming_items: [] }],
      groups: [], pairings: [], recoveryByDeviceId: {}, confirmModeByCode: {},
      observabilityScrapeStatus: "unconfigured",
      observabilityMetricsSource: "backend_heartbeat",
      grafanaEmbed: true,
    };
    await installApiMocks(page, state);
    await login(page);
    await openScreensPage(page);
    await page.getByRole("button", { name: "Details" }).click();
    await page.getByRole("tab", { name: "Observability" }).click();
    await expect(page.getByText("Direct scrape not configured")).toBeVisible();
    await expect(page.getByText(/Recent player heartbeat received by backend/)).toBeVisible();
    await expect(page.getByText("Last reported device details")).toBeVisible();
    await expect(page.getByText("lobby-player")).toBeVisible();
    await expect(page.getByText("Backend telemetry payload")).toHaveCount(0);
    await expect(page.getByText("Grafana trend view")).toBeVisible();
    await expect(page.getByTitle("Observability trends for Lobby Screen")).toBeVisible();
  });

  test("asks for Grafana sign-in instead of showing an empty trend frame", async ({ page }) => {
    const state: MockState = {
      screens: [{ id: "screen-1", name: "Lobby Screen", status: "ACTIVE", active_items: [], upcoming_items: [] }],
      groups: [], pairings: [], recoveryByDeviceId: {}, confirmModeByCode: {},
      grafanaEmbed: true,
      grafanaAuthenticated: false,
    };
    await installApiMocks(page, state);
    await login(page);
    await openScreensPage(page);
    await page.getByRole("button", { name: "Details" }).click();
    await page.getByRole("tab", { name: "Observability" }).click();
    await expect(page.getByText(/Sign in to Grafana using Open in Grafana/)).toBeVisible();
    await expect(page.getByTitle("Observability trends for Lobby Screen")).toHaveCount(0);
  });

  test("keeps stale delete dialogs open and shows server blockers for screens and groups", async ({ page }) => {
    const state: MockState = {
      screens: [{ id: "screen-1", name: "Lobby Screen", status: "ACTIVE", active_items: [], upcoming_items: [] }],
      groups: [{ id: "group-1", name: "Lobby Group", screen_ids: ["screen-1"] }],
      pairings: [], recoveryByDeviceId: {}, confirmModeByCode: {},
      screenDeleteBlocked: true, groupDeleteBlocked: true,
    };
    await installApiMocks(page, state);
    await login(page);
    await openScreensPage(page);

    await page.getByRole("button", { name: "Delete Screen Lobby Screen" }).click();
    await page.getByRole("button", { name: "Delete Screen", exact: true }).click();
    await expect(page.getByRole("alert").getByText("Schedule items: 1")).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete Screen", exact: true })).toBeVisible();
    state.screenDeleteBlocked = false;
    await page.getByRole("button", { name: "Delete Screen", exact: true }).click();
    await expect(page.getByRole("button", { name: "Delete Screen Lobby Screen" })).toHaveCount(0);

    await page.getByRole("button", { name: "Delete Group Lobby Group" }).click();
    await page.getByRole("button", { name: "Delete Group", exact: true }).click();
    await expect(page.getByRole("alert").getByText("Active emergencies: 1")).toBeVisible();
    state.groupDeleteBlocked = false;
    await page.getByRole("button", { name: "Delete Group", exact: true }).click();
    await expect(page.getByRole("button", { name: "Delete Group Lobby Group" })).toHaveCount(0);
  });

  test("shows blockers and allows retry from the edit-group delete control", async ({ page }) => {
    const state: MockState = {
      screens: [{ id: "screen-1", name: "Lobby Screen", status: "ACTIVE", active_items: [], upcoming_items: [] }],
      groups: [{ id: "group-1", name: "Lobby Group", screen_ids: ["screen-1"] }],
      pairings: [], recoveryByDeviceId: {}, confirmModeByCode: {}, groupDeleteBlocked: true,
    };
    await installApiMocks(page, state);
    await login(page);
    await openScreensPage(page);

    await page.getByRole("button", { name: "Edit Group Lobby Group" }).click();
    await page.getByRole("button", { name: "Delete Group", exact: true }).click();
    await page.getByRole("button", { name: "Delete Group", exact: true }).last().click();
    await expect(page.getByRole("alert").getByText("Active emergencies: 1")).toBeVisible();
    state.groupDeleteBlocked = false;
    await page.getByRole("button", { name: "Delete Group", exact: true }).last().click();
    await expect(page.getByRole("button", { name: "Delete Group Lobby Group" })).toHaveCount(0);
  });

  test("supports first-time pairing confirmation from the Pair Device modal", async ({ page }) => {
    const state: MockState = {
      screens: [],
      groups: [],
      pairings: [],
      recoveryByDeviceId: {},
      confirmModeByCode: {
        PAIR123: "PAIRING",
      },
    };

    await installApiMocks(page, state);
    await login(page);

    await openScreensPage(page);
    await page.getByRole("button", { name: "Pair Device" }).first().click();
    await expect(page.getByRole("dialog", { name: /Pair Device/i })).toBeVisible();

    await page.getByLabel("Pairing Code *").fill("PAIR123");
    await page.getByLabel("Screen Name *").fill("Lobby Display");
    await page.getByLabel("Location (Optional)").fill("Reception");
    await page.getByRole("button", { name: /Confirm Pairing \/ Recovery/i }).click();

    await expect(page.getByRole("dialog", { name: /Pair Device/i })).toBeHidden();
  });

  test("shows only current OTPs by default and keeps superseded codes in history", async ({ page }) => {
    const state: MockState = {
      screens: [], groups: [], recoveryByDeviceId: {}, confirmModeByCode: {},
      pairings: [
        {
          id: "pairing-current", device_id: "device-a", pairing_code: "654321",
          status: "PENDING", used: false, expires_at: "2099-01-01T00:00:00.000Z",
          created_at: "2026-11-02T00:02:00.000Z",
        },
        {
          id: "pairing-old", device_id: "device-a", pairing_code: "123456",
          status: "SUPERSEDED", used: true, retired_reason: "SUPERSEDED",
          expires_at: "2099-01-01T00:00:00.000Z", created_at: "2026-11-02T00:01:00.000Z",
        },
      ],
    };
    await installApiMocks(page, state);
    await login(page);
    await openScreensPage(page);
    await expect(page.getByText("654321")).toBeVisible();
    await expect(page.getByText("123456")).toHaveCount(0);
    await page.getByRole("button", { name: "History", exact: true }).click();
    await expect(page.getByText("123456")).toBeVisible();
    await expect(page.getByText("654321")).toHaveCount(0);
  });

  test("supports same-device recovery flow from the screens page", async ({ page }) => {
    const deviceId = "screen-recovery-1";
    const state: MockState = {
      screens: [
        {
          id: deviceId,
          name: "Atrium Screen",
          location: "Atrium",
          status: "ACTIVE",
          health_state: "RECOVERY_REQUIRED",
          health_reason: "The screen requires credential recovery before it can authenticate again.",
          auth_diagnostics: {
            state: "EXPIRED_CERTIFICATE",
            reason: "The latest device certificate has expired.",
          },
          active_pairing: null,
          last_heartbeat_at: "2026-03-12T11:59:00.000Z",
          active_items: [],
          upcoming_items: [],
        },
      ],
      groups: [],
      pairings: [],
      recoveryByDeviceId: {
        [deviceId]: {
          device_id: deviceId,
          screen: {
            id: deviceId,
            name: "Atrium Screen",
            status: "ACTIVE",
          },
          active_pairing: null,
          certificate: {
            serial: "expired-serial",
            expires_at: "2026-03-12T10:00:00.000Z",
            revoked_at: null,
            is_revoked: false,
          },
          recovery: {
            auth_state: "EXPIRED_CERTIFICATE",
            reason: "The latest device certificate has expired.",
            recommended_action: "RECOVER_IN_PLACE",
          },
        },
      },
      confirmModeByCode: {},
    };

    await installApiMocks(page, state);
    await login(page);

    await openScreensPage(page);
    await page.getByRole("button", { name: "Recover Screen Atrium Screen" }).click();

    await expect(page.getByRole("dialog", { name: /Recover Screen/i })).toBeVisible();
    await expect(page.getByText(/EXPIRED_CERTIFICATE/)).toBeVisible();
    await page.getByRole("tab", { name: "Recover" }).click();
    await page.getByRole("button", { name: /Generate Recovery Code/i }).click();

    await expect(page.locator('input[value*="REC-"]')).toBeVisible();
    await page.getByRole("button", { name: /Use this code in Confirm/i }).click();
    await page.getByRole("button", { name: /Confirm Pairing \/ Recovery/i }).click();

    await expect(page.getByText(/screen can now complete credential recovery/i)).toBeVisible();
  });
});
