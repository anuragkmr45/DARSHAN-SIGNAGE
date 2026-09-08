import { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { desc, eq, lt } from 'drizzle-orm';
import { getDatabase, schema } from '@/db';
import { AppError } from '@/utils/app-error';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { defineAbilityFor } from '@/rbac';
import { createLogger } from '@/utils/logger';
import { recordDeviceAuthAttempt } from '@/observability/metrics';
import { recordDeviceAuthRolloutObservation } from '@/deployment/device-auth-rollout';
import {
  hasAnySignatureHeader,
  hasCompleteSignatureHeaders,
  hasCompleteNativeSignatureHeaders,
  parseDeviceRequestSignatureHeaders,
  resolveDeviceAuthMode,
  resolveDeviceAuthSignatureMaxSkewSeconds,
  verifyDeviceRequestSignature,
  verifyNativeDeviceRequestSignature,
} from '@/utils/device-request-auth';

const logger = createLogger('device-auth');
const deviceIdSchema = z.string().uuid();
const credentialIdSchema = z.string().uuid();
const nonceSchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
let lastNativeNonceCleanupAt = 0;

type DeviceAuthOptions = {
  allowUserToken?: boolean;
};

const getDeviceRequestUrl = (request: FastifyRequest) => request.raw.url || request.url || '/';

async function recordNativeNonceOrThrow(params: {
  db: ReturnType<typeof getDatabase>;
  credentialId: string;
  nonce: string;
  expiresAt: Date;
}) {
  const nowMs = Date.now();
  // This table is a replay ledger, not telemetry. A bounded periodic cleanup
  // keeps it finite without adding a delete query to every signed request.
  if (nowMs - lastNativeNonceCleanupAt >= 60_000) {
    lastNativeNonceCleanupAt = nowMs;
    await params.db.delete(schema.deviceAuthNonces).where(lt(schema.deviceAuthNonces.expires_at, new Date(nowMs)));
  }
  const inserted = await params.db
    .insert(schema.deviceAuthNonces)
    .values({
      credential_id: params.credentialId,
      nonce: params.nonce,
      expires_at: params.expiresAt,
    })
    .onConflictDoNothing()
    .returning({ id: schema.deviceAuthNonces.id });
  if (inserted.length !== 1) {
    throw AppError.forbidden('Native device request nonce has already been used', {
      reason: 'NATIVE_DEVICE_SIGNATURE_REPLAYED',
    });
  }
}

function normalizeAuthFailureReason(error: unknown) {
  if (error instanceof AppError && error.details && !Array.isArray(error.details)) {
    const reason = error.details.reason;
    if (typeof reason === 'string' && reason.trim().length > 0) {
      return reason.trim().toLowerCase();
    }
  }

  if (error instanceof AppError) {
    return error.code.trim().toLowerCase();
  }

  return 'unknown';
}

export async function authenticateDeviceOrThrow(
  request: FastifyRequest,
  deviceId: string,
  options: DeviceAuthOptions = {}
) {
  const parsedId = deviceIdSchema.safeParse(deviceId);
  if (!parsedId.success) {
    throw AppError.badRequest('Invalid device id');
  }

  const authMode = resolveDeviceAuthMode();
  const signatureHeaders = parseDeviceRequestSignatureHeaders(request.headers as Record<string, string | string[] | undefined>);
  const hasSignatureHeaders = hasAnySignatureHeader(signatureHeaders);
  const bearerToken = options.allowUserToken ? extractTokenFromHeader(request.headers.authorization) : null;
  const certSerial = signatureHeaders.serial;
  const nativeCredentialId = signatureHeaders.credentialId;
  const recordAuthSuccess = (
    authMethod: 'legacy_serial' | 'signature' | 'native_signature' | 'user_token' | 'missing_identity'
  ) => {
    recordDeviceAuthAttempt({
      configuredMode: authMode,
      authMethod,
      result: 'success',
      reason: 'authorized',
    });
  };
  const initialAuthMethod: 'legacy_serial' | 'signature' | 'native_signature' | 'user_token' | 'missing_identity' = nativeCredentialId
    ? 'native_signature'
    : certSerial
    ? authMode === 'signature' || hasSignatureHeaders
      ? 'signature'
      : 'legacy_serial'
    : bearerToken
    ? 'user_token'
    : authMode === 'signature' || hasSignatureHeaders
    ? 'signature'
    : 'missing_identity';

  try {
    if (certSerial && nativeCredentialId) {
      throw AppError.badRequest('Only one device credential header may be supplied', {
        reason: 'AMBIGUOUS_DEVICE_CREDENTIAL',
      });
    }

    if (nativeCredentialId) {
      if (!hasCompleteNativeSignatureHeaders(signatureHeaders)) {
        throw AppError.unauthorized('Missing native device request signature', {
          reason: 'MISSING_NATIVE_DEVICE_SIGNATURE',
        });
      }
      const parsedCredentialId = credentialIdSchema.safeParse(nativeCredentialId);
      const parsedNonce = nonceSchema.safeParse(signatureHeaders.nonce);
      if (!parsedCredentialId.success || !parsedNonce.success) {
        throw AppError.badRequest('Invalid native device signature identity', {
          reason: 'NATIVE_DEVICE_SIGNATURE_IDENTITY_INVALID',
        });
      }
      const signatureTimestamp = Number.parseInt(signatureHeaders.timestamp!, 10);
      if (!Number.isFinite(signatureTimestamp)) {
        throw AppError.badRequest('Invalid native device signature timestamp', {
          reason: 'NATIVE_DEVICE_SIGNATURE_TIMESTAMP_INVALID',
        });
      }
      const maxSkewMs = resolveDeviceAuthSignatureMaxSkewSeconds() * 1000;
      if (Math.abs(Date.now() - signatureTimestamp) > maxSkewMs) {
        throw AppError.forbidden('Native device request signature expired', {
          reason: 'NATIVE_DEVICE_SIGNATURE_EXPIRED',
          timestamp: signatureHeaders.timestamp,
        });
      }

      const db = getDatabase();
      const [credential] = await db
        .select()
        .from(schema.deviceCredentials)
        .where(eq(schema.deviceCredentials.credential_id, parsedCredentialId.data))
        .limit(1);
      if (!credential || credential.screen_id !== deviceId) {
        throw AppError.forbidden('Invalid native device credentials', {
          reason: 'NATIVE_DEVICE_CREDENTIALS_INVALID',
        });
      }
      if (credential.is_revoked || credential.revoked_at || credential.trust_level === 'REVOKED') {
        throw AppError.forbidden('Native device credentials revoked', {
          reason: 'NATIVE_DEVICE_CREDENTIALS_REVOKED',
        });
      }
      if (credential.expires_at && credential.expires_at.getTime() <= Date.now()) {
        throw AppError.forbidden('Native device credentials expired', {
          reason: 'NATIVE_DEVICE_CREDENTIALS_EXPIRED',
        });
      }

      const validSignature = verifyNativeDeviceRequestSignature({
        method: request.method,
        url: getDeviceRequestUrl(request),
        deviceId,
        credentialId: parsedCredentialId.data,
        timestamp: signatureHeaders.timestamp!,
        nonce: parsedNonce.data,
        body: request.body,
        signature: signatureHeaders.signature!,
        publicKeyPem: credential.public_key_pem,
        version: signatureHeaders.version!,
      });
      if (!validSignature) {
        throw AppError.forbidden('Invalid native device request signature', {
          reason: 'NATIVE_DEVICE_SIGNATURE_INVALID',
        });
      }

      await recordNativeNonceOrThrow({
        db,
        credentialId: parsedCredentialId.data,
        nonce: parsedNonce.data,
        expiresAt: new Date(Date.now() + maxSkewMs),
      });

      const [screen] = await db
        .select({ id: schema.screens.id })
        .from(schema.screens)
        .where(eq(schema.screens.id, deviceId))
        .limit(1);
      if (!screen) {
        throw AppError.notFound('Device not registered', {
          reason: 'DEVICE_NOT_REGISTERED',
          credential_present: true,
        });
      }

      request.device = {
        id: deviceId,
        authType: 'device',
        credentialId: credential.id,
        fingerprint: credential.credential_id,
        authMethod: 'native_signature',
      };
      recordAuthSuccess('native_signature');
      return { type: 'device' as const };
    }

    if (certSerial) {
      const db = getDatabase();
      const certificates = await db
        .select()
        .from(schema.deviceCertificates)
        .where(eq(schema.deviceCertificates.screen_id, deviceId))
        .orderBy(desc(schema.deviceCertificates.created_at));
      const cert = certificates.find((entry) => entry.serial === certSerial) ?? null;
      const activeCertificate = certificates.find((entry) => !entry.is_revoked && !entry.revoked_at) ?? null;
      const revokedCertificate = certificates.find((entry) => entry.is_revoked || entry.revoked_at) ?? null;

      if (!cert) {
        if (revokedCertificate && !activeCertificate) {
          throw AppError.forbidden('Device credentials revoked', {
            reason: 'DEVICE_CREDENTIALS_REVOKED',
            revoked_at: revokedCertificate.revoked_at?.toISOString?.() ?? revokedCertificate.revoked_at ?? null,
          });
        }

        throw AppError.forbidden('Invalid device credentials', {
          reason: activeCertificate ? 'DEVICE_SERIAL_MISMATCH' : 'DEVICE_CREDENTIALS_INVALID',
          expected_serial: activeCertificate?.serial ?? null,
        });
      }

      if (cert.is_revoked || cert.revoked_at) {
        throw AppError.forbidden('Device credentials revoked', {
          reason: 'DEVICE_CREDENTIALS_REVOKED',
          revoked_at: cert.revoked_at?.toISOString?.() ?? cert.revoked_at ?? null,
        });
      }
      if (cert.expires_at && cert.expires_at.getTime() <= Date.now()) {
        throw AppError.forbidden('Device credentials expired', {
          reason: 'DEVICE_CREDENTIALS_EXPIRED',
          expires_at: cert.expires_at.toISOString(),
        });
      }

      if (authMode === 'signature' || hasSignatureHeaders) {
        if (!hasCompleteSignatureHeaders(signatureHeaders)) {
          throw AppError.unauthorized('Missing device request signature', {
            reason: 'MISSING_DEVICE_SIGNATURE',
          });
        }
        if (!cert.public_key_pem) {
          throw AppError.forbidden('Device signature verification unavailable', {
            reason: 'DEVICE_SIGNATURE_UNAVAILABLE',
            auth_version: cert.auth_version,
          });
        }

        const signatureTimestamp = Number.parseInt(signatureHeaders.timestamp!, 10);
        if (!Number.isFinite(signatureTimestamp)) {
          throw AppError.badRequest('Invalid device signature timestamp', {
            reason: 'DEVICE_SIGNATURE_TIMESTAMP_INVALID',
          });
        }

        const maxSkewMs = resolveDeviceAuthSignatureMaxSkewSeconds() * 1000;
        if (Math.abs(Date.now() - signatureTimestamp) > maxSkewMs) {
          throw AppError.forbidden('Device request signature expired', {
            reason: 'DEVICE_SIGNATURE_EXPIRED',
            timestamp: signatureHeaders.timestamp,
          });
        }

        const isValidSignature = verifyDeviceRequestSignature({
          method: request.method,
          url: getDeviceRequestUrl(request),
          deviceId,
          timestamp: signatureHeaders.timestamp!,
          signature: signatureHeaders.signature!,
          publicKeyPem: cert.public_key_pem,
          version: signatureHeaders.version!,
        });

        if (!isValidSignature) {
          throw AppError.forbidden('Invalid device request signature', {
            reason: 'DEVICE_SIGNATURE_INVALID',
          });
        }
      }

      const [screen] = await db
        .select({ id: schema.screens.id })
        .from(schema.screens)
        .where(eq(schema.screens.id, deviceId));

      if (!screen) {
        throw AppError.notFound('Device not registered', {
          reason: 'DEVICE_NOT_REGISTERED',
          credential_present: true,
        });
      }

      const authMethod = authMode === 'legacy' || !hasSignatureHeaders ? 'legacy_serial' : 'signature';

      request.device = {
        id: deviceId,
        authType: 'device',
        certificateId: cert.id,
        fingerprint: cert.serial,
        authMethod,
      };

      try {
        await recordDeviceAuthRolloutObservation({
          screenId: deviceId,
          channel: 'http',
          method: authMethod === 'signature' ? 'signed' : 'legacy',
        });
      } catch (observationError) {
        // Observation failure must not change a cryptographically valid device
        // authentication result. It is safe to fail closed at rollout time
        // because the missing evidence prevents signature-only promotion.
        logger.warn({ err: observationError, device_id: deviceId }, 'Failed to record device-auth rollout observation');
      }

      recordAuthSuccess(authMethod);
      return { type: 'device' as const };
    }

    if (options.allowUserToken) {
      if (!bearerToken) {
        throw AppError.unauthorized('Missing device identity header', {
          reason: 'MISSING_DEVICE_IDENTITY_HEADER',
        });
      }
      try {
        const payload = await verifyAccessToken(bearerToken);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
        if (!ability.can('read', 'Screen')) {
          throw AppError.forbidden('Forbidden');
        }
        request.device = {
          id: deviceId,
          authType: 'user',
          userId: payload.sub,
        };
        recordAuthSuccess('user_token');
        return { type: 'user' as const };
      } catch (err) {
        if (err instanceof AppError) throw err;
        logger.error(err, 'Device auth user token error');
        throw AppError.unauthorized('Invalid token');
      }
    }

    if (authMode === 'signature') {
      throw AppError.unauthorized('Missing device request signature', {
        reason: 'MISSING_DEVICE_SIGNATURE',
      });
    }

    throw AppError.unauthorized('Missing device identity header', {
      reason: 'MISSING_DEVICE_IDENTITY_HEADER',
    });
  } catch (error) {
    recordDeviceAuthAttempt({
      configuredMode: authMode,
      authMethod: initialAuthMethod,
      result: 'failure',
      reason: normalizeAuthFailureReason(error),
    });
    throw error;
  }
}
