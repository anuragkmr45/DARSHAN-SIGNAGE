import { eq, and, sql, desc, or, getTableColumns, inArray, isNull } from 'drizzle-orm';
import { getDatabase, schema } from '@/db';
import { lockUserAndAssertSuperAdminSurvives } from '@/auth/super-admin-invariant';
import {
  assertPrimaryDepartmentExists,
  getUserDepartments,
  replaceAdditionalDepartments,
  userInAnyDepartmentCondition,
  userInDepartmentCondition,
} from '@/db/repositories/user-departments';
import { AppError } from '@/utils/app-error';

type UserDirectoryVisibility = {
  actorUserId: string;
  actorDepartmentId?: string | null;
  actorDepartmentIds?: string[];
  global: boolean;
};

export class UserRepository {
  private async countRows(
    tableSql: string,
    columnSql: string,
    value: string
  ): Promise<number> {
    const db = getDatabase();
    const result = await db.execute(
      sql`SELECT count(*)::int AS count FROM ${sql.raw(tableSql)} WHERE ${sql.raw(columnSql)} = ${value}`
    );

    return Number((result as { rows?: Array<{ count?: number | string }> }).rows?.[0]?.count ?? 0);
  }

  async create(data: {
    email: string;
    password_hash: string;
    first_name?: string;
    last_name?: string;
    role_id: string;
    department_id?: string;
    additional_department_ids?: string[];
    assigned_by?: string;
  }) {
    const db = getDatabase();
    return db.transaction(async (tx) => {
      const { additional_department_ids = [], assigned_by, ...userData } = data;
      await assertPrimaryDepartmentExists(userData.department_id, tx);
      const [role] = await tx.select({ name: schema.roles.name })
        .from(schema.roles).where(eq(schema.roles.id, userData.role_id));
      if (!role) throw AppError.notFound('Role not found');
      const [user] = await tx.insert(schema.users).values(userData).returning();
      await replaceAdditionalDepartments(tx, {
        userId: user.id,
        primaryDepartmentId: user.department_id,
        roleName: role.name,
        additionalDepartmentIds: additional_department_ids,
        assignedBy: assigned_by,
      });
      return user;
    });
  }

  async findById(id: string) {
    const db = getDatabase();
    const result = await db.select().from(schema.users).where(eq(schema.users.id, id));
    return result[0] || null;
  }

  async findByInviteToken(token: string) {
    const normalizedToken = token.trim().toLowerCase();
    const db = getDatabase();
    const result = await db
      .select()
      .from(schema.users)
      .where(and(sql`LOWER(ext->>'invite_token') = ${normalizedToken}`, isNull(schema.users.deleted_at)));
    return (result as any)[0] || null;
  }

