import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:5173";
const shouldStartLocalServer = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Keep browser execution bounded on developer/QA workstations. Individual
  // suites may render videos and PDF canvases, so auto-selecting one worker per
  // CPU can exhaust the host before an assertion is reported.
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    video: process.env.E2E_BROWSER_CHANNEL === "chrome" ? "off" : "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.E2E_BROWSER_CHANNEL === "chrome" ? { channel: "chrome" as const } : {}),
      },
    },
  ],
  webServer: shouldStartLocalServer
    ? {
        command: "npm run dev -- --host 127.0.0.1 --port 5173",
        url: baseURL,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
      }
    : undefined,
});
