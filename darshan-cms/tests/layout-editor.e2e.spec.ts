import { expect, test, type Page } from "@playwright/test";
import { ADMIN_TEST_ROLE_ID, ADMIN_TEST_USER_ID, adminAuthorization } from "./helpers/selfAuthorization";

const adminUser = {
  id: ADMIN_TEST_USER_ID,
  email: "admin@darshan.local",
  first_name: "Admin",
  last_name: "User",
  role_id: ADMIN_TEST_ROLE_ID,
  role: "ADMIN",
};

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator("#login-email").fill(adminUser.email);
  await page.locator("#login-password").fill("LocalDev@123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
}

async function installLayoutApi(page: Page) {
  const saved: Array<Record<string, unknown>> = [];
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    let body: unknown = {};
    if (path === "/api/v1/auth/login" && method === "POST") body = { token: "cms-token", csrf_token: "csrf-token", user: adminUser };
    else if (path === "/api/v1/auth/authorization") body = adminAuthorization(adminUser);
    else if (path === "/api/v1/roles") body = { items: [{ id: ADMIN_TEST_ROLE_ID, name: "ADMIN", permissions: { inherits: [], grants: [{ action: "manage", subject: "all" }] } }], page: 1, limit: 100, total: 1 };
    else if (path === "/api/v1/screens/aspect-ratios") body = { items: [{ id: "screen-1", name: "Test", aspect_ratio: "16:9" }], defaults: [] };
    else if (path === "/api/v1/layouts" && method === "POST") {
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      saved.push(payload);
      body = { id: "layout-created", ...payload };
    } else if (path === "/api/v1/layouts") body = { items: [], pagination: { page: 1, limit: 9, total: 0 } };
    else if (path === "/api/v1/notifications/unread-count") body = { unread_total: 0 };
    await route.fulfill({ status: path === "/api/v1/layouts" && method === "POST" ? 201 : 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return saved;
}

test("layout editor fits a phone, supports numeric edits and undo, then saves the authored geometry", async ({ page }, testInfo) => {
  const saved = await installLayoutApi(page);
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/layouts/new");
  await page.getByLabel("Name *").fill("Phone editor test");
  const viewport = page.getByTestId("layout-canvas-viewport");
  const canvas = page.getByTestId("layout-canvas");
  await expect(canvas).toBeVisible();
  const viewportBox = await viewport.boundingBox();
  const canvasBox = await canvas.boundingBox();
  expect(viewportBox && canvasBox && canvasBox.width <= viewportBox.width).toBeTruthy();
  await page.getByRole("button", { name: "Add Slot" }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await expect(page.getByLabel(/X \(/)).toHaveValue("0");
  await page.getByLabel(/X \(/).fill("0.15");
  await page.getByLabel(/X \(/).blur();
  await expect(page.getByLabel(/X \(/)).toHaveValue("0.2");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("phone-layout.png"), fullPage: true });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByLabel(/X \(/)).toHaveValue("0");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByLabel(/X \(/)).toHaveValue("0.2");
  for (const width of [820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const resizedViewport = await viewport.boundingBox();
    const resizedCanvas = await canvas.boundingBox();
    expect(resizedViewport && resizedCanvas && resizedCanvas.width <= resizedViewport.width).toBeTruthy();
    if (width === 1440) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath("desktop-layout.png"), fullPage: true });
    }
  }
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect((saved[0].spec as { slots: Array<{ x: number }> }).slots[0].x).toBe(0.2);
});

test("layout editor draws with touch, moves a layer by keyboard, and restores an accidental deletion", async ({ page }) => {
  await installLayoutApi(page);
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/layouts/new");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  const canvas = page.getByTestId("layout-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is unavailable");
  const start = { x: box.x + box.width * 0.1, y: box.y + box.height * 0.1 };
  const end = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start.x, y: start.y, id: 9 }] });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: end.x, y: end.y, id: 9 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.getByLabel("Slot ID")).toHaveValue("slot-1");
  const before = await page.getByLabel(/X \(/).inputValue();
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel(/X \(/)).not.toHaveValue(before);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Slots (0)")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Slots (1)")).toBeVisible();
  await page.getByRole("button", { name: /slot-1.*40%/ }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Add Slot" }).click();
  await expect(page.getByLabel("Slot ID")).toHaveValue("slot-1");
});

test("layout editor moves and resizes with a mouse gesture, with one undo step per gesture", async ({ page }) => {
  await installLayoutApi(page);
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/layouts/new");
  await page.getByRole("button", { name: "Add Slot" }).click();
  const canvas = page.getByTestId("layout-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const canvasBox = await canvas.boundingBox();
  const slotBox = await page.getByTestId("layout-slot-slot-1").boundingBox();
  if (!canvasBox || !slotBox) throw new Error("Canvas and slot must be visible");
  const start = { x: slotBox.x + slotBox.width / 2, y: slotBox.y + slotBox.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + canvasBox.width * 0.2, start.y + canvasBox.height * 0.1, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByLabel(/X \(/)).toHaveValue("0.2");
  await expect(page.getByLabel(/Y \(/)).toHaveValue("0.1");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByLabel(/X \(/)).toHaveValue("0");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByLabel(/X \(/)).toHaveValue("0.2");

  const handle = await page.getByTestId("resize-slot-slot-1").boundingBox();
  if (!handle) throw new Error("Resize handle must be visible");
  const handleCenter = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  await page.mouse.move(handleCenter.x, handleCenter.y);
  await page.mouse.down();
  await page.mouse.move(handleCenter.x + canvasBox.width * 0.1, handleCenter.y + canvasBox.height * 0.1, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByLabel(/Width \(/)).toHaveValue("0.4");
  await expect(page.getByLabel(/Height \(/)).toHaveValue("0.4");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByLabel(/Width \(/)).toHaveValue("0.3");
});
