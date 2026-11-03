import { and, asc, eq, inArray } from 'drizzle-orm';
import type { JWTPayload } from '@/auth/jwt';
import { getDatabase, schema, type DbExecutor } from '@/db';
import { defineAbilityFor, type AppAbility } from '@/rbac';
import type { ActorContext } from '@/rbac/policy';
import { AppError } from '@/utils/app-error';
import { getUserDepartments } from '@/db/repositories/user-departments';

export type MutationAuthorizationContext = {
  actor: ActorContext;
  ability: AppAbility;
  executor: DbExecutor;
};

/**
 * Serializes an ownership-sensitive write against user changes.
 *
 * User update/tombstone transactions lock the user row before removing its
 * sessions. Taking the same lock order here means exactly one side wins:
 * either this write completes first, or the committed account change removes
 * the session and this write is rejected before mutating content.
 */
export async function withCurrentMutationAuthorization<T>(
  payload: Pick<JWTPayload, 'sub' | 'jti'>,
  execute: (context: MutationAuthorizationContext) => Promise<T>,
  options: {
    roleLock?: 'share' | 'update';
    additionalUserIdsToLock?: string[];
    /** Only for callbacks that read, and never update, the locked user records. */
    userLock?: 'share' | 'update';
  } = {}
): Promise<T> {
  return getDatabase().transaction(async (tx) => {
    // Effective grants may be inherited through any role in the graph. Lock
    // the graph before user/session state so a role edit either commits and
    // revokes affected sessions first, or waits until this authorized write
    // commits. RoleRepository.update uses the same role-first lock order.
    const roles = await tx
      .select({ id: schema.roles.id, name: schema.roles.name })
      .from(schema.roles)
      .orderBy(asc(schema.roles.id))
      .for(options.roleLock ?? 'share');

    // Cross-user author/presenter checks acquire one ordered set, avoiding
    // opposite A→B/B→A row-lock order. Shared identity locks also remain
    // compatible with foreign-key KEY SHARE checks on an assignment's creator.
    const actorId = payload.sub.toLowerCase();
    const identityIds = [...new Set([actorId, ...(options.additionalUserIdsToLock ?? []).map((id) => id.toLowerCase())])];
    const users = await tx
      .select({
        id: schema.users.id,
        role_id: schema.users.role_id,
        department_id: schema.users.department_id,
        is_active: schema.users.is_active,
        deleted_at: schema.users.deleted_at,
      })
      .from(schema.users)
      .where(inArray(schema.users.id, identityIds))
      .orderBy(asc(schema.users.id))
      .for(options.userLock ?? 'update');
    const user = users.find((candidate) => candidate.id.toLowerCase() === actorId);

    if (!user || !user.is_active || user.deleted_at) {
      throw AppError.unauthorized('Authorization context is no longer active. Please sign in again.');
    }

    const memberships = await getUserDepartments(user.id, tx);
    const [session] = await tx
      .select({
        user_id: schema.sessions.user_id,
        expires_at: schema.sessions.expires_at,
      })
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.access_jti, payload.jti),
          eq(schema.sessions.user_id, user.id)
        )
      )
      .for('update');

    if (!session || session.expires_at.getTime() <= Date.now()) {
      throw AppError.unauthorized('Token has been revoked');
    }

    const role = roles.find((candidate) => candidate.id === user.role_id);
    if (!role) {
      throw AppError.unauthorized('Authorization context is stale. Please sign in again.');
    }

    const actor: ActorContext = {
      userId: user.id,
      roleName: role.name,
      departmentId: user.department_id,
      departmentIds: memberships?.departmentIds ?? (user.department_id ? [user.department_id] : []),
    };
    const ability = await defineAbilityFor(role.id, user.id, user.department_id ?? undefined);
    return execute({ actor, ability, executor: tx });
  });
}
