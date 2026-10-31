import { expect, test, type Page, type Route } from "@playwright/test";

const runId = "00000000-0000-4000-8000-000000000001";
const operationId = "00000000-0000-4000-8000-000000000002";

const backupRecord = (overrides: Record<string, unknown> = {}) => ({
  id: runId,
  trigger_type: "MANUAL",
  repository: { kind: "LOCAL_FILESYSTEM", id: "00000000-0000-4000-8000-000000000003" },
  stage: "COMPLETE",
  attempt: { id: null, number: 1, heartbeat_at: null, lease_expires_at: null, retry_at: null, deadline_at: null },
  capture: { id: "capture-1", generation: "7", status: "SEALED", started_at: "2026-10-29T01:00:00.000Z", sealed_at: "2026-10-29T01:01:00.000Z" },
  verification: { provenance: "PUBLICATION_READ_BACK", publication_id: "publication-1", publication_status: "VERIFIED", verified_at: "2026-10-29T01:02:00.000Z", manifest_sha256: "a".repeat(64) },
  execution: { status: "SUCCEEDED", outcome: "SUCCEEDED", error_code: null, started_at: "2026-10-29T01:00:00.000Z", completed_at: "2026-10-29T01:02:00.000Z", captured_at: "2026-10-29T01:01:00.000Z" },
  lifecycle: { state: "AVAILABLE", version: 1, error_code: null },
  artifacts: [{ kind: "DATABASE", name: "database.enc", size_bytes: "9007199254740993000", sha256: "b".repeat(64) }],
  retention: { eligible: true, expires_at: "2026-10-28T00:00:00.000Z", protection_codes: [], restore_hold: "NONE", runtime_supported: true, runtime_reason_code: null },
  permissions: { can_delete: true, can_download: true, download_unavailable_code: null, download_unavailable_reason: null },
  operation: null,
  tombstone: null,
  created_at: "2026-10-29T01:00:00.000Z",
  updated_at: "2026-10-29T01:02:00.000Z",
  ...overrides,
});

const history = (items: unknown[]) => ({
  items,
  next_cursor: null,
  health: {
    latest_run_id: items.length ? runId : null,
    latest_status: items.length ? "SUCCEEDED" : null,
    latest_stage: items.length ? "COMPLETE" : null,
    latest_updated_at: items.length ? "2026-10-29T01:02:00.000Z" : null,
    active_operation_count: "0",
    retention_runtime_supported: true,
    retention_runtime_reason_code: null,
    latest_verified_success: items.length ? { run_id: runId, verified_at: "2026-10-29T01:02:00.000Z" } : null,
    latest_failure: null,
    active: null,
    repository_capacity: { status: "HEALTHY", available_bytes: "1000000", minimum_free_bytes: "1000", reason_code: null },
    alert_codes: [],
    recovery_report: null,
  },
});

async function installMocks(page: Page, input: {
  actions: string[];
  items?: unknown[];
  historyStatus?: number;
  deleteStatus?: number;
  requestedPaths?: string[];
  extraRules?: Array<{ action: string; subject: string }>;
}) {
  const rules = [...input.actions.map((action) => ({ action, subject: "Backup" })), ...(input.extraRules ?? [])];
  const user = { id: "backup-user", email: "backup@example.com", role_id: "backup-role", role: "BACKUP_OPERATOR", authorization: { rules, is_global_user_manager: false } };
  let currentItems = input.items ?? [backupRecord()];
  await page.route("**/api/v1/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    input.requestedPaths?.push(`${method} ${path}`);
    if (path === "/api/v1/auth/login" && method === "POST") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "token", csrf_token: "csrf", user }) });
    if (path === "/api/v1/auth/me") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
    if (path === "/api/v1/notifications/unread-count") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ unread_total: 0 }) });
    if (path === "/api/v1/settings/backups" && method === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ automatic_enabled: true, interval_hours: 24, log_level: "info", schedule_managed_by_deployment: true, off_host_copy_required: true, retention_days: 30 }) });
    if (path === "/api/v1/settings/backups/history") return route.fulfill({ status: input.historyStatus ?? 200, contentType: "application/json", body: input.historyStatus ? JSON.stringify({ success: false, error: { code: "BACKUP_HISTORY_FAILED", message: "Backup history unavailable" } }) : JSON.stringify(history(currentItems)) });
    if (path === `/api/v1/settings/backups/${runId}` && method === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(backupRecord()) });
    if (path === `/api/v1/settings/backups/${runId}/download` && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/octet-stream", body: "age-encrypted-fixture" });
    }
    if (path === `/api/v1/settings/backups/${runId}` && method === "DELETE") {
      if (input.deleteStatus) return route.fulfill({ status: input.deleteStatus, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "BACKUP_DELETE_STALE", message: "Backup lifecycle changed before deletion admission." } }) });
      currentItems = [backupRecord({
        lifecycle: { state: "DELETE_REQUESTED", version: 2, error_code: null },
        permissions: { can_delete: false, can_download: false, download_unavailable_code: "BACKUP_DOWNLOAD_LIFECYCLE_UNAVAILABLE", download_unavailable_reason: "BACKUP_ARTIFACT_DELETE_REQUESTED" },
        operation: { id: operationId, kind: "MANUAL_DELETE", status: "PREPARED", requested_at: "2026-10-29T02:00:00.000Z", started_at: null, completed_at: null, retry_at: null, error_code: null, progress: [] },
      })];
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ disposition: "ACCEPTED", operation_id: operationId, backup_run_id: runId, status: "PREPARED", duplicate: false }) });
    }
    if (path === `/api/v1/settings/backups/operations/${operationId}`) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: operationId, backup_run_id: runId, kind: "MANUAL_DELETE", status: "PREPARED", lifecycle_state: "DELETE_REQUESTED", requested_at: "2026-10-29T02:00:00.000Z", started_at: null, completed_at: null, retry_at: null, error_code: null, progress: [], tombstone: null }) });
    if (path === "/api/v1/settings/backups/run" && method === "POST") return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: runId, status: "PENDING", trigger_type: "MANUAL", coalesced: false }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });
}

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#login-email", "backup@example.com");
  await page.fill("#login-password", "LocalDev@123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/settings/);
}

