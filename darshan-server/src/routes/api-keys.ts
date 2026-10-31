import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { subject } from '@casl/ability';
import { z } from 'zod';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { defineAbilityFor } from '@/rbac';
import { withCurrentMutationAuthorization } from '@/auth/mutation-authorization';
import { createApiKeyRepository } from '@/db/repositories/api-key';
import { schema } from '@/db';
import { integrationReadCondition } from '@/rbac/integration-access';
import { createLogger } from '@/utils/logger';
import { apiEndpoints } from '@/config/apiEndpoints';
import { HTTP_STATUS } from '@/http-status-codes';
import { respondWithError } from '@/utils/errors';
import { AppError } from '@/utils/app-error';

const logger = createLogger('api-keys-routes');
const { CREATED } = HTTP_STATUS;

const createApiKeySchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.string()).optional(),
  roles: z.array(z.string()).optional(),
  expires_at: z.string().datetime().optional(),
});

const serializeApiKey = (record: typeof schema.apiKeys.$inferSelect) => ({
  id: record.id,
  name: record.name,
  scopes: record.scopes,
  roles: record.roles,
  token_prefix: record.token_prefix,
  created_by: record.created_by,
  expires_at: record.expires_at,
  is_revoked: record.is_revoked,
  last_used_at: record.last_used_at,
  created_at: record.created_at,
  updated_at: record.updated_at,
});

export async function apiKeyRoutes(fastify: FastifyInstance) {
  const repo = createApiKeyRepository();

  // Create
  fastify.post<{ Body: typeof createApiKeySchema._type }>(
    apiEndpoints.apiKeys.create,
    {
      schema: {
        description: 'Create API key (admin only)',
        tags: ['API Keys'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const data = createApiKeySchema.parse(request.body);
        const { record, secret } = await withCurrentMutationAuthorization(payload, async ({ actor, ability, executor }) => {
          const proposed = {
            ...data,
            created_by: actor.userId,
            expires_at: data.expires_at ? new Date(data.expires_at) : null,
            is_revoked: false,
          };
          if (!(ability as any).can('create', subject('ApiKey', proposed))) {
            throw AppError.forbidden('Forbidden');
          }
          return repo.create({
            name: data.name,
            scopes: data.scopes,
            roles: data.roles,
            created_by: actor.userId,
            expires_at: proposed.expires_at,
          }, executor);
        });

        return reply.header('Cache-Control', 'no-store').status(CREATED).send({ ...serializeApiKey(record), secret });
      } catch (error) {
        logger.error(error, 'Create API key error');
        return respondWithError(reply, error);
      }
    }
  );

  // List
  fastify.get(
    apiEndpoints.apiKeys.list,
    {
      schema: {
        description: 'List API keys (admin only)',
        tags: ['API Keys'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
        if (!ability.can('read', 'ApiKey')) throw AppError.forbidden('Forbidden');

        const result = await repo.list({
          page: 1,
          limit: 100,
          includeRevoked: true,
          readCondition: integrationReadCondition(ability, 'ApiKey', schema.apiKeys),
        });
        return reply.send({ ...result, items: result.items.map(serializeApiKey) });
      } catch (error) {
        logger.error(error, 'List API keys error');
        return respondWithError(reply, error);
      }
    }
  );

  // Rotate
  fastify.post<{ Params: { id: string } }>(
    apiEndpoints.apiKeys.rotate,
    {
      schema: {
        description: 'Rotate API key secret (admin only)',
        tags: ['API Keys'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const rotated = await withCurrentMutationAuthorization(payload, async ({ ability, executor }) => {
          const record = await repo.findByIdForUpdate((request.params as any).id, executor);
          if (!record) throw AppError.notFound('API key not found');
          if (!(ability as any).can('update', subject('ApiKey', { ...record }))) {
            throw AppError.forbidden('Forbidden');
          }
          return repo.rotate(record.id, executor);
        });
        if (!rotated.record) throw AppError.notFound('API key not found');
        return reply.header('Cache-Control', 'no-store').send({ ...serializeApiKey(rotated.record), secret: rotated.secret });
      } catch (error) {
        logger.error(error, 'Rotate API key error');
        return respondWithError(reply, error);
      }
    }
  );

  // Revoke
  fastify.post<{ Params: { id: string } }>(
    apiEndpoints.apiKeys.revoke,
    {
      schema: {
        description: 'Revoke API key (admin only)',
        tags: ['API Keys'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) throw AppError.unauthorized('Missing authorization header');
        const payload = await verifyAccessToken(token);
        const record = await withCurrentMutationAuthorization(payload, async ({ ability, executor }) => {
          const current = await repo.findByIdForUpdate((request.params as any).id, executor);
          if (!current) throw AppError.notFound('API key not found');
          if (!(ability as any).can('delete', subject('ApiKey', { ...current }))) {
            throw AppError.forbidden('Forbidden');
          }
          return repo.revoke(current.id, executor);
        });
        if (!record) throw AppError.notFound('API key not found');
        return reply.send(serializeApiKey(record));
      } catch (error) {
        logger.error(error, 'Revoke API key error');
        return respondWithError(reply, error);
      }
    }
  );
}
