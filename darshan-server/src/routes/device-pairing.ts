import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import { and, asc, desc, eq, gt } from 'drizzle-orm';
import { config } from '@/config';
import {
  createDevicePairingRepository,
  lockDevicePairingIdentity,
} from '@/db/repositories/device-pairing';
import { createDeviceCertificateRepository } from '@/db/repositories/device-certificate';
import { createScreenRepository } from '@/db/repositories/screen';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { withCurrentMutationAuthorization } from '@/auth/mutation-authorization';
import { canUnconditionally, defineAbilityFor } from '@/rbac';
import { createLogger } from '@/utils/logger';
import { apiEndpoints } from '@/config/apiEndpoints';
import { HTTP_STATUS } from '@/http-status-codes';
import { respondWithError } from '@/utils/errors';
import { AppError } from '@/utils/app-error';
import { getDatabase, schema, type DbExecutor } from '@/db';
import { extractDeviceAuthPublicKeyFromCsr, issueDeviceCertificateFromCsr } from '@/utils/device-request-auth';
import { recordPairingCodeAllocation, recordPairingCsrValidation } from '@/observability/metrics';
import { detectDevicePairingOrphans } from '@/services/device-pairing-orphan-service';
import { recordDisplayProfile } from '@/services/screen-display-state-service';
import { displayProfileV1Schema } from '@/utils/display-profile';
import { subject } from '@casl/ability';
import {
  canAccessScreen,
  canObserveScreen,
  canStartScreenRecovery,
  devicePairingReadCondition,
  hasDevicePairingReadGrant,
} from '@/rbac/screen-access';

const logger = createLogger('device-pairing-routes');
const { CREATED, OK } = HTTP_STATUS;
const ACTIVE_PAIRING_CODE_MAX_ATTEMPTS = 8;

type PairingCreateInput = {
  device_id?: string | null;
  expires_at: Date;
  width?: number | null;
  height?: number | null;
  aspect_ratio?: string | null;
  orientation?: string | null;
  model?: string | null;
  codecs?: string[] | null;
  device_info?: Record<string, any> | null;
};

function looksBase64(value: string) {
  return /^[A-Za-z0-9+/=\\r\\n]+$/.test(value);
}

function classifyPairingCsrValidationFailure(error: unknown) {
  if (!(error instanceof AppError)) {
    return 'unknown' as const;
  }

  switch (error.message) {
    case 'Invalid CSR format':
      return 'invalid_format' as const;
    case 'CSR verification failed':
      return 'verification_failed' as const;
    case 'CSR is missing a public key':
      return 'missing_public_key' as const;
    case 'CSR subject commonName is required':
      return 'missing_common_name' as const;
    case 'CSR RSA public key must be at least 2048 bits':
      return 'weak_rsa_key' as const;
    case 'CSR deviceId does not match pairing deviceId':
      return 'device_mismatch' as const;
    default:
      return 'unknown' as const;
  }
}

function redactOperationalIdentifier(value: string) {
  return {
    suffix: value.slice(-6),
    sha256_12: createHash('sha256').update(value).digest('hex').slice(0, 12),
  };
}

function getServerIdentity() {
  return {
    environment: config.SIGNHEX_ENVIRONMENT_NAME,
    deploymentId: config.SIGNHEX_DEPLOYMENT_ID,
    serverId: config.SIGNHEX_SERVER_ID,
    serverTime: new Date().toISOString(),
  };
}

const generatePairingCodeSchema = z.object({
  device_id: z.string().min(1),
  expires_in: z.number().int().positive().default(3600), // 1 hour
});

const completePairingSchema = z.object({
  pairing_code: z.string().min(1),
  csr: z.string().min(1), // Certificate Signing Request
});

const requestPairingSchema = z.object({
  device_label: z.string().optional(),
  expires_in: z.number().int().positive().default(600), // 10 minutes
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  aspect_ratio: z.string().optional(),
  orientation: z.enum(['portrait', 'landscape']).optional(),
  model: z.string().optional(),
  codecs: z.array(z.string()).optional(),
  device_info: z.record(z.any()).optional(),
  display_profile_v1: displayProfileV1Schema.optional(),
});

const pairingStatusQuerySchema = z.object({
  device_id: z.string().uuid(),
});

const pairingListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const confirmPairingSchema = z.object({
  pairing_code: z.string().min(1),
  name: z.string().min(1).max(255),
  location: z.string().optional(),
});

const revokePairingSchema = z.object({
  reason: z.string().trim().min(1).max(120).default('admin_revoked_stale_pairing'),
  note: z.string().trim().max(500).optional(),
});

