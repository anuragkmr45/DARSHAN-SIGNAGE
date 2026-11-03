import type { FastifyInstance, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { withCurrentMutationAuthorization } from '@/auth/mutation-authorization';
import { apiEndpoints } from '@/config/apiEndpoints';
import { config } from '@/config';
import { authenticateDeviceOrThrow } from '@/middleware/device-auth';
import { hasCompleteSignatureHeaders, parseDeviceRequestSignatureHeaders } from '@/utils/device-request-auth';
import { respondWithError } from '@/utils/errors';
import { AppError } from '@/utils/app-error';
import { liveUuid, liveStartSchema, liveStopSchema, liveControlSchema, livePresenterAdmissionSchema,
  liveDeviceAdmissionSchema, liveAdmissionActionSchema, liveObservationSchema, liveOccurrenceSelectorSchema,
  liveEpochChallengeSchema, liveAuthorityCheckSchema } from '@/schemas/live-runtime';
import { authenticateLiveAuthoritySecret, initializeLiveAuthorityEpoch, requireLiveAuthorityEpoch, readPrivateLiveFile, liveError } from '@/services/live-authority-epoch';
import { getLiveOccurrence, getLiveRuntimePreflight, listLiveOccurrences, startLiveRun, controlLiveOccurrence, occurrenceForRun,
  getDeviceLiveState, createLiveAdmission, renewOrTicketLiveAdmission, observeLiveAdmission,
  verifyLiveMediaAuthority, acceptLiveMediaDeathWitness, liveDeathWitnessSchema } from '@/services/live-runtime';
import { discoverLiveDeviceOccurrences } from '@/services/live-runtime-discovery';

const paths = apiEndpoints.liveRuntime;
const internal = { config: { liveRuntimeDeviceOrInternal: true }, schema: { tags: ['Live Runtime'] } };
const cms = { schema: { tags: ['Live Runtime'], security: [{ bearerAuth: [] }] } };
const params = (request: FastifyRequest) => z.object({ id: liveUuid }).parse(request.params).id;
async function actor(request: FastifyRequest) {
  const token = extractTokenFromHeader(request.headers.authorization);
  if (!token) throw AppError.unauthorized();
  return verifyAccessToken(token);
}
async function signedDevice(request: FastifyRequest, runtimeSessionId?: string) {
  requireLiveAuthorityEpoch();
  const id = z.object({ deviceId: liveUuid }).passthrough().parse(request.params).deviceId;
  const headers = parseDeviceRequestSignatureHeaders(request.headers as Record<string, string | string[] | undefined>);
  // Never accept the legacy serial-only or CMS-bearer fallback for live grants.
  if (!hasCompleteSignatureHeaders(headers)) throw AppError.unauthorized('A signed player request is required.', { reason: 'MISSING_DEVICE_SIGNATURE' });
  const identity = await authenticateDeviceOrThrow(request, id, { allowUserToken: false, requireSignature: true });
  if (identity.type !== 'device') throw AppError.unauthorized('A signed player identity is required.');
  const runtimeHeader = request.headers['x-darshan-runtime-session-id'] ?? request.headers['x-signhex-runtime-session-id'];
  if (runtimeSessionId && runtimeHeader && runtimeHeader !== runtimeSessionId) throw liveError('LIVE_RUNTIME_SESSION_MISMATCH', 'The player runtime binding changed.');
  return { screenId: id, serial: headers.serial!, runtimeSessionId: runtimeSessionId ?? '' };
}
export async function liveRuntimeRoutes(fastify: FastifyInstance) {
  initializeLiveAuthorityEpoch();
  fastify.addHook('onSend', async (_request, reply, payload) => { reply.header('cache-control', 'no-store'); return payload; });
  fastify.post(paths.cmsEpoch, cms, async (request, reply) => {
    try { const body = liveEpochChallengeSchema.parse(request.body);
      return reply.send(await withCurrentMutationAuthorization(await actor(request), async () => ({ version: 1, nonce: body.nonce,
        epoch_id: requireLiveAuthorityEpoch().epoch_id, server_now: new Date().toISOString() }), { userLock: 'share', sessionLock: 'share' })); }
    catch (error) { return respondWithError(reply, error); }
  });
  fastify.get(paths.occurrences, cms, async (request, reply) => {
    try { const query = z.object({ runtime_session_id: liveUuid.optional(), page: z.coerce.number().int().positive().optional(),
      page_size: z.coerce.number().int().min(1).max(100).optional(), from: z.string().datetime({ offset: true }).optional(),
      until: z.string().datetime({ offset: true }).optional() }).strict().parse(request.query);
      return reply.send(await listLiveOccurrences(await actor(request), query.runtime_session_id, query)); }
    catch (error) { return respondWithError(reply, error); }
  });
  fastify.get(paths.occurrence, cms, async (request, reply) => {
    try { const query = z.object({ runtime_session_id: liveUuid.optional() }).strict().parse(request.query);
      return reply.send(await getLiveOccurrence(await actor(request), params(request), query.runtime_session_id)); }
    catch (error) { return respondWithError(reply, error); }
  });
  fastify.get(paths.preflight, cms, async (request, reply) => {
    try { const query = z.object({ runtime_session_id: liveUuid.optional() }).strict().parse(request.query);
      return reply.send(await getLiveRuntimePreflight(await actor(request), params(request), query.runtime_session_id)); }
    catch (error) { return respondWithError(reply, error); }
  });
  fastify.post(paths.start, cms, async (request, reply) => {
    try { return reply.code(202).send(await startLiveRun(await actor(request), params(request), liveStartSchema.parse(request.body))); }
    catch (error) { return respondWithError(reply, error); }
  });
  fastify.post(paths.stop, cms, async (request, reply) => {
    try { return reply.code(202).send(await controlLiveOccurrence(await actor(request), params(request), liveStopSchema.parse(request.body), 'STOP')); }
    catch (error) { return respondWithError(reply, error); }
  });
  fastify.post(paths.enable, cms, async (request, reply) => {
    try { return reply.send(await controlLiveOccurrence(await actor(request), params(request), liveControlSchema.parse(request.body), 'ENABLE')); }
    catch (error) { return respondWithError(reply, error); }
  });
  fastify.post(paths.presenterAdmission, cms, async (request, reply) => {
    try { const runId = z.object({ runId: liveUuid }).parse(request.params).runId, body = livePresenterAdmissionSchema.parse(request.body);
      return reply.code(202).send(await createLiveAdmission({ occurrenceId: await occurrenceForRun(runId) }, await actor(request), { ...body, run_id: runId })); }
    catch (error) { return respondWithError(reply, error); }
  });
  for (const [path, kind] of [[paths.renew, 'RENEW'], [paths.ticket, 'TICKET']] as const) fastify.post(path, cms, async (request, reply) => {
    try { return reply.send(await renewOrTicketLiveAdmission(await actor(request), params(request), liveAdmissionActionSchema.parse(request.body), kind)); }
    catch (error) { return respondWithError(reply, error); }
  });
  fastify.post(paths.observations, cms, async (request, reply) => {
    try { return reply.send(await observeLiveAdmission(await actor(request), params(request), liveObservationSchema.parse(request.body))); }
    catch (error) { return respondWithError(reply, error); }
  });
  fastify.get(paths.deviceState, internal, async (request, reply) => {
    try { const query = liveOccurrenceSelectorSchema.parse(request.query), device = await signedDevice(request, query.runtime_session_id);
      return reply.send(await getDeviceLiveState(device, query.publish_id, query.schedule_item_id)); }
    catch (error) { return respondWithError(reply, error); }
  });
  fastify.get(paths.deviceOccurrences, internal, async (request, reply) => {
    try { const query = z.object({ runtime_session_id: liveUuid }).strict().parse(request.query);
      return reply.send(await discoverLiveDeviceOccurrences(await signedDevice(request, query.runtime_session_id))); }
    catch (error) { return respondWithError(reply, error); }
  });
  fastify.post(paths.deviceEpoch, internal, async (request, reply) => {
    try { const body = liveEpochChallengeSchema.parse(request.body); await signedDevice(request);
      return reply.send({ version: 1, nonce: body.nonce, epoch_id: requireLiveAuthorityEpoch().epoch_id, server_now: new Date().toISOString() }); }
    catch (error) { return respondWithError(reply, error); }
  });
  fastify.post(paths.deviceAdmission, internal, async (request, reply) => {
    try { const body = liveDeviceAdmissionSchema.parse(request.body), device = await signedDevice(request, body.runtime_session_id);
      return reply.code(202).send(await createLiveAdmission({ publishId: body.publish_id, itemId: body.schedule_item_id }, undefined, body, device)); }
    catch (error) { return respondWithError(reply, error); }
  });
  for (const [path, kind] of [[paths.deviceRenew, 'RENEW'], [paths.deviceTicket, 'TICKET']] as const) fastify.post(path, internal, async (request, reply) => {
    try { const body = liveAdmissionActionSchema.parse(request.body), device = await signedDevice(request, body.runtime_session_id);
      return reply.send(await renewOrTicketLiveAdmission(undefined, params(request), body, kind, device)); }
    catch (error) { return respondWithError(reply, error); }
  });
  fastify.post(paths.deviceObservations, internal, async (request, reply) => {
    try { const body = liveObservationSchema.parse(request.body), device = await signedDevice(request, body.runtime_session_id);
      return reply.send(await observeLiveAdmission(undefined, params(request), body, device)); }
    catch (error) { return respondWithError(reply, error); }
  });
  fastify.post(paths.internalAuthority, internal, async (request, reply) => {
    try { if (request.headers.origin) throw AppError.forbidden('Browser origins cannot call live control.');
      authenticateLiveAuthoritySecret(request.headers['x-darshan-live-authority-secret']);
      return reply.send(await verifyLiveMediaAuthority(liveAuthorityCheckSchema.parse(request.body))); }
    catch (error) { return respondWithError(reply, error); }
  });
  fastify.post(paths.internalWitness, internal, async (request, reply) => {
    try { requireLiveAuthorityEpoch();
      if (request.headers.origin) throw AppError.forbidden('Browser origins cannot submit host evidence.');
      if (!config.DARSHAN_LIVE_NODE_WITNESS_SECRET_FILE) throw liveError('LIVE_WITNESS_UNAVAILABLE', 'No trusted host witness is configured.', 503);
      const expected = readPrivateLiveFile(config.DARSHAN_LIVE_NODE_WITNESS_SECRET_FILE).bytes.toString('utf8').trim();
      const supplied = request.headers['x-darshan-live-witness-secret'];
      if (expected.length < 32 || typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw AppError.unauthorized('Invalid host witness authentication.');
      return reply.send(await acceptLiveMediaDeathWitness(liveDeathWitnessSchema.parse(request.body))); }
    catch (error) { return respondWithError(reply, error); }
  });
}
