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
      permissions: { inherits: [], grants: [{ action: "manage", subject: "all" }] },
      is_system: true,
      created_at: "2026-10-16T00:00:00.000Z",
      updated_at: "2026-10-16T00:00:00.000Z",
    },
  ],
  page: 1,
  limit: 100,
  total: 1,
};

const ownership = (
  scope: "ORGANIZATION" | "DEPARTMENT" | "RESTRICTED",
  creator: {
    id: string | null;
    display_name: string;
    status: "ACTIVE" | "INACTIVE" | "DELETED" | "UNKNOWN";
  },
) => ({
  scope,
  department_id: scope === "DEPARTMENT" ? "department-a" : null,
  department_name: scope === "DEPARTMENT" ? "Operations" : null,
  creator,
});

async function installCommonRoutes(
  page: Page,
  responder: (route: Route, pathname: string, method: string) => Promise<boolean>,
) {
  await page.route("**/api/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (pathname === "/api/v1/auth/login" && method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ token: "cms-token", csrf_token: "csrf-token", user: adminUser }),
      });
      return;
    }
    if (pathname === "/api/v1/roles" && method === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rolesPayload) });
      return;
    }
    if (pathname === "/api/v1/notifications/unread-count" && method === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ unread_total: 0 }) });
      return;
    }
    if (await responder(route, pathname, method)) return;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });
}

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#login-email", adminUser.email);
  await page.fill("#login-password", "LocalDev@123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
}