export async function devicePairingRoutes(fastify: FastifyInstance) {
  const db = getDatabase();
  const pairingRepo = createDevicePairingRepository();
  const certificateRepo = createDeviceCertificateRepository();
  const screenRepo = createScreenRepository();

  const createPairingWithRetries = async (
    data: PairingCreateInput,
    codeFactory: () => string,
    context: { mode: 'device_request' | 'recovery'; deviceId?: string | null },
    executor?: DbExecutor,
  ) => {
    await pairingRepo.retireExpired(executor);

    let lastCollidingCode: string | null = null;
    for (let attempt = 1; attempt <= ACTIVE_PAIRING_CODE_MAX_ATTEMPTS; attempt += 1) {
      const pairingCode = codeFactory();
      const pairing = await pairingRepo.createIfCodeAvailable({
        ...data,
        pairing_code: pairingCode,
      }, executor);
      if (pairing) {
        recordPairingCodeAllocation(context.mode, 'success');
        return { pairing, pairingCode };
      }

      lastCollidingCode = pairingCode;
      recordPairingCodeAllocation(context.mode, 'collision_retry');
      logger.warn(
        {
          pairingCodeRef: redactOperationalIdentifier(pairingCode),
          attempt,
          mode: context.mode,
          deviceId: context.deviceId ?? null,
        },
        'Pairing code collision detected; retrying'
      );
      await pairingRepo.retireExpired(executor);
    }

    logger.error(
      {
        mode: context.mode,
        deviceId: context.deviceId ?? null,
        attempts: ACTIVE_PAIRING_CODE_MAX_ATTEMPTS,
        lastCollisionRef: lastCollidingCode ? redactOperationalIdentifier(lastCollidingCode) : null,
      },
      'Failed to allocate a unique active pairing code'
    );
    recordPairingCodeAllocation(context.mode, 'exhausted');
    throw AppError.conflict('Unable to generate a fresh pairing code. Please try again.');
  };

  const buildScreenDeviceInfo = (
    pairing: typeof schema.devicePairings.$inferSelect,
    pairingInfo: Record<string, any>
  ) => {
    const screenDeviceInfo: Record<string, any> = { ...(pairingInfo || {}) };
    delete screenDeviceInfo.pairing;
    if (pairing.model && screenDeviceInfo.model == null) screenDeviceInfo.model = pairing.model;
    if (pairing.codecs && screenDeviceInfo.codecs == null) screenDeviceInfo.codecs = pairing.codecs;
    return Object.keys(screenDeviceInfo).length > 0 ? screenDeviceInfo : null;
  };

  const validateConfirmedPairing = (pairing: typeof schema.devicePairings.$inferSelect) => {
    if (!pairing.device_id) {
      throw AppError.badRequest('Pairing is missing a device id');
    }

    const pairingInfo = (pairing.device_info || {}) as Record<string, any>;
    const pairingMeta = (pairingInfo?.pairing || {}) as Record<string, any>;
    const confirmed = pairingMeta.confirmed === true;
    const screenName =
      typeof pairingMeta.screen_name === 'string' && pairingMeta.screen_name.trim()
        ? pairingMeta.screen_name.trim()
        : null;
    const screenLocation =
      typeof pairingMeta.screen_location === 'string' && pairingMeta.screen_location.trim()
        ? pairingMeta.screen_location.trim()
        : null;

    if (!confirmed || !screenName) {
      throw AppError.conflict('Pairing not confirmed');
    }

    return {
      deviceId: pairing.device_id,
      pairingInfo,
      screenName,
      screenLocation,
    };
  };

  const findConfirmablePairingForUpdate = async (pairingCode: string, executor: DbExecutor) => {
    const now = new Date();
    const [activePairing] = await executor
      .select()
      .from(schema.devicePairings)
      .where(
        and(
          eq(schema.devicePairings.pairing_code, pairingCode),
          eq(schema.devicePairings.used, false),
          gt(schema.devicePairings.expires_at, now),
        ),
      )
      .limit(1)
      .for('update');
    if (activePairing) {
      return activePairing;
    }

    const [historicalPairing] = await executor
      .select()
      .from(schema.devicePairings)
      .where(eq(schema.devicePairings.pairing_code, pairingCode))
      .orderBy(desc(schema.devicePairings.created_at), asc(schema.devicePairings.id))
      .limit(1)
      .for('update');
    if (!historicalPairing) {
      throw AppError.notFound('Invalid or expired pairing code');
    }
    if (!historicalPairing.device_id) {
      throw AppError.badRequest('Pairing missing device reference');
    }

    const [latestActivePairing] = await executor
      .select()
      .from(schema.devicePairings)
      .where(
        and(
          eq(schema.devicePairings.device_id, historicalPairing.device_id),
          eq(schema.devicePairings.used, false),
          gt(schema.devicePairings.expires_at, now),
        ),
      )
      .orderBy(desc(schema.devicePairings.created_at), asc(schema.devicePairings.id))
      .limit(1)
      .for('update');
    if (latestActivePairing && latestActivePairing.id !== historicalPairing.id) {
      throw AppError.conflict('This recovery code has been superseded. Generate or use the latest recovery code.');
    }
    if (historicalPairing.used) {
      throw AppError.conflict('This pairing code is no longer active. Generate a fresh recovery code and try again.');
    }

    throw AppError.notFound('Invalid or expired pairing code');
  };

  const buildPairingState = (pairing: any | null) => {
    if (!pairing) return null;
    const pairingInfo = (pairing.device_info || {}) as Record<string, any>;
    const pairingMeta = (pairingInfo?.pairing || {}) as Record<string, any>;
    const confirmed = pairingMeta.confirmed === true;
    const mode =
      typeof pairingMeta.mode === 'string' && pairingMeta.mode.trim().length > 0
        ? pairingMeta.mode.trim()
        : null;

    return {
      id: pairing.id,
      pairing_code:
        typeof pairing.pairing_code === 'string' && pairing.pairing_code.trim().length > 0
          ? pairing.pairing_code.trim()
          : null,
      created_at: pairing.created_at?.toISOString?.() ?? pairing.created_at,
      expires_at: pairing.expires_at?.toISOString?.() ?? pairing.expires_at,
      confirmed,
      mode,
      confirmed_at:
        typeof pairingMeta.confirmed_at === 'string' && pairingMeta.confirmed_at.trim().length > 0
          ? pairingMeta.confirmed_at
          : null,
      screen_name:
        typeof pairingMeta.screen_name === 'string' && pairingMeta.screen_name.trim().length > 0
          ? pairingMeta.screen_name.trim()
          : null,
      screen_location:
        typeof pairingMeta.screen_location === 'string' && pairingMeta.screen_location.trim().length > 0
          ? pairingMeta.screen_location.trim()
          : null,
    };
  };

  const buildRecoveryDiagnostics = async (deviceId: string) => {
    const screen = await screenRepo.findById(deviceId);
    const activePairing = await pairingRepo.findActiveByDeviceId(deviceId);
    const latestCertificate = await certificateRepo.findLatestByDeviceId(deviceId);
    const now = Date.now();

    let authState:
      | 'VALID'
      | 'MISSING_CERTIFICATE'
      | 'EXPIRED_CERTIFICATE'
      | 'REVOKED_CERTIFICATE'
      | 'SCREEN_NOT_REGISTERED' = 'VALID';
    let authReason = 'Device credentials are valid.';

    if (!screen) {
      authState = 'SCREEN_NOT_REGISTERED';
      authReason = 'The screen row does not exist for this device.';
    } else if (!latestCertificate) {
      authState = 'MISSING_CERTIFICATE';
      authReason = 'No device certificate exists for this screen.';
    } else if (latestCertificate.is_revoked || latestCertificate.revoked_at) {
      authState = 'REVOKED_CERTIFICATE';
      authReason = 'The latest device certificate has been revoked.';
    } else if (latestCertificate.expires_at && latestCertificate.expires_at.getTime() <= now) {
      authState = 'EXPIRED_CERTIFICATE';
      authReason = 'The latest device certificate has expired.';
    }

    const activePairingState = buildPairingState(activePairing);
    const recommendedAction =
      authState === 'SCREEN_NOT_REGISTERED'
        ? 'FRESH_PAIRING_REQUIRED'
        : activePairingState?.mode === 'RECOVERY'
        ? 'COMPLETE_RECOVERY'
        : authState === 'VALID'
        ? 'NO_ACTION_REQUIRED'
        : 'RECOVER_IN_PLACE';

    return {
      device_id: deviceId,
      screen: screen
        ? {
            id: screen.id,
            name: screen.name,
            status: screen.status,
          }
        : null,
      active_pairing: activePairingState,
      certificate: latestCertificate
        ? {
            id: latestCertificate.id,
            serial: latestCertificate.serial,
            expires_at: latestCertificate.expires_at?.toISOString?.() ?? latestCertificate.expires_at,
            revoked_at: latestCertificate.revoked_at?.toISOString?.() ?? latestCertificate.revoked_at ?? null,
            is_revoked: latestCertificate.is_revoked,
          }
        : null,
      recovery: {
        auth_state: authState,
        reason: authReason,
        recommended_action: recommendedAction,
      },
    };
  };

  const issuePairingCode = async (deviceId: string, expiresIn: number, executor?: DbExecutor) => {
    const existingScreen = await screenRepo.findById(deviceId, executor);
    const retiredPairings = await pairingRepo.retireActiveByDeviceId(deviceId, null, executor);
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + expiresIn);

    const { pairing, pairingCode } = await createPairingWithRetries(
      {
        device_id: deviceId,
        expires_at: expiresAt,
      },
      () => randomBytes(3).toString('hex').toUpperCase(),
      {
        mode: 'recovery',
        deviceId,
      },
      executor,
    );

    return {
      pairing,
      retired_pairing_count: retiredPairings.length,
      pairing_code: pairingCode,
      expires_at: expiresAt.toISOString(),
      expires_in: expiresIn,
      recovery: {
        mode: existingScreen ? 'RECOVERY' : 'PAIRING',
        recommended_action: existingScreen ? 'CONFIRM_RECOVERY' : 'CONFIRM_PAIRING',
      },
    };
  };

  // Generate pairing code
  fastify.post<{ Body: typeof generatePairingCodeSchema._type }>(
    apiEndpoints.devicePairing.generate,
    {
      schema: {
        description: 'Generate pairing code for device (permission required)',
        tags: ['Device Pairing'],
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
        const data = generatePairingCodeSchema.parse(request.body);
        const responseBody = await withCurrentMutationAuthorization(
          payload,
          async ({ ability, executor }) => {
            await lockDevicePairingIdentity(executor, data.device_id);
            const [existingScreen] = await executor
              .select()
              .from(schema.screens)
              .where(eq(schema.screens.id, data.device_id))
              .for('update');
            if (!(ability as any).can('create', subject('DevicePairing', {
              device_id: data.device_id,
              screen_id: data.device_id,
            }))) throw AppError.forbidden('Forbidden');
            if (existingScreen && !canStartScreenRecovery(ability, existingScreen)) {
              throw AppError.forbidden('Forbidden');
            }
            return issuePairingCode(data.device_id, data.expires_in, executor);
          },
        );

        logger.info(
          {
            deviceId: data.device_id,
            pairingCodeRef: redactOperationalIdentifier(responseBody.pairing_code),
            expiresAt: responseBody.expires_at,
            retiredPairingCount: responseBody.retired_pairing_count,
          },
          'Pairing code generated'
        );

        return reply.status(CREATED).send({
          id: responseBody.pairing.id,
          pairing_code: responseBody.pairing_code,
          expires_at: responseBody.expires_at,
          expires_in: responseBody.expires_in,
          recovery: responseBody.recovery,
        });
      } catch (error) {
        logger.error(error, 'Generate pairing code error');
        return respondWithError(reply, error);
      }
    }
  );

  // Check device pairing status (no auth)
  fastify.get<{ Querystring: typeof pairingStatusQuerySchema._type }>(
    apiEndpoints.devicePairing.status,
    {
      schema: {
        description: 'Check if a device is already paired',
        tags: ['Device Pairing'],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const query = pairingStatusQuerySchema.parse(request.query);
        const diagnostics = await buildRecoveryDiagnostics(query.device_id);
        const confirmed = diagnostics.active_pairing?.confirmed === true;

        return reply.send({
          device_id: query.device_id,
          paired: Boolean(diagnostics.screen) || confirmed,
          confirmed,
          active_pairing: diagnostics.active_pairing,
          screen: diagnostics.screen,
          diagnostics: diagnostics.recovery,
          certificate: diagnostics.certificate,
        });
      } catch (error) {
        logger.error(error, 'Device pairing status error');
        return respondWithError(reply, error);
      }
    }
  );

  // Device-initiated pairing request (no auth)
  fastify.post<{ Body: typeof requestPairingSchema._type }>(
    apiEndpoints.devicePairing.request,
    {
      schema: {
        description: 'Request a pairing code from device after connectivity check',
        tags: ['Device Pairing'],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Reaching this endpoint over LAN implies connectivity; record observed IP for debugging
        const data = requestPairingSchema.parse(request.body);
        const deviceId = randomUUID();
        const expiresAt = new Date(Date.now() + data.expires_in * 1000);

        const { pairing, pairingCode } = await createPairingWithRetries(
          {
            device_id: deviceId,
            expires_at: expiresAt,
            width: data.width,
            height: data.height,
            aspect_ratio: data.aspect_ratio,
            orientation: data.orientation,
            model: data.model,
            codecs: data.codecs,
            device_info: {
              ...(data.device_info ?? {}),
              ...(data.display_profile_v1 ? { display_profile_v1: data.display_profile_v1 } : {}),
            },
          },
          () => (Math.floor(Math.random() * 900000) + 100000).toString(),
          {
            mode: 'device_request',
            deviceId,
          }
        );

        logger.info(
          {
            deviceId,
            pairingCodeRef: redactOperationalIdentifier(pairingCode),
            expiresAt,
            ip: request.ip,
            label: data.device_label,
          },
          'Device pairing requested'
        );

        return reply.status(CREATED).send({
          id: pairing.id,
          device_id: deviceId,
          pairing_code: pairingCode,
          expires_at: expiresAt.toISOString(),
          expires_in: data.expires_in,
          connected: true,
          observed_ip: request.ip,
          specs: {
            width: pairing.width ?? null,
            height: pairing.height ?? null,
            aspect_ratio: pairing.aspect_ratio ?? null,
            orientation: pairing.orientation ?? null,
            model: pairing.model ?? null,
            codecs: pairing.codecs ?? null,
            device_info: pairing.device_info ?? null,
          },
        });
      } catch (error) {
        logger.error(error, 'Device pairing request error');
        return respondWithError(reply, error);
      }
    }
  );

  // Complete pairing (device endpoint - no auth required)
  fastify.post<{ Body: typeof completePairingSchema._type }>(
    apiEndpoints.devicePairing.complete,
    {
      schema: {
        description: 'Complete device pairing with CSR',
        tags: ['Device Pairing'],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        if (config.NODE_ENV === 'development' && request.body && typeof request.body === 'object') {
          const rawBody = request.body as Record<string, unknown>;
          if ('pairingCode' in rawBody && !('pairing_code' in rawBody)) {
            logger.warn({ keys: Object.keys(rawBody) }, 'Possible schema mismatch: pairingCode used instead of pairing_code');
          }
          if (typeof rawBody.csr === 'string') {
            const trimmed = rawBody.csr.trim();
            if (!trimmed.startsWith('-----BEGIN CERTIFICATE REQUEST-----') && looksBase64(trimmed)) {
              logger.warn('CSR appears to be base64 without PEM header/footer');
            }
          }
        }
        const data = completePairingSchema.parse(request.body);

        // Find pairing by code
        const pairing = await pairingRepo.findByCode(data.pairing_code);
        if (!pairing) {
          throw AppError.notFound('Invalid or expired pairing code');
        }
        const { deviceId } = validateConfirmedPairing(pairing);

        const csr = data.csr.trim();
        if (!csr.startsWith('-----BEGIN CERTIFICATE REQUEST-----') || !csr.endsWith('-----END CERTIFICATE REQUEST-----')) {
          throw AppError.badRequest('Invalid CSR format');
        }
        let csrDetails: ReturnType<typeof extractDeviceAuthPublicKeyFromCsr>;
        try {
          csrDetails = extractDeviceAuthPublicKeyFromCsr(csr);
          if (csrDetails.subjectCommonName.toLowerCase() !== deviceId.toLowerCase()) {
            throw AppError.conflict('CSR deviceId does not match pairing deviceId');
          }
          recordPairingCsrValidation('accepted', 'valid');
        } catch (error) {
          recordPairingCsrValidation('rejected', classifyPairingCsrValidationFailure(error));
          throw error;
        }

        let caCert: string;
        let caKey: string;
        try {
          caCert = await readFile(config.CA_CERT_PATH, 'utf8');
        } catch (err: any) {
          if (err?.code === 'ENOENT') {
            throw AppError.caCertMissing(`CA certificate not found at ${config.CA_CERT_PATH}`);
          }
          throw err;
        }
        try {
          caKey = await readFile(config.CA_KEY_PATH, 'utf8');
        } catch (err: any) {
          if (err?.code === 'ENOENT') {
            throw AppError.caKeyMissing(`CA private key not found at ${config.CA_KEY_PATH}`);
          }
          throw err;
        }
        const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        const issuedCertificate = issueDeviceCertificateFromCsr({
          csrPem: csr,
          caCertPem: caCert,
          caKeyPem: caKey,
          notAfter: expiresAt,
        });
        const certificatePem = issuedCertificate.certificatePem;
        const deviceSerial = issuedCertificate.serialNumber;

        const completed = await db.transaction(async (tx) => {
          const currentPairing = await pairingRepo.findActiveById(pairing.id, tx);
          if (!currentPairing) {
            throw AppError.conflict('This pairing code is no longer active. Generate a fresh pairing code and try again.');
          }

          const { deviceId: currentDeviceId } = validateConfirmedPairing(currentPairing);
          if (currentDeviceId !== deviceId) {
            throw AppError.conflict('Pairing identity changed. Generate a fresh pairing code and try again.');
          }

          await lockDevicePairingIdentity(tx, currentDeviceId);

          const lockedPairing = await pairingRepo.findActiveById(pairing.id, tx);
          if (!lockedPairing) {
            throw AppError.conflict('This pairing code is no longer active. Generate a fresh pairing code and try again.');
          }
          const lockedPairingDetails = validateConfirmedPairing(lockedPairing);
          if (lockedPairingDetails.deviceId !== currentDeviceId ||
              csrDetails.subjectCommonName.toLowerCase() !== lockedPairingDetails.deviceId.toLowerCase()) {
            throw AppError.conflict('Pairing identity changed. Generate a fresh pairing code and try again.');
          }

          const consumedPairing = await pairingRepo.markAsUsedIfActive(lockedPairing.id, tx);
          if (!consumedPairing) {
            throw AppError.conflict('This pairing code is no longer active. Generate a fresh pairing code and try again.');
          }

          await certificateRepo.revokeByDeviceId(currentDeviceId, tx);
          await certificateRepo.create(
            {
              device_id: currentDeviceId,
              certificate: certificatePem,
              private_key: '',
              serial: deviceSerial,
              expires_at: expiresAt,
              public_key_pem: csrDetails.publicKeyPem,
              auth_version: 'signature_v1',
            },
            tx
          );

          const existingScreen = await screenRepo.findById(currentDeviceId, tx);
          const screenDeviceInfo = buildScreenDeviceInfo(lockedPairing, lockedPairingDetails.pairingInfo);
          if (!existingScreen) {
            await screenRepo.create(
              {
                id: currentDeviceId,
                name: lockedPairingDetails.screenName,
                location: lockedPairingDetails.screenLocation ?? undefined,
                aspect_ratio: lockedPairing.aspect_ratio ?? null,
                width: lockedPairing.width ?? null,
                height: lockedPairing.height ?? null,
                orientation: lockedPairing.orientation ?? null,
                device_info: screenDeviceInfo,
              },
              tx
            );
          } else {
            await screenRepo.update(
              currentDeviceId,
              {
                name: lockedPairingDetails.screenName,
                location: lockedPairingDetails.screenLocation ?? existingScreen.location ?? undefined,
                aspect_ratio: lockedPairing.aspect_ratio ?? existingScreen.aspect_ratio ?? null,
                width: lockedPairing.width ?? existingScreen.width ?? null,
                height: lockedPairing.height ?? existingScreen.height ?? null,
                orientation: lockedPairing.orientation ?? existingScreen.orientation ?? null,
                device_info:
                  screenDeviceInfo != null
                    ? {
                        ...((existingScreen.device_info as Record<string, any> | null) ?? {}),
                        ...screenDeviceInfo,
                      }
                    : existingScreen.device_info ?? null,
              },
              tx
            );
          }

          const pairingProfile = (lockedPairing.device_info as Record<string, unknown> | null)?.display_profile_v1;
          const parsedPairingProfile = displayProfileV1Schema.safeParse(pairingProfile);
          if (parsedPairingProfile.success) {
            await recordDisplayProfile(currentDeviceId, parsedPairingProfile.data, tx);
          }
          return { deviceId: currentDeviceId, pairing: lockedPairing };
        });

        logger.info(
          {
            deviceId: completed.deviceId,
            pairingId: completed.pairing.id,
            certificateSerial: redactOperationalIdentifier(deviceSerial),
          },
          'Device pairing completed'
        );

        return reply.status(CREATED).send({
          success: true,
          message: 'Device pairing completed. Certificate issued.',
          device_id: completed.deviceId,
          certificate: certificatePem,
          ca_certificate: caCert,
          fingerprint: deviceSerial,
          expires_at: expiresAt.toISOString(),
        });
      } catch (error) {
        logger.error(error, 'Complete pairing error');
        return respondWithError(reply, error);
      }
    }
  );

  // Confirm pairing (permission required)
  fastify.post<{ Body: typeof confirmPairingSchema._type }>(
    apiEndpoints.devicePairing.confirm,
    {
      schema: {
        description: 'Confirm pairing code (permission required)',
        tags: ['Device Pairing'],
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
        const data = confirmPairingSchema.parse(request.body);
        const preliminaryPairing = await pairingRepo.findByCode(data.pairing_code)
          ?? await pairingRepo.findAnyByCode(data.pairing_code);
        if (!preliminaryPairing) throw AppError.notFound('Invalid or expired pairing code');
        if (!preliminaryPairing.device_id) throw AppError.badRequest('Pairing missing device reference');
        const preliminaryDeviceId = preliminaryPairing.device_id;

        const { pairing, updatedInfo } = await withCurrentMutationAuthorization(
          payload,
          async ({ ability, executor }) => {
            await lockDevicePairingIdentity(executor, preliminaryDeviceId);
            const [existing] = await executor
              .select()
              .from(schema.screens)
              .where(eq(schema.screens.id, preliminaryDeviceId))
              .for('update');
            const currentPairing = await findConfirmablePairingForUpdate(data.pairing_code, executor);
            if (currentPairing.device_id !== preliminaryDeviceId) {
              throw AppError.conflict('This pairing code now belongs to a different pairing attempt. Try again.');
            }
            const proposedScreen = {
              ...(existing ?? {}),
              id: currentPairing.device_id,
              name: data.name,
              location: data.location ?? null,
            };
            const permitted = existing
              ? canAccessScreen(ability, 'update', existing) && canAccessScreen(ability, 'update', proposedScreen)
              : canAccessScreen(ability, 'create', proposedScreen);
            if (!permitted) throw AppError.forbidden('Forbidden');

            const pairingInfo = (currentPairing.device_info || {}) as Record<string, any>;
            const nextInfo = {
              ...pairingInfo,
              pairing: {
                ...(pairingInfo as any)?.pairing,
                confirmed: true,
                confirmed_at: new Date().toISOString(),
                mode: existing ? 'RECOVERY' : 'PAIRING',
                screen_name: data.name,
                screen_location: data.location ?? null,
              },
            };
            await pairingRepo.updateDeviceInfo(currentPairing.id, nextInfo, executor);
            return { pairing: currentPairing, updatedInfo: nextInfo };
          },
        );

        logger.info({ pairingId: pairing.id, deviceId: pairing.device_id }, 'Pairing confirmed; awaiting device completion');

        return reply.status(OK).send({
          message: 'Pairing confirmed. Awaiting device completion.',
          pairing: {
            id: pairing.id,
            device_id: pairing.device_id,
            pairing_code: pairing.pairing_code,
            expires_at: pairing.expires_at?.toISOString?.() ?? pairing.expires_at,
            confirmed_at: (updatedInfo as any).pairing?.confirmed_at,
          },
          recovery: {
            mode: (updatedInfo as any).pairing?.mode,
            recommended_action:
              (updatedInfo as any).pairing?.mode === 'RECOVERY' ? 'WAIT_FOR_DEVICE_RECOVERY_COMPLETE' : 'WAIT_FOR_DEVICE_COMPLETE',
          },
        });
      } catch (error) {
        logger.error(error, 'Confirm pairing error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get<{ Params: { deviceId: string } }>(
    apiEndpoints.devicePairing.recovery,
    {
      schema: {
        description: 'Get recovery diagnostics for an existing device/screen (record permission required)',
        tags: ['Device Pairing'],
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
        const deviceId = z.string().uuid().parse((request.params as any).deviceId);
        const screen = await screenRepo.findById(deviceId);
        if (!screen) throw AppError.notFound('Screen not found');
        if (!canObserveScreen(ability, screen)) throw AppError.forbidden('Forbidden');
        const diagnostics = await buildRecoveryDiagnostics(deviceId);
        return reply.send(diagnostics);
      } catch (error) {
        logger.error(error, 'Get device recovery diagnostics error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.post<{ Params: { deviceId: string }; Body: { expires_in?: number } }>(
    apiEndpoints.devicePairing.startRecovery,
    {
      schema: {
        description: 'Start credential recovery for an existing screen/device (record permissions required)',
        tags: ['Device Pairing'],
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
        const deviceId = z.string().uuid().parse((request.params as any).deviceId);

        const expiresIn = z
          .object({ expires_in: z.number().int().positive().default(900) })
          .parse(request.body ?? {}).expires_in;

        const responseBody = await withCurrentMutationAuthorization(
          payload,
          async ({ ability, executor }) => {
            await lockDevicePairingIdentity(executor, deviceId);
            const [screen] = await executor
              .select()
              .from(schema.screens)
              .where(eq(schema.screens.id, deviceId))
              .for('update');
            if (!screen) throw AppError.notFound('Screen not found');
            if (!canStartScreenRecovery(ability, screen)) {
              throw AppError.forbidden('Forbidden');
            }
            return issuePairingCode(deviceId, expiresIn, executor);
          },
        );
        const diagnostics = await buildRecoveryDiagnostics(deviceId);

        logger.info(
          { deviceId, pairingCodeRef: redactOperationalIdentifier(responseBody.pairing_code) },
          'Recovery pairing code generated',
        );

        return reply.status(CREATED).send({
          id: responseBody.pairing.id,
          pairing_code: responseBody.pairing_code,
          expires_at: responseBody.expires_at,
          expires_in: responseBody.expires_in,
          recovery: {
            ...responseBody.recovery,
            device_id: deviceId,
            screen: diagnostics.screen,
          },
          diagnostics: diagnostics.recovery,
          certificate: diagnostics.certificate,
        });
      } catch (error) {
        logger.error(error, 'Start device recovery error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get<{ Querystring: { limit?: number } }>(
    apiEndpoints.devicePairing.orphans,
    {
      schema: {
        description: 'Detect device pairing records that reference missing screen rows (unconditional permission required)',
        tags: ['Device Pairing'],
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
        if (!canUnconditionally(ability, 'read', 'DevicePairing')) {
          throw AppError.forbidden('Forbidden');
        }

        const limit = (request.query as any).limit ? Number.parseInt((request.query as any).limit as string, 10) : undefined;
        const report = await detectDevicePairingOrphans({ limit });
        return reply.send({
          ...report,
          server_identity: getServerIdentity(),
        });
      } catch (error) {
        logger.error(error, 'List device pairing orphans error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.post<{ Params: { deviceId: string }; Body: { reason?: string; note?: string } }>(
    apiEndpoints.devicePairing.revoke,
    {
      schema: {
        description: 'Revoke active pairing credentials for an existing screen/device (record permission required)',
        tags: ['Device Pairing'],
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
        const deviceId = z.string().uuid().parse((request.params as any).deviceId);
        const body = revokePairingSchema.parse(request.body ?? {});
        const now = new Date();
        const result = await withCurrentMutationAuthorization(
          payload,
          async ({ actor, ability, executor }) => {
            await lockDevicePairingIdentity(executor, deviceId);
            const [screen] = await executor
              .select()
              .from(schema.screens)
              .where(eq(schema.screens.id, deviceId))
              .for('update');
            const canManagePairing = (ability as any).can(
              'manage',
              subject('DevicePairing', { device_id: deviceId, screen_id: deviceId }),
            );
            const canDeleteTarget = Boolean(screen && canAccessScreen(ability, 'delete', screen));
            if (!canManagePairing && !canDeleteTarget) throw AppError.forbidden('Forbidden');

            const revokedCertificates = await executor
              .update(schema.deviceCertificates)
              .set({ is_revoked: true, revoked_at: now })
              .where(
                and(
                  eq(schema.deviceCertificates.screen_id, deviceId),
                  eq(schema.deviceCertificates.is_revoked, false),
                ),
              )
              .returning({ id: schema.deviceCertificates.id });

            const invalidatedPairings = await executor
              .update(schema.devicePairings)
              .set({ used: true, used_at: now, expires_at: now })
              .where(
                and(
                  eq(schema.devicePairings.device_id, deviceId),
                  eq(schema.devicePairings.used, false),
                ),
              )
              .returning({ id: schema.devicePairings.id });

            await executor.insert(schema.auditLogs).values({
              user_id: actor.userId,
              action: 'DEVICE_PAIRING_REVOKE',
              entity_type: 'DEVICE_PAIRING',
              entity_id: deviceId,
              ip_address: request.ip,
            });
            return { screen, revokedCertificates, invalidatedPairings };
          },
        );

        logger.warn(
          {
            deviceId,
            reason: body.reason,
            noteProvided: Boolean(body.note),
            revokedCertificates: result.revokedCertificates.length,
            invalidatedPairings: result.invalidatedPairings.length,
          },
          'Device pairing revoked by an authorized CMS actor'
        );

        return reply.status(OK).send({
          device_id: deviceId,
          screen: result.screen ? { id: result.screen.id, name: result.screen.name } : null,
          status: result.revokedCertificates.length > 0 ? 'PAIRING_REVOKED' : 'NO_ACTIVE_CREDENTIAL',
          revoked_certificates: result.revokedCertificates.length,
          invalidated_pairings: result.invalidatedPairings.length,
          recommended_action: 'PAIR_AGAIN',
          server_identity: getServerIdentity(),
        });
      } catch (error) {
        logger.error(error, 'Revoke device pairing error');
        return respondWithError(reply, error);
      }
    }
  );

  // List pairings
  fastify.get<{ Querystring: z.input<typeof pairingListQuerySchema> }>(
    apiEndpoints.devicePairing.list,
    {
      schema: {
        description: 'List device pairings (permission required)',
        tags: ['Device Pairing'],
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
        if (!hasDevicePairingReadGrant(ability)) throw AppError.forbidden('Forbidden');
        const { page, limit } = pairingListQuerySchema.parse(request.query);
        const result = await pairingRepo.list({
          page,
          limit,
          readCondition: devicePairingReadCondition(ability),
        });
        const now = new Date();

        return reply.send({
          items: result.items.map((p) => ({
            recovery: (() => {
              const info = (p.device_info || {}) as Record<string, any>;
              const pairingMeta = (info?.pairing || {}) as Record<string, any>;
              return {
                mode:
                  typeof pairingMeta.mode === 'string' && pairingMeta.mode.trim().length > 0
                    ? pairingMeta.mode.trim()
                    : null,
                recommended_action:
                  typeof pairingMeta.mode === 'string' && pairingMeta.mode.trim() === 'RECOVERY'
                    ? 'WAIT_FOR_DEVICE_RECOVERY_COMPLETE'
                    : 'WAIT_FOR_DEVICE_COMPLETE',
              };
            })(),
            id: p.id,
            device_id: p.device_id,
            pairing_code: p.pairing_code,
            used: p.used,
            // Keep the legacy booleans for existing clients, while giving the
            // operator a deterministic state that does not require each UI to
            // infer expiry differently.
            status: p.used ? 'USED' : p.expires_at.getTime() <= now.getTime() ? 'EXPIRED' : 'PENDING',
            used_at: p.used_at?.toISOString() || null,
            expires_at: p.expires_at.toISOString(),
            created_at: p.created_at.toISOString(),
            specs: {
              width: (p as any).width ?? null,
              height: (p as any).height ?? null,
              aspect_ratio: (p as any).aspect_ratio ?? null,
              orientation: (p as any).orientation ?? null,
              model: (p as any).model ?? null,
              codecs: (p as any).codecs ?? null,
              device_info: (p as any).device_info ?? null,
            },
          })),
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
          },
        });
      } catch (error) {
        logger.error(error, 'List pairings error');
        return respondWithError(reply, error);
      }
    }
  );
}
