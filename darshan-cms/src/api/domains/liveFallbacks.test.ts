import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/api/apiClient", () => ({ apiClient: { request: fixture.request } }));
import { liveFallbacksApi } from "./liveFallbacks";

describe("live fallback and authoring API", () => {
  beforeEach(() => fixture.request.mockReset());
  it("uses shared authenticated API requests and explicit failed-preparation retry", async () => {
    await liveFallbacksApi.prepare("presentation"); await liveFallbacksApi.prepare("presentation", true);
    await liveFallbacksApi.get("prep/id"); await liveFallbacksApi.preview("prep/id");
    expect(fixture.request.mock.calls).toEqual([
      [{ path: "/live-fallback-preparations", method: "POST", body: { presentation_id: "presentation", retry_failed: false } }],
      [{ path: "/live-fallback-preparations", method: "POST", body: { presentation_id: "presentation", retry_failed: true } }],
      [{ path: "/live-fallback-preparations/prep%2Fid", method: "GET" }],
      [{ path: "/live-fallback-preparations/prep%2Fid/preview", method: "GET" }],
    ]);
  });
  it("forwards the same submission identity for a caller retry without inventing another command", async () => {
    const payload = { request_id: "same-command", expected_revision: 3, expected_live_fingerprint: "a".repeat(64), notes: "Reviewed" };
    await liveFallbacksApi.submitDraft("draft", payload); await liveFallbacksApi.submitDraft("draft", payload); await liveFallbacksApi.getDraft("draft");
    expect(fixture.request.mock.calls[0]).toEqual(fixture.request.mock.calls[1]);
    expect(fixture.request.mock.calls[2]).toEqual([{ path: "/live-schedule-drafts/draft", method: "GET" }]);
  });
});
