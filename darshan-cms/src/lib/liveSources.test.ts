import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/apiClient";
import type { LiveSession, User } from "@/api/types";
import { eligibleLivePresenters, liveSourceCreatePayload, liveSourceError, liveSourceUpdatePayload, liveSourceValues, loadLivePresenters } from "./liveSources";
const fixture = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/api/domains/users", () => ({ usersApi: { list: fixture.list } }));
const user = (id: string, changes: Partial<User> = {}): User => ({ id, email: `${id}@example.test`, role_id: "custom", role: "CUSTOM_AUTHOR", is_active: true, ...changes });
const source = (): LiveSession => ({ id: "source", name: "Original", description: null, presenter_user_id: "76140ec0-caad-421b-b5f8-c45b22f19fda",
  microphone: false, screen_share_audio: false, is_active: true, revision: 3, policy_revision: 2, created_by: "creator", owner_scope: "DEPARTMENT",
  owner_department_id: "department-a", ownership: null, permissions: { can_update: true, can_delete: true }, created_at: "", updated_at: "" });

describe("live source editing and current directory", () => {
  beforeEach(() => fixture.list.mockReset());
  it("starts with active source and audio off and never forwards ownership", () => {
    const values = liveSourceValues(null, "76140ec0-caad-421b-b5f8-c45b22f19fda"); values.name = "  Hall  ";
    expect(liveSourceCreatePayload({ ...values, owner_scope: "ORGANIZATION" } as typeof values)).toEqual({ name: "Hall", description: null,
      presenter_user_id: values.presenter_user_id, microphone: false, screen_share_audio: false, is_active: true });
    expect(() => liveSourceCreatePayload({ ...values, name: " ", presenter_user_id: "" })).toThrow();
  });
  it("keeps the loaded revision and omits an unchanged assigned presenter on metadata edits", () => {
    const baseline = source(), values = liveSourceValues(baseline); values.name = "Updated";
    expect(liveSourceUpdatePayload(baseline, values)).toEqual({ expected_revision: 3, name: "Updated" });
    expect(liveSourceUpdatePayload(baseline, liveSourceValues(baseline))).toEqual({ expected_revision: 3 });
    expect(liveSourceUpdatePayload({ ...baseline, description: "Old text" }, { ...values, description: "" })).toMatchObject({ description: null });
  });
  it("includes secondary memberships while excluding inactive and foreign-department presenters", () => {
    const users = [user("primary", { department_id: "department-a" }), user("additional", { department_id: "department-b", additional_department_ids: ["department-a"] }),
      user("metadata", { departments: [{ id: "department-a", name: "A", is_primary: false }] }), user("inactive", { is_active: false, department_id: "department-a" }),
      user("foreign", { department_id: "department-b" })];
    expect(eligibleLivePresenters(users, source()).map(value => value.id)).toEqual(["primary", "additional", "metadata"]);
  });
  it("paginates the existing scoped users API and de-duplicates active results", async () => {
    fixture.list.mockResolvedValueOnce({ items: [user("a")], total: 150 }).mockResolvedValueOnce({ items: [user("a"), user("b"), user("inactive", { is_active: false })], total: 150 });
    expect((await loadLivePresenters()).map(value => value.id)).toEqual(["a", "b"]);
    expect(fixture.list.mock.calls).toEqual([[{ page: 1, limit: 100, is_active: true }], [{ page: 2, limit: 100, is_active: true }]]);
  });
  it("keeps409 blockers readable and ignores arbitrary nested details", () => {
    const error = liveSourceError(new ApiError({ status: 409, code: "LIVE_SESSION_IN_USE", message: "In use",
      details: { blockers: { schedule_items: 2, active_publishes: 1, live_occurrences: 4, future_category: 3, secret_field: "do not display", negative: -2 } } }), "delete");
    expect(error.blockers).toEqual([{ label: "Editable or current/future schedule items", count: 2 }, { label: "Active published schedules", count: 1 },
      { label: "Live holds, approvals and publications", count: 4 }, { label: "Other active references", count: 3 }]);
    expect(JSON.stringify(error)).not.toContain("do not display");
  });
  it("requires review after stale revision and treats unconfirmed writes separately from failed reads", () => {
    expect(liveSourceError(new ApiError({ status: 409, code: "LIVE_SESSION_REVISION_CONFLICT", message: "stale" })).stale).toBe(true);
    expect(liveSourceError(new ApiError({ status: 408, message: "timeout" }), "save").uncertain).toBe(true);
    expect(liveSourceError(new ApiError({ status: 500, message: "offline" }), "load").uncertain).toBe(false);
  });
});
