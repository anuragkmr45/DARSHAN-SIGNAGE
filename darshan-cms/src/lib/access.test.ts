import { describe, expect, it } from "vitest";
import {
  canDeleteUserTarget,
  canDeleteLayoutRecord,
  canDeleteMediaRecord,
  canManageLayoutRecord,
  canManageOperatorsModule,
  canManageUserTarget,
  canReadUserTarget,
  canAccessModule,
  getContentCreatorLabel,
  getContentOwnershipLabel,
} from "@/lib/access";
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
  it("gates live authoring by effective grants instead of a custom role name or schedule approval", () => {
    const custom = makeUser({ role: "CUSTOM_AUTHOR" });
    expect(canAccessModule("live", custom, (action, subject) => action === "create" && subject === "LiveBroadcast")).toBe(true);
    expect(canAccessModule("live", custom, (action, subject) => action === "read" && subject === "LiveBroadcast")).toBe(true);
    expect(canAccessModule("live", custom, (action, subject) => action === "approve" && subject === "ScheduleRequest")).toBe(false);
    expect(canAccessModule("live", makeUser({ role: "SUPER_ADMIN" }), () => false)).toBe(false);
  });
  it("allows super admin to manage every role while protecting super-admin deletion", () => {
    expect(canManageUserTarget(makeUser({ role: "SUPER_ADMIN" }), "ADMIN")).toBe(true);
    expect(canManageUserTarget(makeUser({ role: "SUPER_ADMIN" }), "DEPARTMENT")).toBe(true);
    expect(canManageUserTarget(makeUser({ role: "SUPER_ADMIN" }), "OPERATOR")).toBe(true);
    expect(canManageUserTarget(makeUser({ role: "SUPER_ADMIN" }), "CUSTOM_EDITOR")).toBe(true);
    expect(canManageUserTarget(makeUser({ role: "SUPER_ADMIN" }), "SUPER_ADMIN")).toBe(true);
    expect(canDeleteUserTarget(makeUser({ role: "SUPER_ADMIN" }), "SUPER_ADMIN")).toBe(true);
    expect(canDeleteUserTarget(makeUser({ role: "SUPER_ADMIN" }), "DEPARTMENT")).toBe(true);
    expect(canManageUserTarget(makeUser({ role: "ADMIN" }), "DEPARTMENT")).toBe(true);
    expect(canManageUserTarget(makeUser({ role: "ADMIN" }), "OPERATOR")).toBe(true);
  });

  it("allows department users to manage only their own operators in the Users page", () => {
    const departmentUser = makeUser({ role: "DEPARTMENT", department_id: "dept-a" });

    expect(canManageUserTarget(departmentUser, "OPERATOR", "dept-a")).toBe(true);
    expect(canManageUserTarget(departmentUser, "OPERATOR", "dept-b")).toBe(false);
  });

  it("limits directory records to the current department", () => {
    const operatorUser = makeUser({ role: "OPERATOR", department_id: "dept-a" });

    expect(canReadUserTarget(operatorUser, "OPERATOR", "dept-b")).toBe(false);
    expect(canReadUserTarget(operatorUser, "DEPARTMENT", "dept-a")).toBe(true);
  });

  it("uses permissions rather than role names for operator management", () => {
    expect(canManageOperatorsModule((action, subject) => action === "update" && subject === "User")).toBe(true);
    expect(canManageOperatorsModule(() => false)).toBe(false);
  });

  it("uses server resource permissions instead of guessing from the creator", () => {
    const operator = makeUser({ id: "creator-1", role: "OPERATOR", department_id: "dept-a" });
    expect(
      canManageLayoutRecord(operator, {
        created_by: "creator-1",
        permissions: { can_update: false, can_delete: false },
      })
    ).toBe(false);
    expect(
      canDeleteMediaRecord(makeUser({ role: "ADMIN" }), {
        created_by: "creator-1",
        permissions: { can_update: false, can_delete: false },
      })
    ).toBe(false);
    expect(canManageLayoutRecord(operator, { created_by: "creator-1" })).toBe(false);
    expect(canDeleteLayoutRecord(operator, { created_by: "creator-1" })).toBe(false);
    expect(
      canDeleteLayoutRecord(operator, {
        created_by: "creator-1",
        permissions: { can_update: true, can_delete: false },
      })
    ).toBe(false);
    expect(
      canDeleteMediaRecord(makeUser({ role: "ADMIN" }), { created_by: "creator-1" })
    ).toBe(false);
  });

  it("formats stable organization and department ownership labels", () => {
    expect(
      getContentOwnershipLabel({
        ownership: {
          scope: "ORGANIZATION",
          department_id: null,
          department_name: null,
          creator: { id: "admin-1", display_name: "Admin", status: "ACTIVE" },
        },
      })
    ).toBe("Organization owned");
    expect(
      getContentOwnershipLabel({
        ownership: {
          scope: "DEPARTMENT",
          department_id: "dept-a",
          department_name: "Marketing",
          creator: { id: "creator-1", display_name: "Former User", status: "DELETED" },
        },
      })
    ).toBe("Marketing owned");
  });

  it("formats non-active creator attribution without exposing email", () => {
    expect(
      getContentCreatorLabel({
        ownership: {
          scope: "DEPARTMENT",
          department_id: "dept-a",
          department_name: "Marketing",
          creator: { id: "creator-1", display_name: "Former User", status: "DELETED" },
        },
      }),
    ).toBe("Created by Former User (Deleted)");
    expect(
      getContentCreatorLabel({
        ownership: {
          scope: "ORGANIZATION",
          department_id: null,
          department_name: null,
          creator: { id: "creator-2", display_name: "Paused User", status: "INACTIVE" },
        },
      }),
    ).toBe("Created by Paused User (Inactive)");
    expect(
      getContentCreatorLabel({
        ownership: {
          scope: "RESTRICTED",
          department_id: null,
          department_name: null,
          creator: { id: null, display_name: "Unknown user", status: "UNKNOWN" },
        },
      }),
    ).toBe("Creator unknown");
    expect(
      getContentCreatorLabel({
        ownership: {
          scope: "ORGANIZATION",
          department_id: null,
          department_name: null,
          creator: { id: "creator-3", display_name: "Active User", status: "ACTIVE" },
        },
      }),
    ).toBeNull();
  });
});