test("Backup-only navigation avoids unrelated settings queries and keeps an accepted deletion row", async ({ page }) => {
  const requestedPaths: string[] = [];
  await installMocks(page, { actions: ["read", "create", "delete", "download"], requestedPaths });
  await login(page);
  await expect(page.getByRole("tab", { name: "Backups", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "General", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run backup now" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Encrypted" })).toBeEnabled();
  expect(requestedPaths.some((path) => /settings\/(general|branding|security|appearance|logs)/.test(path))).toBe(false);

  await page.getByRole("button", { name: "Delete artifacts", exact: true }).click();
  await expect(page.getByText("The backup history entry, deletion operation, and tombstone record remain", { exact: false })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Delete artifacts", exact: true }).click();
  await expect(page.getByTestId(`backup-row-${runId}`)).toBeVisible();
  await expect(page.getByTestId(`backup-row-${runId}`).getByText("PREPARED")).toBeVisible();
});

test("independent permissions hide create/delete but expose authorized encrypted download", async ({ page }) => {
  await installMocks(page, { actions: ["read", "download"] });
  await login(page);
  await expect(page.getByRole("button", { name: "Run backup now" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete artifacts", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Encrypted" })).toBeEnabled();
});

test("keeps legacy or unverified sources explicitly unavailable", async ({ page }) => {
  await installMocks(page, { actions: ["read", "download"], items: [backupRecord({
    repository: { kind: "LEGACY_OFF_HOST", id: null },
    permissions: { can_delete: false, can_download: false,
      download_unavailable_code: "BACKUP_DOWNLOAD_LEGACY_SOURCE_UNSUPPORTED",
      download_unavailable_reason: "BACKUP_DOWNLOAD_LEGACY_SOURCE_UNSUPPORTED" },
  })] });
  await login(page);
  await expect(page.getByText(/BACKUP_DOWNLOAD_LEGACY_SOURCE_UNSUPPORTED/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Encrypted" })).toHaveCount(0);
});

test("shows stale deletion rejection and backup history error/empty states", async ({ page }) => {
  await installMocks(page, { actions: ["read", "delete"], deleteStatus: 409 });
  await login(page);
  await page.getByRole("button", { name: "Delete artifacts", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete artifacts", exact: true }).click();
  await expect(page.locator('[role="alert"]')).toContainText("BACKUP_DELETE_STALE");

  await page.unroute("**/api/v1/**");
  await installMocks(page, { actions: ["read"], items: [] });
  await page.reload();
  await expect(page.getByText("No backup history is available for this page.")).toBeVisible();
});

test("shows a bounded backup history error state", async ({ page }) => {
  await installMocks(page, { actions: ["read"], historyStatus: 500 });
  await login(page);
  await expect(page.getByRole("alert")).toContainText("Backup history unavailable");
});

test("a user without Backup read cannot open or query the backup surface", async ({ page }) => {
  const requestedPaths: string[] = [];
  await installMocks(page, { actions: [], extraRules: [{ action: "read", subject: "Dashboard" }], requestedPaths });
  await page.goto("/login");
  await page.fill("#login-email", "backup@example.com");
  await page.fill("#login-password", "LocalDev@123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
  await page.goto("/settings");
  await page.waitForURL(/\/dashboard/);
  expect(requestedPaths.some((path) => path.includes("/settings/backups"))).toBe(false);
});
