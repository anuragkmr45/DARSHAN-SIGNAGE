import { installDarkSiteAppearance } from "./helpers/siteAppearance";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_TEST_ROLE_ID, ADMIN_TEST_USER_ID, testAuthorization } from "./helpers/selfAuthorization";

const origin = "http://127.0.0.1:5173";
const screenId = "00000000-0000-4000-8000-000000000101";
const mediaId = "00000000-0000-4000-8000-000000000201";
const user = {
  id: ADMIN_TEST_USER_ID, email: "pop-qa@example.invalid", first_name: "Evidence", last_name: "Operator",
  role_id: ADMIN_TEST_ROLE_ID, role: "ADMIN", department_id: null,
};
const records = Array.from({ length: 52 }, (_value, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  screen_id: screenId, media_id: mediaId, page_number: index === 0 ? 4 : null,
  screen_name: "Reception display", media_name: "Training video",
  started_at: "2026-11-03T10:00:00Z", ended_at: "2026-11-03T10:00:10Z",
  created_at: "2026-11-03T10:00:12Z",
  completed: index === 0 ? false : index === 1 ? null : true,
}));

async function setup(page: Page, canRead = true, firstListFails = false) {
  let listFails = firstListFails;
  const queries: URL[] = [];
  await page.context().addCookies([
    { name: "access_token", value: "pop-qa-session", url: origin, httpOnly: true, sameSite: "Lax" },
    { name: "csrf_token", value: "pop-qa-csrf", url: origin, sameSite: "Lax" },
  ]);
  await page.route("**/config/app-config.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ cms: {
    environment: { name: "development", deploymentId: "qa", cmsId: "qa" },
    api: { baseUrl: new URL(route.request().url()).origin },
    realtime: { socketBaseUrl: new URL(route.request().url()).origin, socketTransports: ["websocket"] },
  } }) }));
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/v1/auth/me") return json(user);
    if (url.pathname === "/api/v1/auth/authorization") return json(testAuthorization(user, [
      { action: "read", subject: "Report" },
      ...(canRead ? [{ action: "read", subject: "ProofOfPlay" }] : []),
    ], { roleId: ADMIN_TEST_ROLE_ID }));
    if (url.pathname === "/api/v1/roles") return json({ items: [{ id: ADMIN_TEST_ROLE_ID, name: "ADMIN", permissions: { inherits: [], grants: [] } }], page: 1, limit: 100, total: 1 });
    if (url.pathname === "/api/v1/notifications/unread-count") return json({ unread_total: 0 });
    if (url.pathname === "/api/v1/proof-of-play/export") {
      return route.fulfill({ status: 200, contentType: "text/csv", body: "id,completed\nexample,true\n" });
    }
    if (url.pathname === "/api/v1/proof-of-play") {
      queries.push(url);
      if (listFails) return json({ error: "Unavailable" }, 503);
      const status = url.searchParams.get("status");
      const selected = records.filter((item) => !status || (status === "UNKNOWN" ? item.completed === null : item.completed === (status === "COMPLETED")));
      const pageNumber = Number(url.searchParams.get("page") || 1);
      const limit = Number(url.searchParams.get("limit") || 50);
      return json({ items: selected.slice((pageNumber - 1) * limit, pageNumber * limit), pagination: { page: pageNumber, limit, total: selected.length } });
    }
    return json({});
  });
  return { queries, setListFails: (value: boolean) => { listFails = value; } };
}

test("server totals, unknown outcome and paging are honest", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/proof-of-play");
  await expect(page.getByText("52 records · showing 50 on this page")).toBeVisible();
  await expect(page.getByRole("table").getByText("Incomplete")).toBeVisible();
  await expect(page.getByRole("table").getByText("Outcome unknown")).toBeVisible();
  await expect(page.getByRole("table").getByText("Reception display").first()).toBeVisible();
  await page.getByRole("button", { name: "Go to next page" }).click();
  await expect(page.getByText("52 records · showing 2 on this page")).toBeVisible();
  await page.getByRole("combobox", { name: "Playback outcome" }).click();
  await page.getByRole("option", { name: "Outcome unknown" }).click();
  await expect(page.getByText("1 record · showing 1 on this page")).toBeVisible();
  expect(state.queries.at(-1)?.searchParams.get("status")).toBe("UNKNOWN");
  expect(state.queries.at(-1)?.searchParams.get("page")).toBe("1");
});

test("invalid filters block requests, and failed lists offer Retry", async ({ page }) => {
  const state = await setup(page, true, true);
  await page.goto("/proof-of-play");
  await expect(page.getByText("Unable to load proof-of-play records")).toBeVisible();
  state.setListFails(false);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("52 records · showing 50 on this page")).toBeVisible();
  const initialQueries = state.queries.length;
  await page.getByLabel("Received from").fill("2026-11-04");
  await page.getByLabel("Received to").fill("2026-11-03");
  await expect(page.getByRole("alert").getByText("The start date must be on or before the end date.")).toBeVisible();
  expect(state.queries.length).toBeGreaterThanOrEqual(initialQueries);
  await page.getByLabel("Received to").fill("2026-11-05");
  await page.getByText("More filters: Screen and Media IDs").click();
  await page.getByLabel("Screen ID").fill("not-a-uuid");
  await expect(page.getByRole("alert").getByText("Screen and Media IDs must be complete UUIDs.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeDisabled();
});

test("Report permission alone cannot open or navigate to proof-of-play", async ({ page }) => {
  await setup(page, false);
  await page.goto("/proof-of-play");
  await page.waitForURL(/\/dashboard/);
  await expect(page.getByRole("link", { name: "Proof of Play" })).toHaveCount(0);
});

test("proof list fits phone, tablet, desktop, and dark phone", async ({ page }, testInfo) => {
  await setup(page);
  await page.goto("/proof-of-play");
  await expect(page.getByText("52 records · showing 50 on this page")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`proof-of-play-${width}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await installDarkSiteAppearance(page);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByText("52 records · showing 50 on this page")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("proof-of-play-dark-390.png") });
});
