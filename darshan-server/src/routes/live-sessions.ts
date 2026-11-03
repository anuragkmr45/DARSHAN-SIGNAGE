import type { FastifyInstance, FastifyRequest } from 'fastify';
import { subject } from '@casl/ability';
import { rulesToQuery } from '@casl/ability/extra';
import { and, asc, desc, eq, ilike, inArray, isNull, not, or, sql, type SQL } from 'drizzle-orm';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { apiEndpoints } from '@/config/apiEndpoints';
import { withCurrentMutationAuthorization, type MutationAuthorizationContext } from '@/auth/mutation-authorization';
import { getDatabase, schema, type DbExecutor } from '@/db';
import { getUserDepartments } from '@/db/repositories/user-departments';
import type { Action, AppAbility } from '@/rbac';
import {
  canManageContentResource, canReadContentResource, contentResponseMetadata,
  ownershipForNewContent, resolveContentOwnershipViews, type ContentSubject,
} from '@/rbac/content-ownership';
import { createLiveSessionSchema, deleteLiveSessionSchema, listLiveSessionsSchema,
  liveSessionParamsSchema, updateLiveSessionSchema } from '@/schemas/live-broadcast';
import { AppError } from '@/utils/app-error';
import { respondWithError } from '@/utils/errors';

const sourceSubject: ContentSubject = 'LiveBroadcast';
const routeSchema = (description: string) => ({ schema: { description, tags: ['Live broadcasts'], security: [{ bearerAuth: [] }] } });
type LiveSession = typeof schema.liveSessions.$inferSelect;
const liveError = (statusCode: number, code: string, message: string, details?: Record<string, unknown>) =>
  new AppError({ statusCode, code, message, details });
const missing = () => liveError(404, 'LIVE_SESSION_NOT_FOUND', 'Live session not found.');
const revisionConflict = () => liveError(409, 'LIVE_SESSION_REVISION_CONFLICT', 'The live session changed. Reload it and try again.');

function boundAbility(ability: AppAbility, record: object) {
  return { can: (action: string) => ability.can(action as Action, subject(sourceSubject, record) as never) };
}

/** Conditions in permission grants are scalar string equalities. Unknown
 * fields fail closed; never use a type-name-only CASL test for record access. */
function permissionSql(ability: AppAbility, action: 'read' | 'manage'): SQL {
  const columns = {
    id: schema.liveSessions.id, name: schema.liveSessions.name, description: schema.liveSessions.description,
    presenter_user_id: schema.liveSessions.presenter_user_id, created_by: schema.liveSessions.created_by,
    owner_scope: schema.liveSessions.owner_scope, owner_department_id: schema.liveSessions.owner_department_id,
  };
  const query = rulesToQuery(ability, action, sourceSubject, rule => {
    const conditions = rule.conditions ?? {};
    const parts = Object.entries(conditions).map(([key, value]) => {
      const column = columns[key as keyof typeof columns];
      return column && typeof value === 'string' ? sql`${column}::text = ${value}` : sql`false`;
    });
    const expression = and(...parts) ?? sql`true`;
    return rule.inverted ? not(expression) : expression;
  });
  if (!query) return sql`false`;
  return and(...(query.$and ?? []), ...(query.$or ? [or(...query.$or)!] : [])) ?? sql`true`;
}

function canRead(context: MutationAuthorizationContext, row: LiveSession) {
  return canReadContentResource(context.actor, row, boundAbility(context.ability, row), sourceSubject);
}
function canMutate(context: MutationAuthorizationContext, row: LiveSession, action: 'update' | 'delete') {
  return canManageContentResource(context.actor, row, boundAbility(context.ability, row), sourceSubject, action);
}
async function serialize(row: LiveSession, context: MutationAuthorizationContext) {
  const ownership = (await resolveContentOwnershipViews([row])).get(row.id);
  return {
    id: row.id, name: row.name, description: row.description, presenter_user_id: row.presenter_user_id,
    microphone: row.microphone, screen_share_audio: row.screen_share_audio, is_active: row.is_active,
    revision: row.revision, policy_revision: row.policy_revision,
    owner_scope: row.owner_scope, owner_department_id: row.owner_department_id,
    ...contentResponseMetadata(row, ownership, context.actor, boundAbility(context.ability, row), sourceSubject),
    created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString(),
  };
}
async function payloadFor(request: FastifyRequest) {
  const token = extractTokenFromHeader(request.headers.authorization);
  if (!token) throw AppError.unauthorized('Missing authorization header');
  return verifyAccessToken(token);
}
async function currentRow(executor: DbExecutor, id: string, lock = false) {
  const query = executor.select().from(schema.liveSessions).where(and(eq(schema.liveSessions.id, id), isNull(schema.liveSessions.deleted_at)));
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw missing();
  return row;
}
async function validatePresenter(context: MutationAuthorizationContext, presenterId: string, owner: { owner_scope: string; owner_department_id: string | null }) {
  // The authorization helper already SHARE-locks this user in UUID order with
  // the actor. User disable/delete/transfer transactions cannot pass that lock.
  const [presenter] = await context.executor.select({ id: schema.users.id, is_active: schema.users.is_active, deleted_at: schema.users.deleted_at })
    .from(schema.users).innerJoin(schema.roles, eq(schema.roles.id, schema.users.role_id)).where(eq(schema.users.id, presenterId));
  const memberships = presenter ? await getUserDepartments(presenter.id, context.executor) : null;
  if (!presenter || !presenter.is_active || presenter.deleted_at ||
    (owner.owner_scope === 'DEPARTMENT' && !memberships?.departmentIds.includes(owner.owner_department_id!))) {
    throw liveError(422, 'LIVE_PRESENTER_UNAVAILABLE', 'Select an active presenter available to the live session owner.');
  }
}
async function audit(context: MutationAuthorizationContext, id: string, action: string, ip: string) {
  await context.executor.insert(schema.auditLogs).values({ user_id: context.actor.userId,
    action, entity_type: sourceSubject, entity_id: id, ip_address: ip });
}

