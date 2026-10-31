import { describe, expect, it } from "vitest";
import {
  canConfirmScreenPairing,
  canAccessModule,
  canDeleteLayoutRecord,
  canDeleteMediaRecord,
  canManageLayoutRecord,
  canStartScreenRecovery,
  canUseSubjectWidePermission,
  getContentCreatorLabel,
  getContentOwnershipLabel,
} from "@/lib/access";
import { createMongoAbility, subject } from "@casl/ability";
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
  it("checks concrete current and proposed Screen records for pairing and recovery", () => {
    const ability = createMongoAbility([
      { action: "update", subject: "Screen", conditions: { id: "screen-a", location: "Lobby" } },
      { action: "create", subject: "DevicePairing", conditions: { screen_id: "screen-a" } },
      { action: "create", subject: "Screen", conditions: { location: "Lobby" } },
    ]);
    const canRecord = (action: string, resource: string, record: object) =>
      ability.can(action, subject(resource, record));
    const current = { id: "screen-a", location: "Lobby" };

    expect(canStartScreenRecovery(canRecord, current)).toBe(true);
    expect(canStartScreenRecovery(canRecord, { id: "screen-b", location: "Lobby" })).toBe(false);
    expect(canConfirmScreenPairing(canRecord, current, current)).toBe(true);
    expect(canConfirmScreenPairing(
      canRecord,
      { id: "screen-a", location: "Other" },
      current,
    )).toBe(false);
    expect(canConfirmScreenPairing(canRecord, { name: "New", location: "Lobby" })).toBe(true);
    expect(canConfirmScreenPairing(canRecord, { name: "New", location: "Other" })).toBe(false);
  });

  it("does not treat a conditional grant as permission to use subject-wide resources", () => {
    expect(canUseSubjectWidePermission([
      { action: "update", subject: "OrgSettings", conditions: { id: "only-one" } },
    ], "update", "OrgSettings")).toBe(false);
    expect(canUseSubjectWidePermission([
      { action: "update", subject: "BrandingSettings", conditions: { id: "only-one" } },
    ], "update", "BrandingSettings")).toBe(false);
    expect(canUseSubjectWidePermission([
      { action: "read", subject: "SsoConfig", conditions: { id: "only-one" } },
    ], "read", "SsoConfig")).toBe(false);
    expect(canUseSubjectWidePermission([
      { action: "update", subject: "SsoConfig", conditions: { id: "only-one" } },
    ], "update", "SsoConfig")).toBe(false);
    for (const resource of ["Dashboard", "Report", "AuditLog", "ProofOfPlay"] as const) {
      expect(canUseSubjectWidePermission([
        { action: "read", subject: resource, conditions: { id: "only-one" } },
      ], "read", resource)).toBe(false);
      expect(canUseSubjectWidePermission([
        { action: "read", subject: resource },
      ], "read", resource)).toBe(true);
    }
    expect(canUseSubjectWidePermission([
      { action: "manage", subject: "Emergency", conditions: { id: "only-one" } },
    ], "manage", "Emergency")).toBe(false);
    expect(canUseSubjectWidePermission([
      { action: "manage", subject: "Emergency" },
    ], "manage", "Emergency")).toBe(true);
    expect(canUseSubjectWidePermission([
      { action: "read", subject: "Backup", conditions: { id: "one-run" } },
    ], "read", "Backup")).toBe(false);
    expect(canUseSubjectWidePermission([
      { action: "read", subject: "Backup" },
    ], "read", "Backup")).toBe(true);
    expect(canUseSubjectWidePermission([
      { action: "manage", subject: "all" },
    ], "update", "OrgSettings")).toBe(true);
    expect(canUseSubjectWidePermission([
      { action: "manage", subject: "all" },
    ], "update", "SsoConfig")).toBe(true);
    expect(canUseSubjectWidePermission([
      { action: "manage", subject: "all" },
    ], "read", "Report")).toBe(true);
    expect(canUseSubjectWidePermission([
      { action: "manage", subject: "all" },
      { action: "manage", subject: "BrandingSettings", inverted: true },
      { action: "update", subject: "BrandingSettings" },
    ], "update", "BrandingSettings")).toBe(true);
  });

  it("allows a backup-only role to reach settings without granting other settings access", () => {
    const rules = [{ action: "read", subject: "Backup" }];
    const ability = createMongoAbility(rules);
    const can = (action: string, resource: string) => canUseSubjectWidePermission(
      rules,
      action,
      resource as "Backup" | "OrgSettings" | "BrandingSettings",
    ) || ability.can(action, resource);
    expect(canAccessModule("settings", null, can)).toBe(true);
    expect(can("read", "OrgSettings")).toBe(false);
    expect(can("read", "AuditLog")).toBe(false);
    expect(can("update", "OrgSettings")).toBe(false);
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
