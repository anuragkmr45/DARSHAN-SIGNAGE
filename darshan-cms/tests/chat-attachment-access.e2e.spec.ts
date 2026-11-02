import { expect, test } from "@playwright/test";

test("chat readers load shared media through the conversation authority", async ({ page, context }) => {
  const origin = "http://127.0.0.1:5173";
  const conversationId = "11111111-1111-4111-8111-111111111111";
  const mediaId = "22222222-2222-4222-8222-222222222222";
  const user = {
    id: "33333333-3333-4333-8333-333333333333",
    email: "reader@example.invalid", first_name: "Reader", last_name: "QA",
    role_id: "qa-role", role: "OPERATOR", department_id: "44444444-4444-4444-8444-444444444444",
  };
  const conversation = {
    id: conversationId, type: "FORUM_OPEN", state: "ACTIVE", title: "Shared files",
    last_seq: 1, unread_count: 0, viewer_is_member: false,
  };
  let chatAttachmentRequests = 0;
  let ordinaryMediaRequests = 0;

  await context.addCookies([
    { name: "access_token", value: "qa-session", url: origin, httpOnly: true, sameSite: "Lax" },
    { name: "csrf_token", value: "qa-csrf", url: origin, sameSite: "Lax" },
  ]);
  await page.route("**/config/app-config.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ cms: {
      environment: { name: "development", deploymentId: "qa", cmsId: "qa" },
      api: { baseUrl: new URL(route.request().url()).origin },
      realtime: { socketBaseUrl: new URL(route.request().url()).origin, socketTransports: ["websocket"] },
    } }),
  }));
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/v1/auth/me") return json(user);
    if (pathname === "/api/v1/roles") return json({ items: [{ id: "qa-role", name: "OPERATOR", permissions: { inherits: [], grants: [{ action: "read", subject: "Conversation" }, { action: "read", subject: "Media" }] } }], page: 1, limit: 100, total: 1 });
    if (pathname === "/api/v1/users") return json({ items: [user], page: 1, limit: 100, total: 1 });
    if (pathname === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    if (pathname === "/api/v1/chat/conversations") return json({ items: [conversation] });
    if (pathname === `/api/v1/chat/conversations/${conversationId}`) return json({ conversation, viewer: { is_member: false, role: null } });
    if (pathname === `/api/v1/chat/conversations/${conversationId}/messages`) return json({ items: [{
      id: "55555555-5555-4555-8555-555555555555", conversation_id: conversationId, seq: 1,
      sender_id: user.id, body_text: "Shared image", created_at: "2026-11-03T01:00:00Z",
      attachments: [{ media_asset_id: mediaId }], reactions: [],
    }] });
    if (pathname === `/api/v1/chat/conversations/${conversationId}/pins`) return json({ items: [] });
    if (pathname === `/api/v1/chat/conversations/${conversationId}/bookmarks`) return json({ items: [] });
    if (pathname === `/api/v1/chat/conversations/${conversationId}/attachments/${mediaId}`) {
      chatAttachmentRequests += 1;
      return json({
        id: mediaId, name: "Shared image", filename: "shared.png", type: "IMAGE", status: "READY",
        content_type: "image/png", media_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Yk9+EAAAAASUVORK5CYII=",
      });
    }
    if (pathname === `/api/v1/media/${mediaId}`) {
      ordinaryMediaRequests += 1;
      return json({ error: { code: "FORBIDDEN" } }, 403);
    }
    return json({});
  });

  await page.goto(`/chat/${conversationId}`);
  await expect(page.getByRole("button", { name: "View attachment in wide modal" })).toBeVisible();
  expect(chatAttachmentRequests).toBeGreaterThan(0);
  expect(ordinaryMediaRequests).toBe(0);
});