test.describe("Owned content response contract", () => {
  test("Media Library shows owner/creator states and fails closed without permission flags", async ({ page }) => {
    const items = [
      {
        id: "media-deleted",
        name: "Deleted creator asset",
        filename: "deleted.pdf",
        type: "DOCUMENT",
        status: "READY",
        page_count: 2,
        ownership: ownership("DEPARTMENT", {
          id: "deleted-user-id",
          display_name: "Former User",
          status: "DELETED",
        }),
        permissions: { can_update: false, can_delete: false },
      },
      {
        id: "media-active",
        name: "Organization asset",
        filename: "organization.png",
        type: "IMAGE",
        status: "READY",
        ownership: ownership("ORGANIZATION", {
          id: "admin-user-id",
          display_name: "Admin User",
          status: "ACTIVE",
        }),
        permissions: { can_update: true, can_delete: true },
      },
      {
        id: "media-inactive",
        name: "Restricted inactive asset",
        filename: "inactive.png",
        type: "IMAGE",
        status: "READY",
        ownership: ownership("RESTRICTED", {
          id: "inactive-user-id",
          display_name: "Inactive User",
          status: "INACTIVE",
        }),
      },
      {
        id: "media-unknown",
        name: "Unknown creator asset",
        filename: "unknown.png",
        type: "IMAGE",
        status: "READY",
        ownership: ownership("RESTRICTED", {
          id: null,
          display_name: "Unknown user",
          status: "UNKNOWN",
        }),
        permissions: { can_update: false, can_delete: false },
      },
    ];

    await installCommonRoutes(page, async (route, pathname, method) => {
      if (pathname === "/api/v1/media/upload-policy" && method === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ max_bytes: 1024 }) });
        return true;
      }
      if (pathname === "/api/v1/media" && method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items, pagination: { page: 1, limit: 20, total: items.length } }),
        });
        return true;
      }
      if (pathname === "/api/v1/media/media-active" && method === "DELETE") {
        await route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "FORBIDDEN", message: "Your access changed. Refresh and try again." } }),
        });
        return true;
      }
      return false;
    });

    await login(page);
    await page.goto("/media");
    await expect(page.getByRole("main").getByRole("heading", { name: "Media Library", exact: true })).toBeVisible();
    await expect(page.getByText("Operations owned", { exact: true })).toBeVisible();
    await expect(page.getByText("Created by Former User (Deleted)", { exact: true })).toBeVisible();
    await expect(page.getByText("Organization owned", { exact: true })).toBeVisible();
    await expect(page.getByText("Created by Inactive User (Inactive)", { exact: true })).toBeVisible();
    await expect(page.getByText("Creator unknown", { exact: true })).toBeVisible();
    await expect(page.getByText("deleted.creator@example.test", { exact: true })).toHaveCount(0);

    const deleteButtons = page.getByRole("button", { name: "Delete", exact: true });
    await expect(deleteButtons).toHaveCount(4);
    await expect(deleteButtons.nth(0)).toBeDisabled();
    await expect(deleteButtons.nth(1)).toBeEnabled();
    await expect(deleteButtons.nth(2)).toBeDisabled();
    await expect(deleteButtons.nth(3)).toBeDisabled();

    await deleteButtons.nth(1).click();
    await expect(page.getByRole("dialog", { name: "Delete Media" })).toBeVisible();
    await page.getByRole("dialog", { name: "Delete Media" }).getByRole("button", { name: "Delete Media" }).last().click();
    await expect(page.getByText("Delete not allowed", { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Delete Media" })).toHaveCount(0);
  });

  test('administrator restores a deleted Media item from the library', async ({ page }) => {
    let deleted = true;
    await installCommonRoutes(page, async (route, pathname, method) => {
      if (pathname === '/api/v1/media' && method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], pagination: { page: 1, limit: 20, total: 0 } }) });
        return true;
      }
      if (pathname === '/api/v1/media/deleted' && method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: deleted ? [{ id: 'media-restore', name: 'Retained image', type: 'IMAGE', deleted_at: '2026-11-01T00:00:00Z' }] : [] }) });
        return true;
      }
      if (pathname === '/api/v1/media/media-restore/restore' && method === 'POST') {
        deleted = false;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'media-restore', already_restored: false }) });
        return true;
      }
      return false;
    });
    await login(page);
    await page.goto('/media');
    await page.getByRole('button', { name: 'Deleted Media' }).click();
    await expect(page.getByRole('dialog', { name: 'Deleted Media' }).getByText('Retained image')).toBeVisible();
    await page.getByRole('dialog', { name: 'Deleted Media' }).getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText('Media restored')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Deleted Media' }).getByText('No deleted media.')).toBeVisible();
  });

  test('administrator restores deleted chat content in conversation order', async ({ page }) => {
    let conversationDeleted = true;
    let messageDeleted = true;
    await installCommonRoutes(page, async (route, pathname, method) => {
      if (pathname === '/api/v1/chat/conversations' && method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 1, limit: 30, total: 0 }) });
        return true;
      }
      if (pathname === '/api/v1/chat/deleted/conversations' && method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: conversationDeleted ? [{ id: 'conversation-restore', title: 'Retained chat', type: 'GROUP_CLOSED', deleted_at: '2026-11-01T00:00:00Z' }] : [] }) });
        return true;
      }
      if (pathname === '/api/v1/chat/deleted/messages' && method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: messageDeleted ? [{ id: 'message-restore', conversation_id: 'conversation-restore', deleted_at: '2026-11-01T00:00:00Z' }] : [] }) });
        return true;
      }
      if (pathname === '/api/v1/chat/conversations/conversation-restore/restore' && method === 'POST') {
        conversationDeleted = false;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ conversationId: 'conversation-restore', already_restored: false }) });
        return true;
      }
      if (pathname === '/api/v1/chat/messages/message-restore/restore' && method === 'POST') {
        messageDeleted = false;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messageId: 'message-restore', already_restored: false }) });
        return true;
      }
      return false;
    });
    await login(page);
    await page.goto('/chat');
    await page.getByRole('button', { name: 'Deleted content' }).click();
    const dialog = page.getByRole('dialog', { name: 'Deleted chat content' });
    await expect(dialog.getByText('Retained chat')).toBeVisible();
    await dialog.getByRole('button', { name: 'Restore conversation' }).click();
    await expect(dialog.getByText('No deleted conversations.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Restore message' }).click();
    await expect(dialog.getByText('No deleted messages.')).toBeVisible();
  });

  test("Layouts use server flags for action availability and display deleted ownership", async ({ page }) => {
    const items = [
      {
        id: "layout-read-only",
        name: "Read-only Operations Layout",
        description: "Owned by the original department",
        aspect_ratio: "16:9",
        spec: { slots: [{ id: "main", x: 0, y: 0, w: 1, h: 1 }] },
        created_by: "deleted-user-id",
        ownership: ownership("DEPARTMENT", {
          id: "deleted-user-id",
          display_name: "Former User",
          status: "DELETED",
        }),
        created_at: "2026-10-16T00:00:00.000Z",
        updated_at: "2026-10-16T00:00:00.000Z",
      },
      {
        id: "layout-manageable",
        name: "Manageable Organization Layout",
        description: "Organization template",
        aspect_ratio: "16:9",
        spec: { slots: [{ id: "main", x: 0, y: 0, w: 1, h: 1 }] },
        created_by: "admin-user-id",
        ownership: ownership("ORGANIZATION", {
          id: "admin-user-id",
          display_name: "Admin User",
          status: "ACTIVE",
        }),
        permissions: { can_update: true, can_delete: true },
        created_at: "2026-10-16T00:00:00.000Z",
        updated_at: "2026-10-16T00:00:00.000Z",
      },
    ];

    await installCommonRoutes(page, async (route, pathname, method) => {
      if (pathname === "/api/v1/layouts" && method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items, pagination: { page: 1, limit: 20, total: items.length } }),
        });
        return true;
      }
      return false;
    });

    await login(page);
    await page.goto("/layouts");
    await expect(page.getByRole("main").getByRole("heading", { name: "Layouts", exact: true })).toBeVisible();
    await expect(page.getByText("Operations owned", { exact: true })).toBeVisible();
    await expect(page.getByText("Created by Former User (Deleted)", { exact: true })).toBeVisible();
    await expect(page.getByText("Organization owned", { exact: true })).toBeVisible();

    const readOnlyRow = page.getByRole("row").filter({ hasText: "Read-only Operations Layout" });
    await expect(readOnlyRow.getByText("Read-only for your account", { exact: true })).toBeVisible();
    await readOnlyRow.getByRole("button").click();
    await expect(page.getByRole("menuitem", { name: "Edit" })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");

    const manageableRow = page.getByRole("row").filter({ hasText: "Manageable Organization Layout" });
    await manageableRow.getByRole("button").click();
    await expect(page.getByRole("menuitem", { name: "Edit" })).not.toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("menuitem", { name: "Delete" })).not.toHaveAttribute("aria-disabled", "true");
  });

  test("user deletion explains retained ownership and has keyboard-safe cancel focus", async ({ page }) => {
    const targetUser = {
      id: "operator-user-id",
      email: "operator@example.test",
      first_name: "Content",
      last_name: "Creator",
      role_id: "role-operator",
      role: "OPERATOR",
      department_id: "department-a",
      is_active: true,
      created_at: "2026-10-16T00:00:00.000Z",
      updated_at: "2026-10-16T00:00:00.000Z",
    };

    await installCommonRoutes(page, async (route, pathname, method) => {
      if (pathname === "/api/v1/users" && method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [targetUser], pagination: { page: 1, limit: 9, total: 1 } }),
        });
        return true;
      }
      if (pathname === "/api/v1/users/invite" && method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [], pagination: { page: 1, limit: 9, total: 0 } }),
        });
        return true;
      }
      return false;
    });

    await login(page);
    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "Users Management" })).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    const dialog = page.getByRole("alertdialog", { name: "Delete User" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Sign-in, active sessions, and notifications will stop immediately");
    await expect(dialog).toContainText("will be kept under their current organization or department ownership");
    await expect(dialog).toContainText("will show this person as a deleted creator");
    const cancel = dialog.getByRole("button", { name: "Cancel" });
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("Schedule Queue and Request Detail preserve nested owner, creator, page, and loop labels", async ({ page }) => {
    const departmentOwnership = ownership("DEPARTMENT", {
      id: "deleted-schedule-creator",
      display_name: "Schedule Creator",
      status: "DELETED",
    });
    const request = {
      id: "00000000-0000-4000-8000-000000000123",
      status: "PENDING",
      notes: "Ownership review",
      created_at: "2026-10-16T00:00:00.000Z",
      requested_by_user: {
        id: "deleted-requester",
        email: null,
        first_name: "Former",
        last_name: "Requester",
        department_id: "department-a",
        department: { id: "department-a", name: "Operations" },
        status: "DELETED",
      },
      schedule: {
        id: "schedule-1",
        name: "Deleted Creator Schedule",
        start_at: "2026-10-17T09:00:00.000Z",
        end_at: "2026-10-17T18:00:00.000Z",
        created_by: "deleted-schedule-creator",
        ownership: departmentOwnership,
        permissions: { can_update: true, can_delete: false },
      },
      schedule_items: [
        {
          id: "schedule-item-1",
          schedule_id: "schedule-1",
          presentation_id: "presentation-1",
          start_at: "2026-10-17T09:00:00.000Z",
          end_at: "2026-10-17T18:00:00.000Z",
          priority: 0,
          screen_ids: [],
          screen_group_ids: [],
        },
      ],
      presentations: [
        {
          id: "presentation-1",
          name: "Owned Presentation",
          layout_id: "layout-1",
          created_by: "inactive-presentation-creator",
          ownership: ownership("DEPARTMENT", {
            id: "inactive-presentation-creator",
            display_name: "Inactive Presenter",
            status: "INACTIVE",
          }),
          permissions: { can_update: false, can_delete: false },
          layout: {
            id: "layout-1",
            name: "Owned Layout",
            aspect_ratio: "16:9",
            spec: { slots: [{ id: "document", x: 0, y: 0, w: 1, h: 1 }] },
            created_by: "deleted-layout-creator",
            ownership: ownership("DEPARTMENT", {
              id: "deleted-layout-creator",
              display_name: "Layout Creator",
              status: "DELETED",
            }),
            permissions: { can_update: false, can_delete: false },
          },
        },
      ],
      presentation_slots: [
        {
          id: "slot-document",
          presentation_id: "presentation-1",
          slot_id: "document",
          media_id: "media-document",
          order: 0,
          duration_seconds: 10,
          fit_mode: "contain",
          audio_enabled: false,
          loop_enabled: false,
          page_number: 5,
        },
        {
          id: "slot-video",
          presentation_id: "presentation-1",
          slot_id: "video",
          media_id: "media-video",
          order: 0,
          duration_seconds: 10,
          fit_mode: "cover",
          audio_enabled: false,
          loop_enabled: true,
          page_number: null,
        },
      ],
      media: [
        {
          id: "media-document",
          name: "Five Page Handbook",
          filename: "handbook.pdf",
          type: "DOCUMENT",
          status: "READY",
          page_count: 5,
          created_by: "deleted-media-creator",
          ownership: ownership("DEPARTMENT", {
            id: "deleted-media-creator",
            display_name: "Media Creator",
            status: "DELETED",
          }),
          permissions: { can_update: false, can_delete: false },
        },
        {
          id: "media-video",
          name: "Looping Video",
          filename: "loop.mp4",
          type: "VIDEO",
          status: "READY",
          created_by: "admin-user-id",
          ownership: ownership("ORGANIZATION", {
            id: "admin-user-id",
            display_name: "Admin User",
            status: "ACTIVE",
          }),
          permissions: { can_update: true, can_delete: true },
        },
      ],
      screens: [],
      screen_groups: [],
      reservation_summary: null,
    };

    await installCommonRoutes(page, async (route, pathname, method) => {
      if (pathname === "/api/v1/schedule-requests/status-summary" && method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            counts: { pending: 1, approved: 0, rejected: 0, published: 0, taken_down: 0, expired: 0 },
          }),
        });
        return true;
      }
      if (pathname === "/api/v1/schedule-requests" && method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [request], pagination: { page: 1, limit: 10, total: 1 } }),
        });
        return true;
      }
      return false;
    });

    await login(page);
    await page.goto("/schedule");
    await expect(page.getByRole("heading", { name: "Schedule Queue" })).toBeVisible();
    await expect(page.getByText("Operations owned", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Created by Schedule Creator (Deleted)", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Former Requester \(deleted\)/)).toBeVisible();
    await expect(page.getByText(/deleted\.requester@/i)).toHaveCount(0);

    await page.getByText("Deleted Creator Schedule", { exact: true }).click();
    await page.getByRole("tab", { name: /media/i }).click();
    await expect(page.getByText("Created by Media Creator (Deleted)", { exact: true })).toBeVisible();
    await expect(page.getByText("Created by Inactive Presenter (Inactive)", { exact: true })).toBeVisible();
    await expect(page.getByText("Layout: Operations owned", { exact: true })).toBeVisible();
    await expect(page.getByText("Created by Layout Creator (Deleted)", { exact: true })).toBeVisible();
    await expect(page.getByText("Page 5", { exact: true })).toBeVisible();
    await expect(page.getByText("Loop On", { exact: true })).toBeVisible();
  });
});
