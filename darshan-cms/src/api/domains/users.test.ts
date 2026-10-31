import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../apiClient", () => ({ apiClient: { request: requestMock } }));

import { departmentUpdateValue, usersApi } from "./users";

beforeEach(() => requestMock.mockReset());

describe("department update payload", () => {
  it("sends an explicit null for None and preserves selected IDs", () => {
    expect(departmentUpdateValue("")).toBeNull();
    expect(departmentUpdateValue(undefined)).toBeNull();
    expect(departmentUpdateValue("  ")).toBeNull();
    expect(departmentUpdateValue("  department-id  ")).toBe("department-id");
  });
});

describe("invitation replacement contract", () => {
  it("sends the list version so concurrent managers cannot both receive a current link", async () => {
    requestMock.mockResolvedValue({});
    await usersApi.replaceInvite("invite-id", "2026-10-22T00:00:00.000Z");
    expect(requestMock).toHaveBeenCalledWith({
      path: "/users/invite/invite-id/replace",
      method: "POST",
      body: { expected_updated_at: "2026-10-22T00:00:00.000Z" },
    });
  });
});

describe("invitation list contract", () => {
  it("uses only the server-supported role and date filter names", async () => {
    requestMock.mockResolvedValue({ items: [], pagination: { page: 2, limit: 25, total: 0 } });
    const query = {
      page: 2,
      limit: 25,
      status: "pending,expired",
      email: "person@example.test",
      role: "OPERATOR" as const,
      department_id: "department-id",
      invited_before: "2026-10-28T00:00:00.000Z",
      invited_after: "2026-10-01T00:00:00.000Z",
    };

    await usersApi.listInvitations(query);

    expect(requestMock).toHaveBeenCalledWith({
      path: "/users/invite",
      method: "GET",
      query,
    });
  });
});
