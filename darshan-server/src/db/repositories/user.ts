import { eq, and, sql, desc, asc, or, getTableColumns, inArray, isNull, type SQL } from 'drizzle-orm';
import { getDatabase, schema, type DbExecutor } from '@/db';
import { lockUserAndAssertSuperAdminSurvives } from '@/auth/super-admin-invariant';
import { CANONICAL_INVITE_EXPIRY_PATTERN, CANONICAL_INVITE_TOKEN_PATTERN, parseInviteToken } from '@/auth/invite-state';
import { directorySignInEligiblePredicate } from '@/rbac/user-directory';

export type UserDirectoryVisibility = {
  actorUserId: string;
  actorDepartmentId?: string | null;
  global: boolean;
  readPredicate?: ReturnType<typeof sql>;
};

function scopedDirectoryPredicates(visibility: UserDirectoryVisibility): SQL[] {
  return [
    eq(schema.users.is_active, true),
    visibility.readPredicate ?? sql`false`,
    visibility.actorDepartmentId
      ? eq(schema.users.department_id, visibility.actorDepartmentId)
      : eq(schema.users.id, visibility.actorUserId),
  ];
}

/** Pending invitation records belong in the invitation workflow, not the people directory. */
export function scopedPeopleDirectoryPredicates(visibility: UserDirectoryVisibility): SQL[] {
  const [active, ...scoped] = scopedDirectoryPredicates(visibility);
  return [active, directorySignInEligiblePredicate(), ...scoped];
}

/** Invitation managers retain pending and expired records within their permitted scope. */
export function scopedInvitationDirectoryPredicates(visibility: UserDirectoryVisibility): SQL[] {
  return scopedDirectoryPredicates(visibility);
}

export function inviteStatusPredicate(status: 'pending' | 'expired' | 'activated', nowIso: string): SQL {
  const inviteToken = sql`${schema.users.ext}->>'invite_token'`;
  const inviteExpiry = sql`${schema.users.ext}->>'invite_expires_at'`;
  const inviteStatus = sql`${schema.users.ext}->>'invite_status'`;
  const recoverable = sql`((${inviteStatus}) IN ('PENDING', 'EXPIRED') OR ((${inviteStatus}) IS NULL AND (${inviteToken}) IS NOT NULL))`;
  const canonicalToken = sql`(${inviteToken}) ~ ${CANONICAL_INVITE_TOKEN_PATTERN}`;
  // App-written expiries use Date#toISOString, whose fixed-width UTC form
  // sorts chronologically as text. Avoid casting legacy JSON: one malformed
  // value must not turn the complete invitation directory into a 500.
  const canonicalExpiry = sql`(${inviteExpiry}) ~ ${CANONICAL_INVITE_EXPIRY_PATTERN}`;
  if (status === 'pending') {
    return sql`${recoverable} AND ${canonicalToken} AND ${canonicalExpiry} AND (${inviteExpiry}) > ${nowIso}`;
  }
  if (status === 'expired') {
    return sql`${recoverable} AND (((${inviteToken}) IS NULL) OR NOT (${canonicalToken}) OR ((${inviteExpiry}) IS NULL) OR NOT (${canonicalExpiry}) OR (${inviteExpiry}) <= ${nowIso})`;
  }
  return sql`COALESCE(${schema.users.ext}->>'invite_status', '') = 'ACTIVATED'`;
}

/**
 * Legacy JSON may contain arbitrary text. PostgreSQL timestamp casts throw on
 * malformed input, so validate the exact app-written UTC format first and use
 * the row creation time when invitation history is incomplete or corrupt.
 */
export function inviteInvitedAtExpression(): SQL {
  const invitedAt = sql`${schema.users.ext}->>'invited_at'`;
  return sql`CASE WHEN (${invitedAt}) ~ ${CANONICAL_INVITE_EXPIRY_PATTERN} THEN (${invitedAt})::timestamptz ELSE ${schema.users.created_at} END`;
}

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
  }, executor: DbExecutor = getDatabase()) {
    const db = executor;
    const result = await db.insert(schema.users).values(data).returning();
    return result[0];
  }

  async findById(id: string) {
    const db = getDatabase();
    const result = await db.select().from(schema.users).where(eq(schema.users.id, id));
    return result[0] || null;
  }

  async findByInviteToken(token: string) {
    const normalizedToken = parseInviteToken(token);
    if (!normalizedToken) return null;
    const db = getDatabase();
    const result = await db
      .select()
      .from(schema.users)
      .where(and(sql`LOWER(ext->>'invite_token') = ${normalizedToken}`, isNull(schema.users.deleted_at)));
    // A token is a public bearer credential. Ambiguous legacy/corrupt matches
    // must fail closed instead of activating whichever row the database emits first.
    return result.length === 1 ? result[0] : null;
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
      conditions.push(eq(schema.users.department_id, options.department_id));
    }
    if (options.visibility && !options.visibility.global) {
      conditions.push(...scopedInvitationDirectoryPredicates(options.visibility));
    }
    const invitedAtExpr = inviteInvitedAtExpression();
    if (options.invited_before) {
      conditions.push(sql`${invitedAtExpr} <= ${options.invited_before}`);
    }
    if (options.invited_after) {
      conditions.push(sql`${invitedAtExpr} >= ${options.invited_after}`);
    }

    if (options.statuses && options.statuses.length > 0) {
      const statusConds = options.statuses.map((status) => inviteStatusPredicate(status, nowIso));

      if (statusConds.length > 0) {
        conditions.push(or(...statusConds));
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await db
      .select({
        ...getTableColumns(schema.users),
        role: schema.roles.name,
        role_is_system: schema.roles.is_system,
      })
      .from(schema.users)
      .leftJoin(schema.roles, eq(schema.users.role_id, schema.roles.id))
      .where(whereClause)
      .orderBy(desc(schema.users.created_at), asc(schema.users.id))
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
      conditions.push(eq(schema.users.department_id, options.department_id));
    }
    if (options.is_active !== undefined) {
      conditions.push(eq(schema.users.is_active, options.is_active));
    }
    if (options.visibility && !options.visibility.global) {
      conditions.push(...scopedPeopleDirectoryPredicates(options.visibility));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await db
      .select({
        ...getTableColumns(schema.users),
        role: schema.roles.name,
        role_is_system: schema.roles.is_system,
      })
      .from(schema.users)
      .leftJoin(schema.roles, eq(schema.users.role_id, schema.roles.id))
      .where(whereClause)
      .orderBy(desc(schema.users.created_at), asc(schema.users.id))
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

  async update(id: string, data: Partial<typeof schema.users.$inferInsert>, executor?: DbExecutor) {
    const db = getDatabase();
    const updateInTransaction = async (tx: DbExecutor) => {
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

      const [user] = await tx
        .update(schema.users)
        .set({ ...data, updated_at: new Date() })
        .where(and(eq(schema.users.id, id), isNull(schema.users.deleted_at)))
        .returning();
      if (!user) return null;

      await tx.delete(schema.sessions).where(eq(schema.sessions.user_id, id));
      return user;
    };
    return executor ? updateInTransaction(executor) : db.transaction(updateInTransaction);
  }

  async tombstone(id: string, deletedBy: string, invalidPasswordHash: string, executor?: DbExecutor) {
    const db = getDatabase();
    const tombstoneInTransaction = async (tx: DbExecutor) => {
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
    };
    return executor ? tombstoneInTransaction(executor) : db.transaction(tombstoneInTransaction);
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
