import { expect, test, type Page, type Route } from "@playwright/test";
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

async function installChatFixture(page: Page, options: { chatAdmin?: boolean; rejectRemoval?: boolean; rootOutsideTimeline?: boolean; rootDeleted?: boolean; threadFailsInitially?: boolean; longHistory?: boolean } = {}) {
  const conversations = rooms.map((room) => ({
    ...room,
    last_seq: options.longHistory && room.id === "room-a" ? 240 : room.last_seq,
    viewer_role: options.chatAdmin ? "CHAT_ADMIN" : "MEMBER",
  }));
  let threadReads = 0;
  let longMainCount = 120;
  const longMainMessage = (seq: number) => ({
    id: seq === 1 ? "root-room-a" : `main-${seq}`, conversation_id: "room-a", seq,
    sender_id: user.id, body_text: `Main message ${seq}`,
    created_at: new Date(Date.UTC(2026, 10, 3, 1, 0, seq)).toISOString(), attachments: [], reactions: [],
  });
  const longReply = (index: number) => ({
    id: `reply-${index}`, conversation_id: "room-a", seq: 120 + index,
    sender_id: user.id, body_text: `Thread reply ${index}`,
    thread_root_id: "root-room-a", reply_to_message_id: "root-room-a",
    created_at: new Date(Date.UTC(2026, 10, 3, 2, 0, index)).toISOString(), attachments: [], reactions: [],
  });
  const pageHistory = <T extends { seq: number }>(items: T[], requestUrl: URL) => {
    const limit = Number(requestUrl.searchParams.get("limit") || 50);
    const beforeSeq = requestUrl.searchParams.get("beforeSeq");
    const afterSeq = requestUrl.searchParams.get("afterSeq");
    const aroundMessageId = requestUrl.searchParams.get("aroundMessageId");
    if (requestUrl.searchParams.get("latest") === "true" || beforeSeq || aroundMessageId) {
      const anchor = aroundMessageId && items.find((item) => "id" in item && item.id === aroundMessageId);
      const eligible = beforeSeq
        ? items.filter((item) => item.seq < Number(beforeSeq))
        : anchor ? items.filter((item) => item.seq <= anchor.seq) : items;
      return { items: eligible.slice(-limit), hasOlder: eligible.length > limit };
    }
    return { items: items.filter((item) => item.seq > Number(afterSeq || 0)).slice(0, limit) };
  };
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
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/v1/auth/me") return json(user);
    if (path === "/api/v1/auth/authorization") return json(testAuthorization(user, [
      { action: "read", subject: "Conversation" },
      { action: "create", subject: "Conversation" },
    ], { roleId: OPERATOR_TEST_ROLE_ID }));
    if (path === "/api/v1/roles") return json({ items: [{ id: OPERATOR_TEST_ROLE_ID, name: "OPERATOR", permissions: { inherits: [], grants: [{ action: "read", subject: "Conversation" }] } }], page: 1, limit: 100, total: 1 });
    if (path === "/api/v1/users") return json({ items: [user], page: 1, limit: 100, total: 1 });
    if (path === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    if (path === "/api/v1/media" && route.request().method() === "GET") return json({
      items: [{
        id: "qa-document", name: "QA plan", filename: "QA plan.pdf", type: "DOCUMENT",
        content_type: "application/pdf", status: "READY", size: 1024, media_url: null,
      }],
      page: 1, limit: 100, total: 1,
    });
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
    if (messagesRoom && options.longHistory && messagesRoom === "room-a") {
      return json(pageHistory(Array.from({ length: longMainCount }, (_value, index) => longMainMessage(index + 1)), requestUrl));
    }
    if (messagesRoom) return json({ items: options.rootOutsideTimeline && messagesRoom === "room-a" ? [] : [{
      id: `root-${messagesRoom}`, conversation_id: messagesRoom, seq: 1,
      sender_id: user.id, body_text: `Welcome to ${messagesRoom}`,
      created_at: "2026-11-03T01:00:00Z", attachments: [], reactions: [],
    }] });
    if (/\/thread\//.test(path)) {
      threadReads += 1;
      if (options.threadFailsInitially && threadReads <= 2) return json({ error: { code: "TEMPORARY", message: "Thread unavailable" } }, 503);
      if (options.longHistory) return json({
        threadRootId: "root-room-a", rootMessage: longMainMessage(1),
        ...pageHistory(Array.from({ length: 120 }, (_value, index) => longReply(index + 1)), requestUrl),
      });
      return json({
        threadRootId: "root-room-a",
        rootMessage: options.rootDeleted ? {
          id: "root-room-a", conversation_id: "room-a", seq: 1,
          sender_id: user.id, body_text: null, deleted_at: "2026-11-04T01:00:00Z",
          created_at: "2026-11-03T01:00:00Z", attachments: [], reactions: [],
        } : options.rootOutsideTimeline ? {
          id: "root-room-a", conversation_id: "room-a", seq: 1,
          sender_id: user.id, body_text: "Older parent outside the current message page",
          created_at: "2026-11-03T01:00:00Z",
          attachments: [{ media_asset_id: "media-old", filename: "Old plan.pdf", content_type: "application/pdf" }],
          reactions: [],
        } : undefined,
        items: [],
      });
    }
    if (/\/pins$|\/bookmarks$/.test(path)) return json({ items: [] });
    return json({});
  });
  return { addMainMessages: (count: number) => { longMainCount += count; } };
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

