import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { inArray } from 'drizzle-orm';
import { createAuditLogRepository } from '@/db/repositories/audit-log';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { defineAbilityFor } from '@/rbac';
import { createLogger } from '@/utils/logger';
import { apiEndpoints } from '@/config/apiEndpoints';
import { respondWithError } from '@/utils/errors';
import { AppError } from '@/utils/app-error';
import { escapeHtml, renderPdfDocument } from '@/utils/pdf-render';
import { getDatabase, schema } from '@/db';

const logger = createLogger('audit-log-routes');

const listAuditLogsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  user_id: z.string().optional(),
  resource_type: z.string().optional(),
  action: z.string().optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
});

function formatDateTime(value?: Date | string | null) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function formatAuditResource(value?: string | null) {
  if (!value?.trim()) return 'Record';
  const words = value.trim().replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

function formatAuditEvent(action?: string | null, resourceType?: string | null) {
  if (!action?.trim()) return 'Recorded event';
  const parts = action.trim().split(/[_\s-]+/).filter(Boolean);
  const verbs: Record<string, string> = {
    CREATE: 'created', CREATED: 'created', UPDATE: 'updated', UPDATED: 'updated',
    EDIT: 'edited', DELETE: 'deleted', DELETED: 'deleted', RESTORE: 'restored',
    REVOKE: 'revoked', TRIGGER: 'triggered', CLEAR: 'cleared', START: 'started',
    STOP: 'stopped', BAN: 'banned', UNBAN: 'unbanned', MUTE: 'muted', UNMUTE: 'unmuted',
  };
  const verb = verbs[parts.at(-1)?.toUpperCase() ?? ''];
  if (!verb) return formatAuditResource(action);
  const subject = parts.length > 1 ? parts.slice(0, -1).join('_') : resourceType;
  const label = /^(LIVE_SESSION|LIVE_RUN)$/i.test(subject ?? '') ? 'Live broadcast' : formatAuditResource(subject);
  return `${label} ${verb}`;
}

type AuditLogRow = typeof schema.auditLogs.$inferSelect;

async function serializeAuditLogs(logs: AuditLogRow[]) {
  const db = getDatabase();
  const userIds = Array.from(new Set(logs.map((log) => log.user_id).filter((value): value is string => Boolean(value))));

  const users =
    userIds.length > 0
      ? await db
          .select({
            id: schema.users.id,
            email: schema.users.email,
            first_name: schema.users.first_name,
            last_name: schema.users.last_name,
            role_id: schema.users.role_id,
            department_id: schema.users.department_id,
            is_active: schema.users.is_active,
            deleted_at: schema.users.deleted_at,
          })
          .from(schema.users)
          .where(inArray(schema.users.id, userIds))
      : [];

  const usersById = new Map(users.map((user) => [user.id, user]));

  return logs.map((log) => {
    const resolvedUser = log.user_id ? usersById.get(log.user_id) ?? null : null;
    const user = resolvedUser
      ? {
          ...resolvedUser,
          email: resolvedUser.deleted_at ? null : resolvedUser.email,
          status: resolvedUser.deleted_at ? 'DELETED' : resolvedUser.is_active ? 'ACTIVE' : 'INACTIVE',
        }
      : null;
    return {
    id: log.id,
    user_id: log.user_id,
    user,
    action: log.action,
    resource_type: log.entity_type,
    resource_id: log.entity_id,
    changes: null,
    ip_address: log.ip_address,
    user_agent: null,
    storage_object_id: log.storage_object_id,
    created_at: log.created_at.toISOString(),
    };
  });
}

export async function auditLogRoutes(fastify: FastifyInstance) {
  const auditRepo = createAuditLogRepository();

  // List audit logs
  fastify.get<{ Querystring: typeof listAuditLogsQuerySchema._type }>(
    apiEndpoints.auditLogs.list,
    {
      schema: {
        description: 'List audit logs (admin only)',
        tags: ['Audit Logs'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) {
          throw AppError.unauthorized('Missing authorization header');
        }

        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);

        if (!ability.can('read', 'AuditLog')) {
          throw AppError.forbidden('Forbidden');
        }

        const query = listAuditLogsQuerySchema.parse(request.query);
        const result = await auditRepo.list({
          page: query.page,
          limit: query.limit,
          user_id: query.user_id,
          resource_type: query.resource_type,
          action: query.action,
          startDate: query.start_date ? new Date(query.start_date) : undefined,
          endDate: query.end_date ? new Date(query.end_date) : undefined,
        });

        return reply.send({
          items: await serializeAuditLogs(result.items),
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
          },
        });
      } catch (error) {
        logger.error(error, 'List audit logs error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get<{ Querystring: typeof listAuditLogsQuerySchema._type }>(
    apiEndpoints.auditLogs.export,
    {
      schema: {
        description: 'Export audit logs as PDF',
        tags: ['Audit Logs'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest<{ Querystring: typeof listAuditLogsQuerySchema._type }>, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) {
          throw AppError.unauthorized('Missing authorization header');
        }

        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);

        if (!ability.can('read', 'AuditLog')) {
          throw AppError.forbidden('Forbidden');
        }

        const query = listAuditLogsQuerySchema.parse(request.query);
        const items = await auditRepo.listAll({
          user_id: query.user_id,
          resource_type: query.resource_type,
          action: query.action,
          startDate: query.start_date ? new Date(query.start_date) : undefined,
          endDate: query.end_date ? new Date(query.end_date) : undefined,
        });
        const records = await serializeAuditLogs(items);
        const generatedAt = new Date();

        const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Audit Logs</title>
    <style>
      body { font-family: "Liberation Sans", Arial, sans-serif; color: #1b1f1b; font-size: 11px; margin: 0; }
      h1, h2, p { margin: 0; }
      h1 { font-size: 22px; }
      .header { margin-bottom: 18px; }
      .subtitle, .meta { color: #5a5f5a; }
      .subtitle { margin-top: 5px; }
      .filters { margin-top: 13px; line-height: 1.5; }
      .count { margin: 12px 0 8px; font-weight: bold; }
      .entry { border-top: 1px solid #cbd2ca; padding: 10px 0; page-break-inside: avoid; }
      .entry h2 { font-size: 13px; margin-bottom: 5px; }
      .entry p { margin-top: 3px; line-height: 1.4; }
      .empty { color: #5a5f5a; margin-top: 14px; }
    </style>
  </head>
  <body>
    <div class="header">
      <h1>Audit Logs</h1>
      <p class="subtitle">Generated ${escapeHtml(formatDateTime(generatedAt))}</p>
      <div class="filters">
        <p>Resource: ${escapeHtml(query.resource_type || 'Any')} &nbsp; Action code: ${escapeHtml(query.action || 'Any')} &nbsp; User: ${escapeHtml(query.user_id || 'Any')}</p>
        <p>From: ${escapeHtml(formatDateTime(query.start_date || null))} &nbsp; To: ${escapeHtml(formatDateTime(query.end_date || null))}</p>
      </div>
    </div>
    ${
      records.length
        ? `
          <p class="count">${records.length} ${records.length === 1 ? 'event' : 'events'}</p>
          ${records.map((log) => {
            const actorName = [log.user?.first_name, log.user?.last_name].filter(Boolean).join(' ').trim();
            const actor = actorName || log.user?.email || (log.user_id ? 'Former or unavailable user' : 'System');
            return `
              <div class="entry">
                <h2>${escapeHtml(formatAuditEvent(log.action, log.resource_type))}</h2>
                <p>When: ${escapeHtml(formatDateTime(log.created_at))} &nbsp; Actor: ${escapeHtml(actor)}</p>
                <p>Resource: ${escapeHtml(formatAuditResource(log.resource_type))} &nbsp; ID: ${escapeHtml(log.resource_id || '—')}</p>
                <p class="meta">Action code: ${escapeHtml(log.action || '—')} &nbsp; Actor ID: ${escapeHtml(log.user_id || '—')} &nbsp; IP: ${escapeHtml(log.ip_address || '—')}</p>
              </div>
            `;
          }).join('')}
        `
        : '<p class="empty">No logs found for the selected filters.</p>'
    }
  </body>
</html>`;

        const pdf = await renderPdfDocument(html);
        reply.header('Content-Type', 'application/pdf');
        reply.header(
          'Content-Disposition',
          `attachment; filename="audit-logs-${generatedAt.toISOString().slice(0, 10)}.pdf"`
        );
        return reply.send(pdf);
      } catch (error) {
        logger.error(error, 'Export audit logs PDF error');
        return respondWithError(reply, error);
      }
    }
  );

  // Get audit log by ID
  fastify.get<{ Params: { id: string } }>(
    apiEndpoints.auditLogs.get,
    {
      schema: {
        description: 'Get audit log by ID (admin only)',
        tags: ['Audit Logs'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) {
          throw AppError.unauthorized('Missing authorization header');
        }

        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);

        if (!ability.can('read', 'AuditLog')) {
          throw AppError.forbidden('Forbidden');
        }

        const log = await auditRepo.findById(request.params.id);
        if (!log) {
          throw AppError.notFound('Audit log not found');
        }

        const [serialized] = await serializeAuditLogs([log]);
        return reply.send(serialized);
      } catch (error) {
        logger.error(error, 'Get audit log error');
        return respondWithError(reply, error);
      }
    }
  );
}