async function assertNoReferences(executor: DbExecutor, id: string) {
  const drafts = await executor.select({ count: sql<number>`count(*)::int` }).from(schema.scheduleItems)
    .innerJoin(schema.schedules, eq(schema.schedules.id, schema.scheduleItems.schedule_id))
    .where(and(eq(schema.scheduleItems.live_session_id, id), sql`(
      (${schema.scheduleItems.end_at} > (now() AT TIME ZONE 'UTC') AND ${schema.schedules.end_at} > (now() AT TIME ZONE 'UTC'))
      OR NOT EXISTS (SELECT 1 FROM ${schema.publishes} WHERE ${schema.publishes.schedule_id} = ${schema.schedules.id})
    )`));
  // Mutable authoring rows may have been removed since publication. Inspect
  // the immutable current/future item windows too; historical-only items don't block.
  const published = await executor.select({ count: sql<number>`count(*)::int` }).from(schema.publishes)
    .innerJoin(schema.scheduleSnapshots, eq(schema.publishes.snapshot_id, schema.scheduleSnapshots.id))
    .where(and(eq(schema.publishes.status, 'ACTIVE'), sql`EXISTS (
      SELECT 1 FROM jsonb_array_elements(CASE
        WHEN jsonb_typeof(${schema.scheduleSnapshots.payload}->'schedule'->'items') = 'array'
        THEN ${schema.scheduleSnapshots.payload}->'schedule'->'items' ELSE '[]'::jsonb END) item
      WHERE item->>'live_session_id' = ${id}
        AND item->>'source_kind' = 'LIVE'
        AND (item->>'end_at')::timestamptz > now()
    )`));
  const blockers = { schedule_items: Number(drafts[0]?.count ?? 0), active_publishes: Number(published[0]?.count ?? 0) };
  if (Object.values(blockers).some(count => count > 0)) throw liveError(409, 'LIVE_SESSION_IN_USE',
    'Remove editable and current/future schedule references before deleting this live session.', { blockers });
}

