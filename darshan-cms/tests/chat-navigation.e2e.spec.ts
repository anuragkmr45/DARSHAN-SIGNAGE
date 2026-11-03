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

async function installChatFixture(page: Page) {
  const conversations = rooms.map((room) => ({ ...room }));
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
    const readRoom = path.match(/^\/api\/v1\/chat\/conversations\/(room-[ab])\/read$/)?.[1];
    if (readRoom && route.request().method() === "POST") {
      const conversation = conversations.find((item) => item.id === readRoom);
      if (conversation) conversation.unread_count = 0;
      return json({ conversation_id: readRoom, last_read_seq: 1 });
    }
    const roomId = path.match(/^\/api\/v1\/chat\/conversations\/(room-[ab])$/)?.[1];
    if (roomId) {
      const conversation = conversations.find((item) => item.id === roomId);
      return json({ conversation, viewer: { is_member: true, role: "MEMBER" } });
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
