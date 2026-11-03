export const ADMIN_TEST_USER_ID = "00000000-0000-4000-8000-000000000001";
export const ADMIN_TEST_ROLE_ID = "00000000-0000-4000-8000-000000000002";
export const OPERATOR_TEST_ROLE_ID = "00000000-0000-4000-8000-000000000003";

export type TestCapability = { action: string; subject: string };
type TestUser = { id: string; role: string; department_id?: string | null };

const actions = ["create", "read", "update", "delete", "manage", "approve", "publish"];
const adminSubjects = [
  "User", "Department", "Media", "Layout", "Presentation", "Schedule", "ScheduleItem",
  "ScheduleRequest", "LiveBroadcast", "Screen", "ScreenGroup", "Notification", "AuditLog",
  "DevicePairing", "Emergency", "EmergencyType", "ApiKey", "Webhook", "SsoConfig",
  "OrgSettings", "Conversation", "ProofOfPlay", "Dashboard", "Report", "Role", "all",
];

export const adminCapabilities: TestCapability[] = actions.flatMap((action) =>
  adminSubjects.map((subject) => ({ action, subject })),
);

export function testAuthorization(
  user: TestUser,
  capabilities: TestCapability[],
  options: { roleId?: string; departmentId?: string | null; departmentIds?: string[] } = {},
) {
  const departmentId = options.departmentId ?? null;
  return {
    version: 1 as const,
    user_id: user.id,
    role: {
      id: options.roleId ?? (user.role === "OPERATOR" ? OPERATOR_TEST_ROLE_ID : ADMIN_TEST_ROLE_ID),
      name: user.role,
    },
    department_id: departmentId,
    department_ids: options.departmentIds ?? (departmentId ? [departmentId] : []),
    capabilities,
  };
}

export const adminAuthorization = (user: TestUser) => testAuthorization(user, adminCapabilities);
