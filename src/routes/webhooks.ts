import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { defineAbilityFor } from '@/rbac';
import { createWebhookRepository } from '@/db/repositories/webhook';
import { createLogger } from '@/utils/logger';
import { apiEndpoints } from '@/config/apiEndpoints';
import { HTTP_STATUS } from '@/http-status-codes';
import { respondWithError } from '@/utils/errors';
import { AppError } from '@/utils/app-error';

const logger = createLogger('webhook-routes');
const { BAD_REQUEST, CREATED, FORBIDDEN, NO_CONTENT, NOT_FOUND, UNAUTHORIZED } = HTTP_STATUS;

const webhookSchema = z.object({
  name: z.string().min(1),
  event_types: z.array(z.string()).min(1),
  target_url: z.string().url(),
  headers: z.record(z.string()).optional(),
  is_active: z.boolean().optional(),
});

const WEBHOOK_TEST_EVENT = 'webhook.test';
const WEBHOOK_TEST_TIMEOUT_MS = 5_000;

async function deliverWebhookTest(
  record:
    | {
        id: string;
        target_url: string;
        headers?: Record<string, string> | null;
      }
    | null
) {
  if (!record) {
    throw AppError.notFound('Webhook not found');
  }

  const sentAt = new Date().toISOString();
  const response = await fetch(record.target_url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'signhex-webhook-test',
      'x-signhex-event': WEBHOOK_TEST_EVENT,
      'x-signhex-sent-at': sentAt,
      'x-signhex-webhook-id': record.id,
      ...Object.fromEntries(
        Object.entries(record.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
      ),
    },
    body: JSON.stringify({
      type: WEBHOOK_TEST_EVENT,
      sent_at: sentAt,
      webhook_id: record.id,
      target_url: record.target_url,
    }),
    signal: AbortSignal.timeout(WEBHOOK_TEST_TIMEOUT_MS),
  });

  return { response, sentAt };
}

export async function webhookRoutes(fastify: FastifyInstance) {
  const repo = createWebhookRepository();

  fastify.post<{ Body: typeof webhookSchema._type }>(
    apiEndpoints.webhooks.create,
    {
      schema: {
        description: 'Create webhook (admin only)',
        tags: ['Webhooks'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
        if (!ability.can('create', 'Webhook')) throw AppError.forbidden('Forbidden');

        const data = webhookSchema.parse(request.body);
        const { record, secret } = await repo.create({ ...data, created_by: payload.sub });
        return reply.status(CREATED).send({ ...record, secret });
      } catch (error) {
        logger.error(error, 'Create webhook error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get(
    apiEndpoints.webhooks.list,
    {
      schema: {
        description: 'List webhooks (admin only)',
        tags: ['Webhooks'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
        if (!ability.can('read', 'Webhook')) throw AppError.forbidden('Forbidden');

        const items = await repo.list();
        return reply.send({ items });
      } catch (error) {
        logger.error(error, 'List webhooks error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.patch<{ Params: { id: string }; Body: Partial<typeof webhookSchema._type> }>(
    apiEndpoints.webhooks.update,
    {
      schema: {
        description: 'Update webhook (admin only)',
        tags: ['Webhooks'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
        if (!ability.can('update', 'Webhook')) throw AppError.forbidden('Forbidden');

        const record = await repo.update((request.params as any).id, webhookSchema.partial().parse(request.body));
        if (!record) throw AppError.notFound('Webhook not found');
        return reply.send(record);
      } catch (error) {
        logger.error(error, 'Update webhook error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    apiEndpoints.webhooks.delete,
    {
      schema: {
        description: 'Delete webhook (admin only)',
        tags: ['Webhooks'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
        if (!ability.can('delete', 'Webhook')) throw AppError.forbidden('Forbidden');

        await repo.delete((request.params as any).id);
        return reply.status(NO_CONTENT).send();
      } catch (error) {
        logger.error(error, 'Delete webhook error');
        return respondWithError(reply, error);
      }
    }
  );

  // Test fire (simple ping)
  fastify.post<{ Params: { id: string } }>(
    apiEndpoints.webhooks.test,
    {
      schema: {
        description: 'Test webhook delivery (admin only)',
        tags: ['Webhooks'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
        if (!ability.can('update', 'Webhook')) throw AppError.forbidden('Forbidden');

        const record = await repo.findById((request.params as any).id);
        if (!record) throw AppError.notFound('Webhook not found');

        const attemptedAt = new Date();

        try {
          const { response, sentAt } = await deliverWebhookTest(record);
          const lastStatusAt = new Date();
          const lastStatus = response.ok ? 'SUCCESS' : `FAILED_HTTP_${response.status}`;

          await repo.update(record.id, {
            last_status: lastStatus,
            last_status_at: lastStatusAt,
          });

          if (!response.ok) {
            throw new AppError({
              statusCode: 502,
              code: 'WEBHOOK_TEST_FAILED',
              message: `Webhook test delivery failed with status ${response.status}.`,
              details: {
                attempted: record.target_url,
                status_code: response.status,
                sent_at: sentAt,
              },
            });
          }

          return reply.send({
            success: true,
            attempted: record.target_url,
            status_code: response.status,
            sent_at: sentAt,
          });
        } catch (deliveryError) {
          const lastStatusAt = new Date();
          await repo.update(record.id, {
            last_status: 'FAILED',
            last_status_at: lastStatusAt,
          });

          if (deliveryError instanceof AppError) {
            throw deliveryError;
          }

          throw new AppError({
            statusCode: 502,
            code: 'WEBHOOK_TEST_FAILED',
            message: 'Webhook test delivery failed before a response was received.',
            details: {
              attempted: record.target_url,
              attempted_at: attemptedAt.toISOString(),
            },
          });
        }
      } catch (error) {
        logger.error(error, 'Test webhook error');
        return respondWithError(reply, error);
      }
    }
  );
}
