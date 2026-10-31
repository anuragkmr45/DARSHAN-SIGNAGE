export const PERMISSION_ACTIONS = ['create', 'read', 'update', 'delete', 'download', 'manage', 'approve', 'publish'] as const;
export const BACKUP_PERMISSION_ACTIONS = ['read', 'create', 'delete', 'download'] as const;

export const PERMISSION_SUBJECTS = [
  'User',
  'Department',
  'Media',
  'Layout',
  'Presentation',
  'Schedule',
  'ScheduleItem',
  'ScheduleRequest',
  'Screen',
  'ScreenGroup',
  'Notification',
  'AuditLog',
  'DevicePairing',
  'Emergency',
  'EmergencyType',
  'ApiKey',
  'Webhook',
  'SsoConfig',
  'OrgSettings',
  'BrandingSettings',
  'Backup',
  'Conversation',
  'ProofOfPlay',
  'Dashboard',
  'Report',
  'Role',
  'all',
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];
export type PermissionSubject = (typeof PERMISSION_SUBJECTS)[number] | string;

export type PermissionGrant = {
  action: PermissionAction;
  subject: PermissionSubject;
  conditions?: Record<string, string>;
};

export type RolePermissions = {
  inherits?: string[];
  grants: PermissionGrant[];
};

export type RoleRecord = {
  id: string;
  name: string;
  permissions: RolePermissions | null;
};
