import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/api/queryKeys";

const fixture = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/api/apiClient", () => ({ apiClient: { request: fixture.request } }));
import { liveSessionsApi } from "./liveSessions";

describe("live source API contract", () => {
  beforeEach(() => fixture.request.mockReset());
  it("uses the shared client for paginated search and availability filters", async () => {
    const response = { items: [], pagination: { page: 2, limit: 9, total: 0, pages: 0 } };
    fixture.request.mockResolvedValue(response);
    await expect(liveSessionsApi.list({ page: 2, limit: 9, search: "Hall", active_only: true })).resolves.toBe(response);
    expect(fixture.request).toHaveBeenCalledWith({ path: "/live-sessions", method: "GET", query: { page: 2, limit: 9, search: "Hall", active_only: true } });
  });
  it("forwards only authoring payloads and revision-fenced mutations", async () => {
    await liveSessionsApi.create({ name: "Hall", presenter_user_id: "presenter", microphone: false, screen_share_audio: false, is_active: true });
    await liveSessionsApi.update("source", { expected_revision: 3, microphone: true });
    await liveSessionsApi.remove("source", 4);
    expect(fixture.request.mock.calls).toEqual([
      [{ path: "/live-sessions", method: "POST", body: { name: "Hall", presenter_user_id: "presenter", microphone: false, screen_share_audio: false, is_active: true } }],
      [{ path: "/live-sessions/source", method: "PATCH", body: { expected_revision: 3, microphone: true } }],
      [{ path: "/live-sessions/source", method: "DELETE", body: { expected_revision: 4 } }],
    ]);
  });
  it("loads current detail and scopes cached lists/details to the signed-in account", async () => {
    await liveSessionsApi.getById("source");
    expect(fixture.request).toHaveBeenCalledWith({ path: "/live-sessions/source", method: "GET" });
    expect(queryKeys.liveSessionsList({ actorId: "a", page: 1 })).not.toEqual(queryKeys.liveSessionsList({ actorId: "b", page: 1 }));
    expect(queryKeys.liveSession("source", "a")).not.toEqual(queryKeys.liveSession("source", "b"));
  });
});
