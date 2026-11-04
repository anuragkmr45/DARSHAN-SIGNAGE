import { expect, test, type Page } from "@playwright/test";
import { OPERATOR_TEST_ROLE_ID, testAuthorization } from "./helpers/selfAuthorization";

const origin = "http://127.0.0.1:5173";
const user = {
  id: "33333333-3333-4333-8333-333333333333",
  email: "chat.reader@example.invalid",
  first_name: "Chat",
  last_name: "Reader",
  role_id: OPERATOR_TEST_ROLE_ID,
  role: "OPERATOR",
  department_id: null,
};
const rooms = [
  { id: "room-a", type: "FORUM_OPEN", state: "ACTIVE", title: "Operations room", last_seq: 1, unread_count: 2, viewer_is_member: true, last_message: { id: "root-room-a", seq: 1, body_text: "Welcome to operations" } },
  { id: "room-b", type: "GROUP_CLOSED", state: "ACTIVE", title: "Planning room", last_seq: 1, unread_count: 0, viewer_is_member: true, last_message: { id: "root-room-b", seq: 1, body_text: "Welcome to planning" } },
];

async function installChatFixture(page: Page, options: { chatAdmin?: boolean; rejectRemoval?: boolean } = {}) {
  const conversations = rooms.map((room) => ({ ...room, viewer_role: options.chatAdmin ? "CHAT_ADMIN" : "MEMBER" }));
  const members = [
    { user_id: user.id, role: "CHAT_ADMIN", is_system: false, is_active: true, email: user.email, first_name: "Chat", last_name: "Reader" },
    { user_id: "44444444-4444-4444-8444-444444444444", role: "MEMBER", is_system: false, is_active: true, email: "peer@example.invalid", first_name: "Room", last_name: "Peer" },
    { user_id: "55555555-5555-4555-8555-555555555555", role: "CHAT_ADMIN", is_system: true, is_active: true, email: "admin@example.invalid", first_name: "Site", last_name: "Admin" },
    { user_id: "66666666-6666-4666-8666-666666666666", role: "OWNER", is_system: false, is_active: true, email: "owner@example.invalid", first_name: "Room", last_name: "Owner" },
  ];
  await page.context().addCookies([
    { name: "access_token", value: "qa-session", url: origin, httpOnly: true, sameSite: "Lax" },
    { name: "csrf_token", value: "qa-csrf", url: origin, sameSite: "Lax" },
  ]);
  await page.route("**/config/app-config.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ cms: {
      environment: { name: "development", deploymentId: "chat-nav", cmsId: "chat-nav" },
      api: { baseUrl: new URL(route.request().url()).origin },
      realtime: { socketBaseUrl: new URL(route.request().url()).origin, socketTransports: ["websocket"] },
    } }),
  }));
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/v1/auth/me") return json(user);
    if (path === "/api/v1/auth/authorization") return json(testAuthorization(user, [
      { action: "read", subject: "Conversation" },
      { action: "create", subject: "Conversation" },
    ], { roleId: OPERATOR_TEST_ROLE_ID }));
    if (path === "/api/v1/roles") return json({ items: [{ id: OPERATOR_TEST_ROLE_ID, name: "OPERATOR", permissions: { inherits: [], grants: [{ action: "read", subject: "Conversation" }] } }], page: 1, limit: 100, total: 1 });
    if (path === "/api/v1/users") return json({ items: [user], page: 1, limit: 100, total: 1 });
    if (path === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    if (path === "/api/v1/chat/messages/root-room-a" && route.request().method() === "PATCH") {
      return json({ error: { code: "EDIT_REJECTED", message: "Message could not be saved." } }, 500);
    }
    if (path === "/api/v1/chat/conversations") return json({ items: conversations });
    if (/^\/api\/v1\/chat\/conversations\/room-[ab]\/members$/.test(path) && route.request().method() === "GET") {
      return options.chatAdmin ? json({ items: members }) : json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, 403);
    }
    if (path === "/api/v1/chat/conversations/room-b/members/remove" && route.request().method() === "POST") {
      if (options.rejectRemoval) return json({ error: { code: "FORBIDDEN", message: "Permission changed" } }, 403);
      const { userId } = route.request().postDataJSON() as { userId: string };
      const index = members.findIndex((member) => member.user_id === userId);
      if (index !== -1) members.splice(index, 1);
      return json({ success: true });
    }
    const readRoom = path.match(/^\/api\/v1\/chat\/conversations\/(room-[ab])\/read$/)?.[1];
    if (readRoom && route.request().method() === "POST") {
      const conversation = conversations.find((item) => item.id === readRoom);
      if (conversation) conversation.unread_count = 0;
      return json({ conversation_id: readRoom, last_read_seq: 1 });
    }
    const roomId = path.match(/^\/api\/v1\/chat\/conversations\/(room-[ab])$/)?.[1];
    if (roomId) {
      const conversation = conversations.find((item) => item.id === roomId);
      return json({ conversation, viewer: { is_member: true, role: options.chatAdmin ? "CHAT_ADMIN" : "MEMBER" } });
    }
    const messagesRoom = path.match(/^\/api\/v1\/chat\/conversations\/(room-[ab])\/messages$/)?.[1];
    if (messagesRoom) return json({ items: [{
      id: `root-${messagesRoom}`, conversation_id: messagesRoom, seq: 1,
      sender_id: user.id, body_text: `Welcome to ${messagesRoom}`,
      created_at: "2026-11-03T01:00:00Z", attachments: [], reactions: [],
    }] });
    if (/\/thread\//.test(path)) return json({ items: [] });
    if (/\/pins$|\/bookmarks$/.test(path)) return json({ items: [] });
    return json({});
  });
}

