import { and, eq, isNull } from 'drizzle-orm';
import { schema, type DbExecutor } from '@/db';
import { AppError } from '@/utils/app-error';
import { canAuthenticateInviteState } from '@/auth/invite-state';

export const LAST_ACTIVE_SUPER_ADMIN = 'LAST_ACTIVE_SUPER_ADMIN';

type ProtectedUserMutation = {
  isActive?: boolean;
  roleId?: string;
  deleting?: boolean;
};

/**
 * Locks the shared SUPER_ADMIN role row before the target user row. Every
 * removal path uses this order so concurrent changes to different accounts
 * cannot both observe themselves as safe to remove.
 */
export async function lockUserAndAssertSuperAdminSurvives(
  executor: DbExecutor,
  userId: string,
  mutation: ProtectedUserMutation
) {
  const [superAdminRole] = await executor
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(and(eq(schema.roles.name, 'SUPER_ADMIN'), eq(schema.roles.is_system, true)))
    .for('update');

  const [current] = await executor
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .for('update');

  if (!current || current.deleted_at || !superAdminRole) return current ?? null;

  const removesActiveSuperAdmin =
    current.role_id === superAdminRole.id &&
    current.is_active &&
    canAuthenticateInviteState(current.ext) &&
    (mutation.deleting === true ||
      mutation.isActive === false ||
      (mutation.roleId !== undefined && mutation.roleId !== superAdminRole.id));

  if (!removesActiveSuperAdmin) return current;

  const active = await executor
    .select({ ext: schema.users.ext })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.role_id, superAdminRole.id),
        eq(schema.users.is_active, true),
        isNull(schema.users.deleted_at)
      )
    );

  if (active.filter((candidate) => canAuthenticateInviteState(candidate.ext)).length <= 1) {
    throw new AppError({
      statusCode: 409,
      code: LAST_ACTIVE_SUPER_ADMIN,
      message: 'The last active SUPER_ADMIN cannot be deleted, disabled, or demoted.',
      details: { reason: LAST_ACTIVE_SUPER_ADMIN },
    });
  }

  return current;
}
