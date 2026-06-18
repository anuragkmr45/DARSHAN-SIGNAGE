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
  globalMedia: (typeof mediaCatalog)[number] | null;
  globalMediaId: string | null;
  variants: Record<string, (typeof mediaCatalog)[number] | null>;
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

const aspectRatiosResponse = {
  items: [
    { id: "screen-1", name: "Lobby", aspect_ratio: "16:9", aspect_ratio_name: "Widescreen" },
    { id: "screen-2", name: "Portrait Kiosk", aspect_ratio: "9:16", aspect_ratio_name: "Portrait" },
  ],
  defaults: [
    { id: null, name: "Widescreen", aspect_ratio: "16:9", aspect_ratio_name: "Widescreen", is_fallback: true },
    { id: null, name: "Portrait", aspect_ratio: "9:16", aspect_ratio_name: "Portrait", is_fallback: true },
    { id: null, name: "Square", aspect_ratio: "1:1", aspect_ratio_name: "Square", is_fallback: true },
  ],
};

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

    if (pathname === "/api/v1/settings/default-media" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          media_id: state.globalMediaId,
          media: state.globalMedia,
        }),
      });
    }

    if (pathname === "/api/v1/settings/default-media" && method === "PUT") {
      const payload = route.request().postDataJSON() as { media_id: string | null };
      state.globalMediaId = payload.media_id;
      state.globalMedia = mediaCatalog.find((item) => item.id === payload.media_id) ?? null;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ media_id: state.globalMediaId, media: state.globalMedia }),
      });
    }

    if (pathname === "/api/v1/settings/default-media/variants" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          global_media_id: state.globalMediaId,
          global_media: state.globalMedia,
          variants: Object.entries(state.variants).map(([aspect_ratio, media]) => ({
            aspect_ratio,
            media_id: media?.id ?? null,
            media,
          })),
        }),
      });
    }

    if (pathname === "/api/v1/settings/default-media/variants" && method === "PUT") {
      const payload = route.request().postDataJSON() as { variants: Record<string, string | null> };
      state.variants = Object.fromEntries(
        Object.entries(payload.variants)
          .filter(([, mediaId]) => mediaId)
          .map(([aspectRatio, mediaId]) => [aspectRatio, mediaCatalog.find((item) => item.id === mediaId) ?? null]),
      );
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          global_media_id: state.globalMediaId,
          global_media: state.globalMedia,
          variants: Object.entries(state.variants).map(([aspect_ratio, media]) => ({
            aspect_ratio,
            media_id: media?.id ?? null,
            media,
          })),
        }),
      });
    }

    if (pathname === "/api/v1/screens/aspect-ratios" && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(aspectRatiosResponse) });
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

test.describe("Settings default media variants", () => {
  test("renders global and aspect-ratio-specific fallback sections", async ({ page }) => {
    const state: MockState = {
      globalMediaId: "media-global",
      globalMedia: mediaCatalog[0],
      variants: {
        "16:9": mediaCatalog[1],
      },
    };

    await installApiMocks(page, state);
    await login(page);
    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: "Default Media", exact: true })).toBeVisible();
    await expect(page.getByText("Fallback precedence")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Global default media", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Aspect-ratio fallback variants", exact: true })).toBeVisible();
    await expect(page.getByLabel("Clear default media for 16:9")).toBeVisible();
    await expect(page.getByText("Configured", { exact: true })).toBeVisible();
    await expect(page.getByText("global-fallback.png", { exact: true })).toBeVisible();
    await expect(page.getByText("Widescreen")).toBeVisible();
    await expect(page.getByText("Portrait")).toBeVisible();
  });

  test("assigns and clears aspect-ratio-specific default media", async ({ page }) => {
    const state: MockState = {
      globalMediaId: "media-global",
      globalMedia: mediaCatalog[0],
      variants: {},
    };

    await installApiMocks(page, state);
    await login(page);
    await page.goto("/settings");

    await page.getByLabel("Assign default media for 16:9").click();
    const dialog = page.getByRole("dialog", { name: /select default media for 16:9/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("lobby-loop.mp4", { exact: true })).toBeVisible();
    await dialog.getByText("lobby-loop.mp4", { exact: true }).click();
    await expect(page.getByLabel("Clear default media for 16:9")).toBeVisible();
    await expect(page.getByText("Configured", { exact: true })).toBeVisible();

    await page.getByLabel("Clear default media for 16:9").click();
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByText("lobby-loop.mp4", { exact: true })).not.toBeVisible();
    await expect(page.getByLabel("Assign default media for 16:9")).toBeVisible();
    await expect(page.getByLabel("Clear default media for 16:9")).not.toBeVisible();
  });
});