  async listInvites(options: {
    page?: number;
    limit?: number;
    statuses?: ('pending' | 'expired' | 'activated')[];
    invited_before?: Date;
    invited_after?: Date;
    email?: string;
    role_id?: string;
    department_id?: string;
    visibility?: UserDirectoryVisibility;
  }) {
    const db = getDatabase();
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const offset = (page - 1) * limit;
    const nowIso = new Date().toISOString();

    const conditions: any[] = [isNull(schema.users.deleted_at)];

    // Only users that have invite metadata
    conditions.push(
      sql`${schema.users.ext} IS NOT NULL AND (${schema.users.ext} ? 'invite_token' OR ${schema.users.ext} ? 'invite_status' OR ${schema.users.ext} ? 'invite_expires_at' OR ${schema.users.ext} ? 'invited_at')`
    );

    if (options.email) {
      conditions.push(sql`LOWER(${schema.users.email}) LIKE ${'%' + options.email.toLowerCase() + '%'}`);
    }
    if (options.role_id) {
      conditions.push(eq(schema.users.role_id, options.role_id));
    }
    if (options.department_id) {
      conditions.push(userInDepartmentCondition(options.department_id));
    }
    if (options.visibility && !options.visibility.global) {
      conditions.push(eq(schema.users.is_active, true));
      conditions.push(
        (options.visibility.actorDepartmentIds?.length || options.visibility.actorDepartmentId)
          ? userInAnyDepartmentCondition(
              options.visibility.actorDepartmentIds ?? [options.visibility.actorDepartmentId!]
            )
          : eq(schema.users.id, options.visibility.actorUserId)
      );
    }
    const invitedAtExpr = sql`COALESCE((${schema.users.ext}->>'invited_at')::timestamptz, ${schema.users.created_at})`;
    if (options.invited_before) {
      conditions.push(sql`${invitedAtExpr} <= ${options.invited_before}`);
    }
    if (options.invited_after) {
      conditions.push(sql`${invitedAtExpr} >= ${options.invited_after}`);
    }

    if (options.statuses && options.statuses.length > 0) {
      const statusConds = options.statuses.map((status) => {
        switch (status) {
          case 'pending':
            return sql`(ext->>'invite_token') IS NOT NULL AND (ext->>'invite_expires_at')::timestamptz > ${nowIso}`;
          case 'expired':
            return sql`(ext->>'invite_token') IS NOT NULL AND (ext->>'invite_expires_at')::timestamptz <= ${nowIso}`;
          case 'activated':
            return sql`COALESCE(ext->>'invite_status', '') = 'ACTIVATED'`;
          default:
            return null;
        }
      }).filter(Boolean) as any[];

      if (statusConds.length > 0) {
        conditions.push(or(...statusConds));
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await db
      .select({
        ...getTableColumns(schema.users),
        role: schema.roles.name,
      })
      .from(schema.users)
      .leftJoin(schema.roles, eq(schema.users.role_id, schema.roles.id))
      .where(whereClause)
      .orderBy(desc(schema.users.created_at))
      .limit(limit)
      .offset(offset);

    const totalRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.users)
      .where(whereClause);

    const total = totalRows.length > 0 ? Number((totalRows[0] as any).count) : 0;

    return {
      items,
      total,
      page,
      limit,
    };
  }

  async listPendingInvites() {
    const result = await this.listInvites({ statuses: ['pending'], page: 1, limit: 1000 });
    return result.items;
  }

  async findByEmail(email: string) {
    const db = getDatabase();
    const result = await db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.email, email), isNull(schema.users.deleted_at)));
    return result[0] || null;
  }

  async list(options: {
    page?: number;
    limit?: number;
    role?: string;
    role_id?: string;
    department_id?: string;
    is_active?: boolean;
    search?: string;
    visibility?: UserDirectoryVisibility;
  }) {
    const db = getDatabase();
    const page = options.page || 1;
    const limit = options.limit || 20;
    const offset = (page - 1) * limit;

    const conditions = [isNull(schema.users.deleted_at)];
    if (options.role?.trim()) {
      conditions.push(sql`LOWER(${schema.roles.name}) = ${options.role.trim().toLowerCase()}`);
    }
    if (options.role_id) {
      conditions.push(eq(schema.users.role_id, options.role_id as any));
    }
    if (options.department_id) {
      conditions.push(userInDepartmentCondition(options.department_id));
    }
    if (options.is_active !== undefined) {
      conditions.push(eq(schema.users.is_active, options.is_active));
    }
    if (options.search?.trim()) {
      const escaped = options.search.trim().replace(/[!%_]/g, '!$&');
      const pattern = `%${escaped}%`;
      conditions.push(or(
        sql`${schema.users.email} ILIKE ${pattern} ESCAPE '!'`,
        sql`${schema.users.first_name} ILIKE ${pattern} ESCAPE '!'`,
        sql`${schema.users.last_name} ILIKE ${pattern} ESCAPE '!'`,
        sql`${schema.roles.name} ILIKE ${pattern} ESCAPE '!'`
      )!);
    }
    if (options.visibility && !options.visibility.global) {
      conditions.push(
        (options.visibility.actorDepartmentIds?.length || options.visibility.actorDepartmentId)
          ? userInAnyDepartmentCondition(
              options.visibility.actorDepartmentIds ?? [options.visibility.actorDepartmentId!]
            )
          : eq(schema.users.id, options.visibility.actorUserId)
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await db
      .select({
        ...getTableColumns(schema.users),
        role: schema.roles.name,
      })
      .from(schema.users)
      .leftJoin(schema.roles, eq(schema.users.role_id, schema.roles.id))
      .where(whereClause)
      .orderBy(desc(schema.users.created_at))
      .limit(limit)
      .offset(offset);

    const totalRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.users)
      .leftJoin(schema.roles, eq(schema.users.role_id, schema.roles.id))
      .where(whereClause);

    return {
      items,
      total: totalRows.length > 0 ? Number((totalRows[0] as any).count) : 0,
      page,
      limit,
    };
  }

  async update(
    id: string,
    data: Partial<typeof schema.users.$inferInsert>,
    options: { additionalDepartmentIds?: string[]; assignedBy?: string } = {}
  ) {
    const db = getDatabase();
    return db.transaction(async (tx) => {
      const current =
        data.is_active === false || data.role_id !== undefined
          ? await lockUserAndAssertSuperAdminSurvives(tx, id, {
              isActive: data.is_active,
              roleId: data.role_id,
            })
          : (
              await tx
                .select()
                .from(schema.users)
                .where(and(eq(schema.users.id, id), isNull(schema.users.deleted_at)))
                .for('update')
            )[0];
      if (!current || current.deleted_at) return null;

      const primaryDepartmentId = data.department_id !== undefined
        ? data.department_id ?? null
        : current.department_id;
      if (data.department_id !== undefined || options.additionalDepartmentIds !== undefined) {
        await assertPrimaryDepartmentExists(primaryDepartmentId, tx);
      }
      const roleId = data.role_id ?? current.role_id;
      const [role] = await tx.select({ name: schema.roles.name })
        .from(schema.roles).where(eq(schema.roles.id, roleId));
      if (!role) throw AppError.notFound('Role not found');
      const currentMembership = await getUserDepartments(id, tx);
      const additionalDepartmentIds = options.additionalDepartmentIds
        ?? currentMembership?.additionalDepartmentIds ?? [];
      if (
        options.additionalDepartmentIds === undefined &&
        data.department_id !== undefined &&
        additionalDepartmentIds.includes(primaryDepartmentId ?? '')
      ) {
        throw new AppError({
          statusCode: 409,
          code: 'PRIMARY_DEPARTMENT_CONFLICT',
          message: 'The new primary department is already additional. Submit an explicit additional department list.',
        });
      }
      if (role.name !== 'OPERATOR' && options.additionalDepartmentIds?.length) {
        throw new AppError({
          statusCode: 422,
          code: 'INVALID_DEPARTMENT_MEMBERSHIP',
          message: 'Additional departments are available only to operators.',
        });
      }

      const [user] = await tx
        .update(schema.users)
        .set({ ...data, updated_at: new Date() })
        .where(and(eq(schema.users.id, id), isNull(schema.users.deleted_at)))
        .returning();
      if (!user) return null;

      if (options.additionalDepartmentIds !== undefined || data.department_id !== undefined || data.role_id !== undefined) {
        await replaceAdditionalDepartments(tx, {
          userId: id,
          primaryDepartmentId,
          roleName: role.name,
          additionalDepartmentIds: role.name === 'OPERATOR' ? additionalDepartmentIds : [],
          assignedBy: options.assignedBy,
        });
      }

      await tx.delete(schema.sessions).where(eq(schema.sessions.user_id, id));
      return user;
    });
  }

  async tombstone(id: string, deletedBy: string, invalidPasswordHash: string) {
    const db = getDatabase();
    return db.transaction(async (tx) => {
      const current = await lockUserAndAssertSuperAdminSurvives(tx, id, { deleting: true });
      if (!current) return null;
      if (current.deleted_at) {
        return { user: current, alreadyDeleted: true, abortedUploads: [], failedMedia: [] };
      }

      const now = new Date();
      const abortedUploads = await tx
        .update(schema.mediaUploadSessions)
        .set({
          state: 'ABORTED',
          aborted_at: now,
          expires_at: now,
          failure_reason: 'USER_DELETED_CLEANUP_PENDING',
          updated_at: now,
        })
        .where(
          and(
            eq(schema.mediaUploadSessions.created_by, id),
            inArray(schema.mediaUploadSessions.state, ['INITIALIZING', 'ACTIVE', 'FINALIZING'])
          )
        )
        .returning();

      const failedMedia = await tx
        .select()
        .from(schema.media)
        .where(
          and(
            eq(schema.media.created_by, id),
            inArray(schema.media.status, ['PENDING', 'PROCESSING'])
          )
        )
        .for('update');
      if (failedMedia.length > 0) {
        await tx
          .update(schema.media)
          .set({ status: 'FAILED', status_reason: 'USER_DELETED_CLEANUP_PENDING', updated_at: now })
          .where(inArray(schema.media.id, failedMedia.map((media) => media.id)));
      }

      await tx.delete(schema.sessions).where(eq(schema.sessions.user_id, id));
      await tx.delete(schema.userAdditionalDepartments)
        .where(eq(schema.userAdditionalDepartments.user_id, id));

      const [user] = await tx
        .update(schema.users)
        .set({
          email: `deleted+${id}@deleted.invalid`,
          password_hash: invalidPasswordHash,
          is_active: false,
          deleted_at: now,
          deleted_by: deletedBy,
          ext: null,
          updated_at: now,
        })
        .where(and(eq(schema.users.id, id), isNull(schema.users.deleted_at)))
        .returning();

      await tx.insert(schema.auditLogs).values({
        user_id: deletedBy,
        action: 'USER_DELETED',
        entity_type: 'USER',
        entity_id: id,
        created_at: now,
      });

      return { user, alreadyDeleted: false, abortedUploads, failedMedia };
    });
  }

  async getDeleteUsageSummary(id: string) {
    const db = getDatabase();
    const referencesResult = await db.execute(sql.raw(`
      SELECT DISTINCT
        nsp.nspname AS schema_name,
        rel.relname AS table_name,
        att.attname AS column_name
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      JOIN unnest(con.conkey) AS cols(attnum) ON TRUE
      JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = cols.attnum
      WHERE con.contype = 'f'
        AND con.confrelid = 'users'::regclass
        AND con.confdeltype <> 'c'
        AND nsp.nspname = current_schema()
    `));

    const labels: Record<string, string> = {
      chat_bookmarks: 'chat bookmarks',
      chat_conversations: 'chat conversations',
      chat_members: 'chat memberships',
      chat_message_revisions: 'chat message revisions',
      chat_messages: 'chat messages',
      chat_moderation: 'chat moderation records',
      chat_pins: 'chat pins',
      chat_reactions: 'chat reactions',
      chat_receipts: 'chat read receipts',
    };

    const references = (referencesResult as {
      rows?: Array<{ schema_name?: string; table_name?: string; column_name?: string }>;
    }).rows ?? [];

    const resolved = await Promise.all(
      references.map(async (reference) => {
        if (!reference.schema_name || !reference.table_name || !reference.column_name) {
          return null;
        }

        const count = await this.countRows(
          `"${reference.schema_name.replace(/"/g, '""')}"."${reference.table_name.replace(/"/g, '""')}"`,
          `"${reference.column_name.replace(/"/g, '""')}"`,
          id
        );

        if (count <= 0) {
          return null;
        }

        return {
          key: reference.table_name,
          label: labels[reference.table_name] ?? reference.table_name.replace(/_/g, ' '),
          count,
        };
      })
    );

    const matchedReferences = resolved.filter(
      (reference): reference is { key: string; label: string; count: number } => reference !== null
    );

    return {
      inUse: matchedReferences.length > 0,
      primaryReason: matchedReferences[0]?.key ?? null,
      references: matchedReferences,
    };
  }
}

export function createUserRepository(): UserRepository {
  return new UserRepository();
}
