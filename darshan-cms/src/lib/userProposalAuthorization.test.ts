import { describe, expect, it, vi } from "vitest";
import { createMongoAbility, subject } from "@casl/ability";
import {
  canSubmitUserMutation,
  isManagementDepartmentSelectionValid,
} from "./userProposalAuthorization";

describe("canSubmitUserMutation", () => {
  it("checks the proposed record for create", () => {
    const proposed = { department_id: "dept-a", role_id: "operator" };
    const canRecord = vi.fn((_action, _resource, record) => record === proposed);

    expect(canSubmitUserMutation(canRecord, "create", null, proposed)).toBe(true);
    expect(canRecord).toHaveBeenCalledOnce();
    expect(canRecord).toHaveBeenCalledWith("create", "User", proposed);
  });

  it("requires both stored and proposed records for update", () => {
    const current = { id: "user-a", department_id: "dept-a" };
    const proposed = { ...current, department_id: "dept-b" };
    const ability = createMongoAbility([
      { action: "update", subject: "User", conditions: { department_id: "dept-a" } },
    ]);
    const canRecord = vi.fn((action: string, resource: string, record: object) =>
      ability.can(action, subject(resource, record)));

    expect(canSubmitUserMutation(canRecord, "update", current, proposed)).toBe(false);
    expect(canRecord).toHaveBeenCalledTimes(2);
  });

  it("fails closed when update has no current record", () => {
    const canRecord = vi.fn(() => true);

    expect(canSubmitUserMutation(canRecord, "update", null, { id: "user-a" })).toBe(false);
    expect(canRecord).not.toHaveBeenCalled();
  });
});

describe("isManagementDepartmentSelectionValid", () => {
  const departments = [{ id: "dept-a" }, { id: "dept-b" }];

  it("allows a global manager to select a current option or no department", () => {
    expect(isManagementDepartmentSelectionValid(true, "dept-b", departments)).toBe(true);
    expect(isManagementDepartmentSelectionValid(true, "", departments)).toBe(true);
    expect(isManagementDepartmentSelectionValid(true, undefined, departments)).toBe(true);
  });

  it("rejects an arbitrary or stale department for a global manager", () => {
    expect(isManagementDepartmentSelectionValid(true, "dept-removed", departments)).toBe(false);
  });

  it("requires a scoped manager to use a returned department option", () => {
    expect(isManagementDepartmentSelectionValid(false, "dept-a", departments)).toBe(true);
    expect(isManagementDepartmentSelectionValid(false, "dept-removed", departments)).toBe(false);
    expect(isManagementDepartmentSelectionValid(false, "", departments)).toBe(false);
  });
});