export async function liveSessionRoutes(fastify: FastifyInstance) {
  fastify.post(apiEndpoints.liveSessions.create, routeSchema('Create a reusable live source policy'), async (request, reply) => {
    try {
      const payload = await payloadFor(request), data = createLiveSessionSchema.parse(request.body);
      const result = await withCurrentMutationAuthorization(payload, async context => {
        const unconditionalManage = context.ability.rulesFor('manage', sourceSubject)
          .some(rule => !rule.inverted && (!rule.conditions || Object.keys(rule.conditions).length === 0));
        const ownership = ownershipForNewContent(context.actor, { can: action => action === 'manage' && unconditionalManage }, sourceSubject);
        const record = { ...data, ...ownership, created_by: context.actor.userId, is_active: data.is_active ?? true,
          microphone: data.microphone ?? false, screen_share_audio: data.screen_share_audio ?? false };
        if (!context.ability.can('create', subject(sourceSubject, record) as never)) throw AppError.forbidden();
        await validatePresenter(context, data.presenter_user_id, ownership);
        const [row] = await context.executor.insert(schema.liveSessions).values(record).returning();
        await audit(context, row.id, 'LIVE_SESSION_CREATE', request.ip);
        return { row, context };
      }, { userLock: 'share', additionalUserIdsToLock: [data.presenter_user_id] });
      return reply.code(201).send(await serialize(result.row, result.context));
    } catch (error) { return respondWithError(reply, error); }
  });

  fastify.get(apiEndpoints.liveSessions.list, routeSchema('List readable live source policies'), async (request, reply) => {
    try {
      const payload = await payloadFor(request), query = listLiveSessionsSchema.parse(request.query);
      const result = await withCurrentMutationAuthorization(payload, async context => {
        if (!context.ability.can('read', sourceSubject)) throw AppError.forbidden();
        const departments = context.actor.departmentIds ?? [];
        const scope = or(permissionSql(context.ability, 'manage'), eq(schema.liveSessions.owner_scope, 'ORGANIZATION'),
          departments.length ? and(eq(schema.liveSessions.owner_scope, 'DEPARTMENT'), inArray(schema.liveSessions.owner_department_id, departments)) : sql`false`);
        const where = and(isNull(schema.liveSessions.deleted_at), permissionSql(context.ability, 'read'), scope,
          query.active_only === 'true' ? eq(schema.liveSessions.is_active, true) : undefined,
          query.search ? ilike(schema.liveSessions.name, `%${query.search.replace(/[\\%_]/g, '\\$&')}%`) : undefined);
        const [{ total }] = await context.executor.select({ total: sql<number>`count(*)::int` }).from(schema.liveSessions).where(where);
        const rows = await context.executor.select().from(schema.liveSessions).where(where)
          .orderBy(desc(schema.liveSessions.updated_at), asc(schema.liveSessions.id)).limit(query.limit).offset((query.page - 1) * query.limit);
        return { rows: rows.filter(row => canRead(context, row)), total: Number(total), context };
      }, { userLock: 'share' });
      return reply.send({ items: await Promise.all(result.rows.map(row => serialize(row, result.context))),
        pagination: { total: result.total, page: query.page, limit: query.limit, pages: Math.ceil(result.total / query.limit) } });
    } catch (error) { return respondWithError(reply, error); }
  });

  fastify.get(apiEndpoints.liveSessions.get, routeSchema('Read a live source policy'), async (request, reply) => {
    try {
      const payload = await payloadFor(request), { id } = liveSessionParamsSchema.parse(request.params);
      const result = await withCurrentMutationAuthorization(payload, async context => {
        const row = await currentRow(context.executor, id);
        if (!canRead(context, row)) throw AppError.forbidden();
        return { row, context };
      }, { userLock: 'share' });
      return reply.send(await serialize(result.row, result.context));
    } catch (error) { return respondWithError(reply, error); }
  });

  fastify.patch(apiEndpoints.liveSessions.update, routeSchema('Update a live source policy with optimistic concurrency'), async (request, reply) => {
    try {
      const payload = await payloadFor(request), { id } = liveSessionParamsSchema.parse(request.params);
      const { expected_revision, ...changes } = updateLiveSessionSchema.parse(request.body);
      // Activation may validate the previous assigned presenter. Lock that
      // observed identity alongside the requested one, then fence a changed row.
      const [observed] = await getDatabase().select({ presenter_user_id: schema.liveSessions.presenter_user_id })
        .from(schema.liveSessions).where(eq(schema.liveSessions.id, id));
      const presenterIds = [...new Set([...(observed ? [observed.presenter_user_id] : []), ...(changes.presenter_user_id ? [changes.presenter_user_id] : [])])];
      const result = await withCurrentMutationAuthorization(payload, async context => {
        const row = await currentRow(context.executor, id, true);
        if (!canMutate(context, row, 'update')) throw AppError.forbidden();
        if (row.revision !== expected_revision || !presenterIds.includes(row.presenter_user_id)) throw revisionConflict();
        const candidate = { ...row, ...changes };
        if (!canMutate(context, candidate, 'update')) throw AppError.forbidden();
        if (changes.presenter_user_id !== undefined || changes.is_active === true) await validatePresenter(context, candidate.presenter_user_id, candidate);
        const policyChanged = (['presenter_user_id', 'microphone', 'screen_share_audio', 'is_active'] as const).some(key => candidate[key] !== row[key]);
        const [updated] = await context.executor.update(schema.liveSessions).set({ ...changes, revision: row.revision + 1,
          policy_revision: row.policy_revision + (policyChanged ? 1 : 0), updated_at: new Date() })
          .where(eq(schema.liveSessions.id, id)).returning();
        await audit(context, id, 'LIVE_SESSION_UPDATE', request.ip);
        return { row: updated, context };
      }, { userLock: 'share', additionalUserIdsToLock: presenterIds });
      return reply.send(await serialize(result.row, result.context));
    } catch (error) { return respondWithError(reply, error); }
  });

  fastify.delete(apiEndpoints.liveSessions.delete, routeSchema('Soft-delete an unreferenced live source policy'), async (request, reply) => {
    try {
      const payload = await payloadFor(request), { id } = liveSessionParamsSchema.parse(request.params);
      const { expected_revision } = deleteLiveSessionSchema.parse(request.body);
      const result = await withCurrentMutationAuthorization(payload, async context => {
        const row = await currentRow(context.executor, id, true);
        if (!canMutate(context, row, 'delete')) throw AppError.forbidden();
        if (row.revision !== expected_revision) throw revisionConflict();
        await assertNoReferences(context.executor, id);
        await context.executor.update(schema.liveSessions).set({ deleted_at: new Date(), deleted_by: context.actor.userId,
          is_active: false, revision: row.revision + 1, policy_revision: row.policy_revision + 1, updated_at: new Date() }).where(eq(schema.liveSessions.id, id));
        await audit(context, id, 'LIVE_SESSION_DELETE', request.ip);
        return { id, revision: row.revision + 1, deleted: true };
      }, { userLock: 'share' });
      return reply.send(result);
    } catch (error) { return respondWithError(reply, error); }
  });
}
