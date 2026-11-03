import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { apiEndpoints } from '@/config/apiEndpoints';
import { liveUuid } from '@/schemas/live-runtime';
import { getLiveTargetReports } from '@/services/live-target-reports';
import { AppError } from '@/utils/app-error';
import { respondWithError } from '@/utils/errors';

export async function liveTargetReportRoutes(fastify: FastifyInstance) {
  fastify.get(apiEndpoints.liveRuntime.targets, { schema: { tags: ['Live Runtime'], security: [{ bearerAuth: [] }] } }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    try {
      const id = z.object({ id: liveUuid }).parse(request.params).id;
      z.object({}).strict().parse(request.query);
      const token = extractTokenFromHeader(request.headers.authorization); if (!token) throw AppError.unauthorized();
      return reply.send(await getLiveTargetReports(await verifyAccessToken(token), id));
    } catch (error) { return respondWithError(reply, error); }
  });
}