test("chat admin reviews members and confirms removal while system and self controls stay protected", async ({ page }, testInfo) => {
  await installChatFixture(page, { chatAdmin: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/chat/room-b");
  await page.getByRole("button", { name: "Details" }).click();
  const details = page.getByRole("dialog", { name: "Conversation Details" });
  await details.getByRole("tab", { name: "Members" }).click();
  await expect(details.getByText("Room Peer")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("chat-members-before-removal.png"), fullPage: true });
  await expect(details.getByRole("button", { name: "Remove Chat Reader" })).toHaveCount(0);
  await expect(details.getByRole("button", { name: "Remove Site Admin" })).toHaveCount(0);
  await expect(details.getByRole("button", { name: "Remove Room Owner" })).toHaveCount(0);
  await details.getByRole("button", { name: "Remove Room Peer" }).click();
  await expect(page.getByRole("dialog", { name: "Remove member?" })).toBeVisible();
  await page.getByRole("dialog", { name: "Remove member?" }).getByRole("button", { name: "Remove member" }).click();
  await expect(details.getByText("Room Peer")).toHaveCount(0);
});

test("chat admin keeps removal confirmation open when server denies a stale action", async ({ page }) => {
  await installChatFixture(page, { chatAdmin: true, rejectRemoval: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/chat/room-b");
  await page.getByRole("button", { name: "Details" }).click();
  await page.getByRole("dialog", { name: "Conversation Details" }).getByRole("tab", { name: "Members" }).click();
  await page.getByRole("button", { name: "Remove Room Peer" }).click();
  await page.getByRole("dialog", { name: "Remove member?" }).getByRole("button", { name: "Remove member" }).click();
  await expect(page.getByRole("dialog", { name: "Remove member?" })).toBeVisible();
  await expect(page.getByText("Room Peer", { exact: true })).toBeVisible();
});

test("open forum roster explains that membership removal cannot revoke access", async ({ page }) => {
  await installChatFixture(page, { chatAdmin: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/chat/room-a");
  await page.getByRole("button", { name: "Details" }).click();
  const details = page.getByRole("dialog", { name: "Conversation Details" });
  await details.getByRole("tab", { name: "Members" }).click();
  await expect(details.getByText("Recorded forum members.")).toBeVisible();
  await expect(details.getByText(/Removing a membership would not revoke access/)).toBeVisible();
  await expect(details.getByRole("button", { name: "Remove Room Peer" })).toHaveCount(0);
});

test("phone chat member roster stays within the viewport", async ({ page }, testInfo) => {
  await installChatFixture(page, { chatAdmin: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chat/room-b");
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Details" }).click();
  const details = page.getByRole("dialog", { name: "Conversation Details" });
  await details.getByRole("tab", { name: "Members" }).click();
  await expect(details.getByRole("button", { name: "Remove Room Peer" })).toBeVisible();
  const box = await details.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeLessThan(2);
  expect(box!.width).toBeGreaterThan(380);
  await page.screenshot({ path: testInfo.outputPath("phone-chat-members.png"), fullPage: true });
});

test("phone chat follows list, conversation and thread routes without losing text drafts", async ({ page }, testInfo) => {
  await installChatFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByLabel("Search conversations")).toBeVisible();
  await expect(page.getByRole("button", { name: /Operations room/ })).toContainText("2");
  await page.screenshot({ path: testInfo.outputPath("phone-chat-list.png"), fullPage: true });

  await page.getByRole("button", { name: /Operations room/ }).click();
  await expect(page).toHaveURL(/\/chat\/room-a$/);
  await expect(page.getByRole("button", { name: "Chats" })).toBeVisible();
  await expect(page.getByLabel("Search conversations")).toBeHidden();
  await page.getByLabel("Message composer").fill("Unsent operations draft");
  await page.getByRole("button", { name: "More message actions" }).click();
  await page.getByRole("menuitem", { name: "Delete message" }).click();
  await expect(page.getByRole("dialog", { name: "Delete this message?" })).toBeVisible();
  await page.getByRole("dialog", { name: "Delete this message?" }).getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Welcome to room-a")).toBeVisible();
  await page.getByRole("button", { name: "More message actions" }).click();
  await page.getByRole("menuitem", { name: "Edit message" }).click();
  await page.getByLabel("Edit message text").fill("Keep this unsaved edit");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Edit message text")).toHaveValue("Keep this unsaved edit");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("phone-chat-conversation.png"), fullPage: true });
  await page.getByRole("button", { name: "Chats" }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole("button", { name: /Operations room/ })).not.toContainText("2");
  await page.getByRole("button", { name: /Planning room/ }).click();
  await page.getByLabel("Message composer").fill("Unsent planning draft");
  await page.getByRole("button", { name: "Chats" }).click();
  await page.getByRole("button", { name: /Operations room/ }).click();
  await expect(page.getByLabel("Message composer")).toHaveValue("Unsent operations draft");

  await page.getByRole("button", { name: "Reply in thread" }).first().click();
  await expect(page).toHaveURL(/\/chat\/room-a\/thread\/root-room-a$/);
  const thread = page.getByRole("dialog", { name: "Thread" });
  await expect(thread).toBeVisible();
  await expect(thread.getByRole("button", { name: "More message actions" })).toHaveCount(0);
  await expect.poll(async () => (await thread.boundingBox())?.x ?? 999).toBeLessThan(2);
  expect((await thread.boundingBox())?.width).toBeGreaterThan(380);
  await page.getByLabel("Thread reply composer").fill("Unsent thread draft");
  await page.screenshot({ path: testInfo.outputPath("phone-chat-thread.png"), fullPage: true });
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/room-a$/);
  await page.getByRole("button", { name: "Reply in thread" }).first().click();
  await expect(page.getByLabel("Thread reply composer")).toHaveValue("Unsent thread draft");
});

test("desktop chat keeps the list and conversation visible together", async ({ page }, testInfo) => {
  await installChatFixture(page);
  await page.setViewportSize({ width: 820, height: 900 });
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByLabel("Search conversations")).toBeVisible();
  await expect(page.getByLabel("Message composer")).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("tablet-chat-list.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page).toHaveURL(/\/chat\/room-a$/);
  await expect(page.getByLabel("Search conversations")).toBeVisible();
  await expect(page.getByLabel("Message composer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Chats" })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("desktop-chat.png"), fullPage: true });
});
