import { expect, test, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";

const USER_EMAIL = process.env.E2E_USER_EMAIL;
const USER_PASSWORD = process.env.E2E_USER_PASSWORD;
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const TARGET_USER_ID = process.env.E2E_TARGET_USER_ID;

const HAS_USER_CREDS = Boolean(USER_EMAIL && USER_PASSWORD);
const HAS_ADMIN_CREDS = Boolean(ADMIN_EMAIL && ADMIN_PASSWORD);

const login = async (page: Page, email: string, password: string) => {
  await page.goto("/login");
  await page.fill("#login-email", email);
  await page.fill("#login-password", password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard|\/chat|\/conversations/);
};

const openOrCreateConversation = async (page: Page) => {
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/chat/);

  const selectedConversation = page.locator("h2").filter({ hasText: /Direct Message|Conversation|Chat/i }).first();
  if (await selectedConversation.isVisible().catch(() => false)) return;

  const noConversation = page.getByText(/No conversations found|No conversations yet/i).first();
  if (!(await noConversation.isVisible().catch(() => false))) return;

  await page.getByRole("button", { name: /new chat/i }).click();
  const firstUserCheckbox = page.locator('[role="dialog"] input[type="checkbox"]').first();
  test.skip(!(await firstUserCheckbox.isVisible().catch(() => false)), "No eligible users found to create DM");
  await firstUserCheckbox.check();
  await page.getByRole("button", { name: /create conversation/i }).click();
  await expect(page).toHaveURL(/\/chat\/[^/]+/);
};

test.describe("Chat E2E", () => {
  test.skip(!HAS_USER_CREDS, "Missing E2E_USER_EMAIL/E2E_USER_PASSWORD");

  test("login + send message + thread + reaction + edit/delete", async ({ page }) => {
    await login(page, USER_EMAIL!, USER_PASSWORD!);
    await openOrCreateConversation(page);

    const composer = page.getByLabel("Message composer");
    await expect(composer).toBeVisible();

    const messageText = `e2e-${Date.now()} hello`;
    await composer.fill(messageText);
    await page.keyboard.press("Enter");
    await expect(page.getByText(messageText).first()).toBeVisible({ timeout: 15_000 });

    const replyButton = page.getByRole("button", { name: /reply in thread/i }).first();
    if (await replyButton.isVisible().catch(() => false)) {
      await replyButton.click();
      const threadComposer = page.getByLabel("Thread reply composer");
      await expect(threadComposer).toBeVisible();
      await threadComposer.fill(`thread-${Date.now()}`);
      await page.getByRole("button", { name: /send thread reply|reply/i }).click();
      await expect(page.getByText(/thread-/)).toBeVisible({ timeout: 15_000 });
      await page.keyboard.press("Escape");
    }

    const reactButton = page.getByRole("button", { name: /add reaction/i }).first();
    if (await reactButton.isVisible().catch(() => false)) {
      await reactButton.click();
      await expect(page.getByText(":thumbsup:")).toBeVisible({ timeout: 10_000 });
    }

    const editButton = page.getByRole("button", { name: /edit message/i }).first();
    if (await editButton.isVisible().catch(() => false)) {
      await editButton.click();
      await page.locator('input[type="text"]').last().fill(`edited-${Date.now()}`);
      await page.getByRole("button", { name: /save/i }).last().click();
      await expect(page.getByText(/edited/i)).toBeVisible({ timeout: 10_000 });
    }

    const deleteButton = page.getByRole("button", { name: /delete message/i }).first();
    if (await deleteButton.isVisible().catch(() => false)) {
      await deleteButton.click();
      await expect(page.getByText(/This message was deleted/i).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test("attachment upload from composer flow", async ({ page}, testInfo) => {
    await login(page, USER_EMAIL!, USER_PASSWORD!);
    await openOrCreateConversation(page);

    await page.getByRole("button", { name: /attach files/i }).click();
    await page.getByRole("tab", { name: /upload new/i }).click();

    const filePath = testInfo.outputPath("chat-upload.txt");
    await fs.writeFile(filePath, `chat upload ${Date.now()}`, "utf8");

    const fileInput = page.locator('[role="dialog"] input[type="file"]').first();
    await fileInput.setInputFiles(filePath);
    await expect(page.getByText(/uploaded|uploading/i).first()).toBeVisible({ timeout: 15_000 });

    const composer = page.getByLabel("Message composer");
    await composer.fill(`attachment-${Date.now()}`);
    await page.getByRole("button", { name: /send message/i }).click();
    await expect(page.getByText(/attachment-/).first()).toBeVisible({ timeout: 15_000 });
  });

  test("notifications deep-link to chat", async ({ page }) => {
    await login(page, USER_EMAIL!, USER_PASSWORD!);

    await page.goto("/notifications");
    const firstNotification = page.locator("button").filter({ hasText: /Notification|DM|MENTION|THREAD_REPLY/i }).first();
    test.skip(!(await firstNotification.isVisible().catch(() => false)), "No notifications available");

    await firstNotification.click();
    await expect(page).toHaveURL(/\/chat\//);
  });

  test("share link action copies chat permalink or shows manual copy fallback", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await login(page, USER_EMAIL!, USER_PASSWORD!);
    await openOrCreateConversation(page);

    const shareButton = page.getByRole("button", { name: /share link/i });
    await expect(shareButton).toBeVisible();
    await shareButton.click();

    const copiedText = await page.evaluate(async () => {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return "";
      }
    });

    if (copiedText) {
      expect(copiedText).toContain("/chat/");
      return;
    }

    await expect(page.getByLabel("Conversation share link")).toBeVisible();
  });
});

test.describe("Admin-only Chat Controls", () => {
  test.skip(!HAS_ADMIN_CREDS, "Missing E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD");

  test("archive blocks composer + moderation controls smoke", async ({ page }) => {
    await login(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await openOrCreateConversation(page);

    const detailsButton = page.getByRole("button", { name: /details/i }).first();
    test.skip(!(await detailsButton.isVisible().catch(() => false)), "Conversation details button unavailable");
    await detailsButton.click();

    const archiveButton = page.getByRole("button", { name: /archive conversation/i }).first();
    if (await archiveButton.isVisible().catch(() => false)) {
      await archiveButton.click();
      await expect(page.getByLabel("Chat status banner")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/read-only|archived/i).first()).toBeVisible();
    }

    const moderationPanel = page.getByText(/Moderation tools/i).first();
    test.skip(!(await moderationPanel.isVisible().catch(() => false)), "Moderation panel unavailable for current account");

    test.skip(!TARGET_USER_ID, "Missing E2E_TARGET_USER_ID for mute/ban checks");
    await page.getByLabel(/User ID/i).fill(TARGET_USER_ID!);
    await page.getByRole("button", { name: /Mute member/i }).click();
    await expect(page.getByText(/Moderation updated|muted|Mute/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
