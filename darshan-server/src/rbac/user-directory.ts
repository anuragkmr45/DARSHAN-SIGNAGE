import { subject } from '@casl/ability';
import type { AppAbility } from '@/rbac';

export type DirectoryActor = { userId: string; departmentId?: string | null };
export type DirectoryUser = {
  id: string;
  department_id?: string | null;
  is_active?: boolean | null;
  deleted_at?: Date | null;
  [key: string]: unknown;
};

export function canAccessDirectoryUser(
  actor: DirectoryActor,
  target: DirectoryUser,
  ability: AppAbility
): boolean {
  if (target.deleted_at) return false;
  if (ability.can('manage', 'User')) return true;
  if (target.is_active !== true) return false;
  if (!(ability as any).can('read', subject('User', target))) return false;
  if (target.id === actor.userId) return true;
  return Boolean(actor.departmentId && target.department_id === actor.departmentId);
}
