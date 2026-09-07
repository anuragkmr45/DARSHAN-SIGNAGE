import { expect, test, type Page, type Route } from "@playwright/test";

const adminUser = {
  id: "admin-user-id",
  email: "admin@darshan.local",
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

type MockState = {
  assignments: Array<{
    target_type: "SCREEN" | "GROUP";
    target_id: string;
    media_id: string;
    aspect_ratio: string;
  }>;
};

const mediaCatalog = [
  {
    id: "media-global",
    name: "Global Fallback",
    filename: "global-fallback.png",
    type: "IMAGE",
    status: "READY",
    media_url: "https://cdn.example.com/global-fallback.png",
    width: 1280,
    height: 720,
  },
  {
    id: "media-16-9",
    name: "Lobby Loop",
    filename: "lobby-loop.mp4",
    type: "VIDEO",
    status: "READY",
    media_url: "https://cdn.example.com/lobby-loop.mp4",
    duration_seconds: 15,
    width: 1920,
    height: 1080,
  },
  {
    id: "media-9-16",
    name: "Portrait Poster",
    filename: "portrait-poster.png",
    type: "IMAGE",
    status: "READY",
    media_url: "https://cdn.example.com/portrait-poster.png",
    width: 1080,
    height: 1920,
  },
];

const screens = [
  { id: "screen-1", name: "Lobby", location: "First floor", aspect_ratio: "16:9" },
  { id: "screen-2", name: "Portrait Kiosk", location: "Reception", aspect_ratio: "9:16" },
];

const groups = [
  { id: "group-1", name: "Lobby group", screen_ids: ["screen-1"] },
];

const serializeAssignments = (assignments: MockState["assignments"]) => ({
  assignments: assignments.map((assignment) => ({
    ...assignment,
    media: mediaCatalog.find((media) => media.id === assignment.media_id) ?? null,
  })),
});

const login = async (page: Page) => {
  await page.goto("/login");
  await page.fill("#login-email", adminUser.email);
  await page.fill("#login-password", "LocalDev@123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
};

const installApiMocks = async (page: Page, state: MockState) => {
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

    // Settings renders every settings query before its tab contents are
    // selected. Supply the full contract so this fixture models the backend,
    // rather than relying on the route handler's intentionally empty fallback.
    if (pathname === "/api/v1/settings/general" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ company_name: "Darshan", timezone: "UTC", language: "en" }) });
    }

    if (pathname === "/api/v1/settings/branding" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ app_name: "DARSHAN CMS", logo_media_id: null, icon_media_id: null, favicon_media_id: null, logo_url: null, icon_url: null, favicon_url: null }) });
    }

    if (pathname === "/api/v1/settings/security" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ idle_timeout_minutes: 30, password_policy: { min_length: 12, require_uppercase: true, require_lowercase: true, require_number: true, require_special: true } }) });
    }

    if (pathname === "/api/v1/settings/appearance" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ theme_mode: "light", accent_preset: "crimson", sidebar_mode: "expanded" }) });
    }

    if (pathname === "/api/v1/settings/backups" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ automatic_enabled: false, interval_hours: 24, log_level: "info" }) });
    }

    if ((pathname === "/api/v1/settings/backups/history" || pathname === "/api/v1/settings/logs") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
    }

    if (pathname === "/api/v1/settings/default-media/targets" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(serializeAssignments(state.assignments)),
      });
    }

    if (pathname === "/api/v1/settings/default-media/targets" && method === "PUT") {
      const payload = route.request().postDataJSON() as { assignments: MockState["assignments"] };
      state.assignments = payload.assignments;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(serializeAssignments(state.assignments)),
      });
    }

    if (pathname === "/api/v1/screens" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: screens, page: 1, limit: 100, total: screens.length }),
      });
    }

    if (pathname === "/api/v1/screen-groups" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: groups, page: 1, limit: 100, total: groups.length }),
      });
    }

    if (pathname === "/api/v1/media" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: mediaCatalog, page: 1, limit: 100, total: mediaCatalog.length }),
      });
    }

    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });
};

const openDefaultMedia = async (page: Page) => {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Default Media", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Default Media", exact: true })).toBeVisible();
};

const currentAssignmentsSection = (page: Page) =>
  page
    .getByRole("heading", { name: "Current assignments", exact: true })
    .locator("xpath=..")
    .locator("xpath=..")
    .locator("xpath=..");

test.describe("Settings default media targets", () => {
  test("renders target-scoped assignments and scope rules", async ({ page }) => {
    const state: MockState = {
      assignments: [{ target_type: "SCREEN", target_id: "screen-1", media_id: "media-16-9", aspect_ratio: "16:9" }],
    };

    await installApiMocks(page, state);
    await login(page);
    await openDefaultMedia(page);

    await expect(page.getByText("Scope rules")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Specific Screens", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Select screens", exact: true })).toBeVisible();
    await expect(page.locator("label").filter({ hasText: /^Lobby/ }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Current assignments", exact: true })).toBeVisible();
    await expect(currentAssignmentsSection(page).getByText("Lobby Loop", { exact: true })).toBeVisible();
  });

  test("assigns and clears screen-targeted default media", async ({ page }) => {
    const state: MockState = {
      assignments: [],
    };

    await installApiMocks(page, state);
    await login(page);
    await openDefaultMedia(page);

    await page.locator("label").filter({ hasText: /^Lobby/ }).first().click();
    await page.getByRole("button", { name: "Assign media", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /select media for screen selection \(16:9\)/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Lobby Loop", { exact: true })).toBeVisible();
    await dialog.getByText("Lobby Loop", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Current assignments", exact: true })).toBeVisible();
    await expect(currentAssignmentsSection(page).getByText("Lobby Loop", { exact: true })).toBeVisible();

    await currentAssignmentsSection(page).getByRole("button", { name: "Clear", exact: true }).click();
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByText("No default media assignments configured.")).toBeVisible();
  });
});
