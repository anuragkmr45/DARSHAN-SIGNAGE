import { describe, expect, test } from "vitest";
import { canWithGrants, isSystemAdminRoleName, resolveEffectiveGrants } from "./authorization";
import type { Role } from "@/api/types";

describe("authorization helpers", () => {
  test("treats ADMIN and SUPER_ADMIN as system admins", () => {
    expect(isSystemAdminRoleName("ADMIN")).toBe(true);
    expect(isSystemAdminRoleName("SUPER_ADMIN")).toBe(true);
    expect(isSystemAdminRoleName("OPERATOR")).toBe(false);
    expect(isSystemAdminRoleName(undefined)).toBe(false);
  });

  test("resolves inherited grants", () => {
    const roles: Role[] = [
      {
        id: "viewer-role",
        name: "VIEWER",
        description: null,
        is_system: true,
        created_at: "",
        updated_at: "",
        permissions: {
          inherits: [],
          grants: [{ action: "read", subject: "Screen" }],
        },
      },
      {
        id: "admin-role",
        name: "ADMIN",
        description: null,
        is_system: true,
        created_at: "",
        updated_at: "",
        permissions: {
          inherits: ["viewer-role"],
          grants: [{ action: "manage", subject: "all" }],
        },
      },
    ];

    const grants = resolveEffectiveGrants("admin-role", roles);
    expect(canWithGrants(grants, "manage", "all")).toBe(true);
    expect(canWithGrants(grants, "read", "Screen")).toBe(true);
  });
});
