import { expect, test } from "@playwright/test";

test("recipient can activate with a code and new password, then sign in", async ({ page }) => {
  let submitted: { token: string; password: string } | null = null;
  await page.route("**/api/v1/**", (route) => {
    if (route.request().url().includes("/users/activate")) {
      submitted = route.request().postDataJSON() as { token: string; password: string };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, user_id: "qa-user" }) });
    }
    return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { message: "Unauthenticated" } }) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/activate");
  await page.screenshot({ path: "../qa-artifacts/evidence/product-ui-users/activation-phone.png", fullPage: true });
  await page.getByLabel("Invitation code").fill("  test-code-123  ");
  await page.getByLabel("New password").fill("StrongPassword123!");
  await page.getByLabel("Confirm password").fill("StrongPassword123!");
  await page.getByRole("button", { name: "Activate Account" }).click();
  await expect(page.getByRole("heading", { name: "Account activated" })).toBeVisible();
  expect(submitted).toEqual({ token: "test-code-123", password: "StrongPassword123!" });
  await page.getByRole("link", { name: "Go to Sign In" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("invalid, expired or replayed code keeps form for a new attempt", async ({ page }) => {
  await page.route("**/api/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { message: "Invalid or expired token" } }) }));
  await page.goto("/activate");
  await page.getByLabel("Invitation code").fill("expired-code");
  await page.getByLabel("New password").fill("StrongPassword123!");
  await page.getByLabel("Confirm password").fill("StrongPassword123!");
  await page.getByRole("button", { name: "Activate Account" }).click();
  await expect(page.getByRole("alert")).toContainText("invalid, expired, or already used");
  await expect(page.getByLabel("Invitation code")).toHaveValue("expired-code");
});

test("short or mismatched password is stopped before the API request", async ({ page }) => {
  let activationRequests = 0;
  await page.route("**/api/v1/**", (route) => {
    if (route.request().url().includes("/users/activate")) activationRequests += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto("/activate");
  await page.getByLabel("Invitation code").fill("test-code");
  await page.getByLabel("New password").fill("short");
  await page.getByLabel("Confirm password").fill("short");
  await page.getByRole("button", { name: "Activate Account" }).click();
  await expect(page.getByRole("alert")).toContainText("at least eight characters");
  await page.getByLabel("New password").fill("StrongPassword123!");
  await page.getByRole("button", { name: "Activate Account" }).click();
  await expect(page.getByRole("alert")).toContainText("passwords do not match");
  expect(activationRequests).toBe(0);
});

test("server password policy rejection preserves the activation form", async ({ page }) => {
  await page.route("**/api/v1/**", (route) => route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "Validation failed", details: [{ field: "password", message: "Password must include a special character" }] } }) }));
  await page.goto("/activate");
  await page.getByLabel("Invitation code").fill("valid-code");
  await page.getByLabel("New password").fill("Password123");
  await page.getByLabel("Confirm password").fill("Password123");
  await page.getByRole("button", { name: "Activate Account" }).click();
  await expect(page.getByRole("alert")).toContainText("special character");
  await expect(page.getByLabel("Invitation code")).toHaveValue("valid-code");
});
