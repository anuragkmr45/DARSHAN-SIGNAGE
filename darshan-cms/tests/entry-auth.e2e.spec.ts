import { expect, test } from "@playwright/test";

const installConfig = async (page: import("@playwright/test").Page) => {
  await page.route("**/config/app-config.json", (route) => {
    const origin = new URL(route.request().url()).origin;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ cms: {
        environment: { name: "development", deploymentId: "entry-test", cmsId: "entry-test" },
        api: { baseUrl: origin },
        realtime: { socketBaseUrl: origin, socketTransports: ["websocket"] },
      } }),
    });
  });
};

test("public entry offers one honest sign-in path at phone, tablet and desktop widths", async ({ page }, testInfo) => {
  await installConfig(page);
  await page.route("**/api/v1/**", (route) => route.fulfill({
    status: 401, contentType: "application/json", body: JSON.stringify({ error: { message: "Unauthenticated" } }),
  }));

  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Keep every display on course." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in to DARSHAN" })).toBeVisible();
    await expect(page.getByText("Request Demo")).toHaveCount(0);
    await expect(page.getByText("Start Free Trial")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`), fullPage: true });

    await page.getByRole("link", { name: "Sign in to DARSHAN" }).click();
    await expect(page.getByRole("heading", { name: "Sign in to DARSHAN" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
    await expect(page.getByText("Sign Up")).toHaveCount(0);
    await expect(page.getByText("Forgot password?")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`sign-in-${width}.png`), fullPage: true });
  }

  await page.addInitScript(() => window.localStorage.setItem("theme", "dark"));
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/login");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("sign-in-dark-390.png"), fullPage: true });
});

test("failed sign-in explains the next step and preserves entered credentials for retry", async ({ page }) => {
  await installConfig(page);
  let attempts = 0;
  await page.route("**/api/v1/**", (route) => {
    if (new URL(route.request().url()).pathname === "/api/v1/auth/login") {
      attempts += 1;
      return route.fulfill({
        status: attempts === 1 ? 401 : 429,
        contentType: "application/json",
        body: JSON.stringify({ error: {
          message: attempts === 1 ? "Invalid credentials" : "Too many failed attempts",
          details: attempts === 1 ? undefined : { retry_after_seconds: 124 },
        } }),
      });
    }
    return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { message: "Unauthenticated" } }) });
  });

  await page.goto("/login?redirect=%2Fscreens");
  await page.getByLabel("Email").fill("operator@site.example");
  await page.getByLabel("Password", { exact: true }).fill("incorrect123");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("alert")).toHaveText("Email or password is incorrect. Check both and try again.");
  await expect(page.getByLabel("Email")).toHaveValue("operator@site.example");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("incorrect123");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("alert")).toHaveText("Too many sign-in attempts. Try again in about 3 minutes.");
  expect(attempts).toBe(2);
});