test("an unsent attachment stays with its conversation across desktop and phone navigation", async ({ page }) => {
  await installChatFixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/chat/room-a");

  await page.getByRole("button", { name: "Attach files" }).click();
  const picker = page.getByRole("dialog", { name: "Add Attachments" });
  await expect(picker.getByText("QA plan", { exact: true }).first()).toBeVisible();
  await picker.getByRole("button", { name: "Add" }).click();
  await picker.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("Pending Attachments")).toBeVisible();
  await expect(page.getByText("QA plan", { exact: true }).filter({ visible: true }).first()).toBeVisible();

  await page.getByRole("button", { name: /Planning room/ }).click();
  await expect(page.getByLabel("Message composer")).toBeVisible();
  await expect(page.getByText("Pending Attachments")).toBeHidden();
  await page.getByRole("button", { name: /Operations room/ }).click();
  await expect(page.getByText("QA plan", { exact: true }).filter({ visible: true }).first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Chats" }).click();
  await page.getByRole("button", { name: /Operations room/ }).click();
  await expect(page.getByText("QA plan", { exact: true }).filter({ visible: true }).first()).toBeVisible();
});

test("a verifying upload survives a chat switch and cannot be sent before it is ready", async ({ page }) => {
  await installChatFixture(page);
  let mediaReady = false;
  const media = (status: "PROCESSING" | "READY") => ({
    id: "qa-upload-media", name: "QA upload", filename: "QA upload.pdf", type: "DOCUMENT",
    content_type: "application/pdf", status, size: 12, media_url: null,
  });
  const json = (route: Route, body: unknown) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/v1/media/upload-policy", (route) => json(route, {
    max_bytes: 10_000_000, max_mb: 10, multipart_threshold_bytes: 5_000_000,
    part_size_bytes: 5_000_000, multipart_concurrency: 3, allowed_mime_types: ["application/pdf"],
  }));
  await page.route("**/api/v1/media/uploads", (route) => json(route, {
    session_id: "qa-upload-session", media_id: "qa-upload-media", state: "ACTIVE", strategy: "single",
    expires_at: "2099-01-01T00:00:00Z", part_size: null, part_count: 1, uploaded_parts: [],
    upload_url: `${origin}/qa-upload-storage`, media: null,
  }));
  await page.route("**/qa-upload-storage", (route) => route.fulfill({ status: 200, headers: { ETag: '"qa-upload"' } }));
  await page.route("**/api/v1/media/uploads/qa-upload-session/complete", (route) => json(route, {
    session_id: "qa-upload-session", media_id: "qa-upload-media", state: "COMPLETED", strategy: "single",
    expires_at: "2099-01-01T00:00:00Z", part_size: null, part_count: 1, uploaded_parts: [],
    media: media("PROCESSING"),
  }));
  await page.route("**/api/v1/media/qa-upload-media", (route) => json(route, media(mediaReady ? "READY" : "PROCESSING")));

  await page.goto("/chat/room-a");
  await page.getByRole("button", { name: "Attach files" }).click();
  const picker = page.getByRole("dialog", { name: "Add Attachments" });
  await picker.getByRole("tab", { name: "Upload New" }).click();
  await picker.locator('input[type="file"]').setInputFiles({
    name: "QA upload.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nQA\n"),
  });
  await expect(picker.getByText("processing", { exact: true })).toBeVisible();
  await picker.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Message composer").fill("Wait for verified attachment");
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();

  await page.getByRole("button", { name: /Planning room/ }).click();
  await page.getByRole("button", { name: /Operations room/ }).click();
  await expect(page.getByLabel("Message composer")).toHaveValue("Wait for verified attachment");
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();

  mediaReady = true;
  await expect(page.getByText("Pending Attachments")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
});

