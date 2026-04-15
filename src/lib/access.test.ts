import { describe, expect, it } from "vitest";
import { canManageOperatorsModule, canManageUserTarget, canReadUserTarget } from "@/lib/access";
import type { User } from "@/api/types";

const makeUser = (overrides: Partial<User>): User => ({
  id: "user-1",
  email: "user@example.com",
  role_id: "role-1",
  role: "OPERATOR",
  department_id: null,
  ...overrides,
});

describe("access helpers", () => {
  it("limits the Users page targets to the requested system-role ladder", () => {
    expect(canManageUserTarget(makeUser({ role: "SUPER_ADMIN" }), "ADMIN")).toBe(true);
    expect(canManageUserTarget(makeUser({ role: "SUPER_ADMIN" }), "OPERATOR")).toBe(true);
    expect(canManageUserTarget(makeUser({ role: "ADMIN" }), "DEPARTMENT")).toBe(true);
    expect(canManageUserTarget(makeUser({ role: "ADMIN" }), "OPERATOR")).toBe(true);
  });

  it("allows department users to manage only their own operators in the Users page", () => {
    const departmentUser = makeUser({ role: "DEPARTMENT", department_id: "dept-a" });

    expect(canManageUserTarget(departmentUser, "OPERATOR", "dept-a")).toBe(true);
    expect(canManageUserTarget(departmentUser, "OPERATOR", "dept-b")).toBe(false);
  });

  it("keeps operators read-only while still exposing operator records", () => {
    const operatorUser = makeUser({ role: "OPERATOR", department_id: "dept-a" });

    expect(canReadUserTarget(operatorUser, "OPERATOR", "dept-b")).toBe(true);
    expect(canReadUserTarget(operatorUser, "DEPARTMENT", "dept-a")).toBe(false);
    expect(canManageOperatorsModule(operatorUser)).toBe(false);
  });

  it("shows the Operators module to super admin, admin, and department users", () => {
    expect(canManageOperatorsModule(makeUser({ role: "SUPER_ADMIN" }))).toBe(true);
    expect(canManageOperatorsModule(makeUser({ role: "ADMIN" }))).toBe(true);
    expect(canManageOperatorsModule(makeUser({ role: "DEPARTMENT" }))).toBe(true);
  });
});