test("long chats and threads open at the latest page, load older, and catch up without duplicates", async ({ page }) => {
  const fixture = await installChatFixture(page, { longHistory: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/chat/room-a");
  await expect(page.getByText("Main message 120", { exact: true })).toBeVisible();
  await expect(page.getByText("Main message 1", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Load earlier messages" }).click();
  await expect(page.getByText("Main message 70", { exact: true })).toBeVisible();
  await expect(page.getByText("Main message 70", { exact: true })).toHaveCount(1);

  fixture.addMainMessages(55);
  await page.getByRole("button", { name: "Check for new messages" }).first().click();
  await expect(page.getByText("Main message 175", { exact: true })).toBeVisible();
  await expect(page.getByText("Main message 120", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Main message 70", { exact: true })).toHaveCount(1);

  await page.goto("/chat/room-a/thread/root-room-a");
  const thread = page.getByRole("dialog", { name: "Thread" });
  await expect(thread.getByText("Thread reply 120", { exact: true })).toBeVisible();
  await expect(thread.getByText("Thread reply 1", { exact: true })).toHaveCount(0);
  await thread.getByRole("button", { name: "Load earlier thread replies" }).click();
  await expect(thread.getByText("Thread reply 70", { exact: true })).toBeVisible();
  await expect(thread.getByText("Thread reply 70", { exact: true })).toHaveCount(1);

  await page.goto("/chat/room-a?focusMessageId=main-4");
  await expect(page.getByText("Main message 4", { exact: true })).toBeVisible();
  await expect(page.getByText("Main message 120", { exact: true })).toHaveCount(0);
  await expect(page.getByText("This message is earlier in the conversation.")).toHaveCount(0);

  await page.goto("/chat/room-a/thread/root-room-a?focusReplyId=reply-4");
  const focusedThread = page.getByRole("dialog", { name: "Thread" });
  await expect(focusedThread.getByText("Thread reply 4", { exact: true })).toBeVisible();
  await expect(focusedThread.getByLabel("Selected thread reply")).toContainText("Thread reply 4");
  await expect(focusedThread.getByText("Thread reply 120", { exact: true })).toHaveCount(0);
});

test("an old thread deep link shows its parent even when the main message page omits it", async ({ page }, testInfo) => {
  await installChatFixture(page, { rootOutsideTimeline: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chat/room-a/thread/root-room-a");
  const thread = page.getByRole("dialog", { name: "Thread" });
  await expect(thread).toBeVisible();
  await expect(thread.getByText("Parent Message")).toBeVisible();
  await expect(thread.getByText("Older parent outside the current message page")).toBeVisible();
  await expect(thread.getByText("Old plan.pdf").first()).toBeVisible();
  await expect(thread.getByText("No replies yet.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("old-thread-parent-390.png"), fullPage: true });
});

test("a failed thread read shows Retry without claiming there are no replies", async ({ page }) => {
  await installChatFixture(page, { rootOutsideTimeline: true, threadFailsInitially: true });
  await page.goto("/chat/room-a/thread/root-room-a");
  const thread = page.getByRole("dialog", { name: "Thread" });
  await expect(thread.getByRole("alert")).toContainText("Couldn’t load this thread");
  await expect(thread.getByText("No replies yet.")).toHaveCount(0);
  await expect(thread.getByText("Up to date")).toHaveCount(0);
  await expect(thread.getByLabel("Thread reply composer")).toBeDisabled();
  await thread.getByRole("button", { name: "Retry thread" }).click();
  await expect(thread.getByText("Older parent outside the current message page")).toBeVisible();
  await expect(thread.getByText("No replies yet.")).toBeVisible();
  await expect(thread.getByLabel("Thread reply composer")).toBeEnabled();
});

test("the thread uses the server's deleted parent over a stale main-timeline copy", async ({ page }) => {
  await installChatFixture(page, { rootDeleted: true });
  await page.goto("/chat/room-a/thread/root-room-a");
  const thread = page.getByRole("dialog", { name: "Thread" });
  await expect(thread.getByText("This message was deleted.")).toBeVisible();
  await expect(thread.getByText("Welcome to room-a")).toHaveCount(0);
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
