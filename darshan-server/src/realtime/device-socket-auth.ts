import { createVerify } from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { config } from '@/config';
import { getDatabase, schema } from '@/db';
import {
  checkDeviceSocketReplay,
  type DeviceSocketReplayReason,
  type DeviceSocketReplayStore,
} from '@/realtime/device-socket-replay';
import {
  DEVICE_REQUEST_SIGNATURE_VERSION,
  isDeviceLegacyAuthCompatibilityActive,
} from '@/utils/device-request-auth';

export const DEVICE_SOCKET_SIGNATURE_PREFIX = 'DARSHAN_DEVICE_SOCKET_AUTH_V1';
export const DEVICE_SOCKET_SIGNATURE_ACTION = 'CONNECT';
export const DEVICE_SOCKET_SIGNATURE_NAMESPACE = '/device';

export type DeviceSocketAuthMode = 'legacy' | 'signed' | 'unknown';
export type DeviceSocketAuthReason =
  | 'authorized'
  | 'missing_identity'
  | 'legacy_disabled'
  | 'signed_disabled'
  | 'missing_signature'
  | 'malformed_auth'
  | 'signature_invalid'
  | 'signature_expired'
  | 'signature_unavailable'
  | 'invalid_credentials'
  | 'device_not_registered'
  | 'replay_detected'
  | 'replay_store_unavailable'
  | 'replay_store_error'
  | 'unknown';

export type DeviceSocketAuthSuccess = {
  ok: true;
  mode: 'legacy' | 'signed';
  reason: 'authorized';
  deviceId: string;
  serial: string;
  certificateId: string;
};

export type DeviceSocketAuthFailure = {
  ok: false;
  mode: DeviceSocketAuthMode;
  reason: Exclude<DeviceSocketAuthReason, 'authorized'>;
};

export type DeviceSocketAuthResult = DeviceSocketAuthSuccess | DeviceSocketAuthFailure;

type DeviceSocketAuthConfig = {
  legacyAuthAllowed: boolean;
  signedAuthEnabled: boolean;
  maxClockSkewMs: number;
  replayProtectionEnabled: boolean;
  replayCacheTtlMs: number;
  replayFailClosed: boolean;
};

export type DeviceSocketHandshakeInput = {
  auth?: Record<string, unknown> | null;
  query?: Record<string, unknown> | null;
  headers?: Record<string, unknown> | null;
};

export type DeviceSocketAuthOptions = {
  config?: Partial<DeviceSocketAuthConfig>;
  nowMs?: () => number;
  replayStore?: DeviceSocketReplayStore;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hexNoncePattern = /^[0-9a-fA-F]{32,128}$/;
const base64UrlNoncePattern = /^[A-Za-z0-9_-]{22,172}$/;
const base64SignaturePattern = /^[A-Za-z0-9+/]{64,2048}={0,2}$/;
const timestampPattern = /^\d{10,17}$/;

const signedAuthFieldNames = ['auth_version', 'auth_timestamp', 'auth_nonce', 'auth_signature'] as const;

function resolveAuthConfig(overrides?: Partial<DeviceSocketAuthConfig>): DeviceSocketAuthConfig {
  return {
    legacyAuthAllowed:
      overrides?.legacyAuthAllowed ??
      (config.DEVICE_SOCKET_LEGACY_AUTH_ALLOWED && isDeviceLegacyAuthCompatibilityActive()),
    signedAuthEnabled: overrides?.signedAuthEnabled ?? config.DEVICE_SOCKET_SIGNED_AUTH_ENABLED,
    maxClockSkewMs: overrides?.maxClockSkewMs ?? config.DEVICE_SOCKET_AUTH_MAX_CLOCK_SKEW_MS,
    replayProtectionEnabled:
      overrides?.replayProtectionEnabled ?? config.DEVICE_SOCKET_AUTH_REPLAY_PROTECTION_ENABLED,
    replayCacheTtlMs: overrides?.replayCacheTtlMs ?? config.DEVICE_SOCKET_AUTH_REPLAY_CACHE_TTL_MS,
    replayFailClosed: overrides?.replayFailClosed ?? config.DEVICE_SOCKET_AUTH_REPLAY_FAIL_CLOSED,
  };
}

function stringFromHandshake(value: unknown) {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim().length > 0) return value[0].trim();
  return null;
}

function hasControlCharacters(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isSafeShortString(value: string, maxLength: number) {
  return value.length > 0 && value.length <= maxLength && !hasControlCharacters(value);
}

function isValidTimestamp(value: string) {
  return timestampPattern.test(value);
}

function isValidNonce(value: string) {
  return !hasControlCharacters(value) && (hexNoncePattern.test(value) || base64UrlNoncePattern.test(value));
}

function isValidSignature(value: string) {
  return !hasControlCharacters(value) && base64SignaturePattern.test(value);
}

function hasSignedAuthFields(auth: Record<string, unknown>) {
  return signedAuthFieldNames.some((field) => stringFromHandshake(auth[field]) !== null);
}

function readLegacyIdentity(input: DeviceSocketHandshakeInput) {
  const auth = input.auth ?? {};
  const query = input.query ?? {};
  const headers = input.headers ?? {};
  return {
    deviceId: stringFromHandshake(auth.device_id) ?? stringFromHandshake(query.device_id),
    serial:
      stringFromHandshake(auth.device_serial) ??
      stringFromHandshake(auth.serial) ??
      stringFromHandshake(headers['x-device-serial']),
  };
}

function readSignedIdentity(input: DeviceSocketHandshakeInput) {
  const auth = input.auth ?? {};
  return {
    deviceId: stringFromHandshake(auth.device_id),
    serial: stringFromHandshake(auth.device_serial),
    version: stringFromHandshake(auth.auth_version),
    timestamp: stringFromHandshake(auth.auth_timestamp),
    nonce: stringFromHandshake(auth.auth_nonce),
    signature: stringFromHandshake(auth.auth_signature),
  };
}

function validateIdentityShape(deviceId: string, serial: string) {
  return (
    uuidPattern.test(deviceId) &&
    isSafeShortString(serial, 255)
  );
}

function buildFailure(mode: DeviceSocketAuthMode, reason: Exclude<DeviceSocketAuthReason, 'authorized'>): DeviceSocketAuthFailure {
  return { ok: false, mode, reason };
}

function authReasonForReplayFailure(reason: DeviceSocketReplayReason): Exclude<DeviceSocketAuthReason, 'authorized'> {
  if (reason === 'replay_detected') return 'replay_detected';
  if (reason === 'store_unavailable') return 'replay_store_unavailable';
  if (reason === 'store_error') return 'replay_store_error';
  return 'unknown';
}

export function buildDeviceSocketSignaturePayload(input: {
  deviceId: string;
  serial: string;
  timestamp: string;
  nonce: string;
}) {
  return [
    DEVICE_SOCKET_SIGNATURE_PREFIX,
    DEVICE_SOCKET_SIGNATURE_ACTION,
    DEVICE_SOCKET_SIGNATURE_NAMESPACE,
    input.deviceId,
    input.serial,
    input.timestamp,
    input.nonce,
  ].join('\n');
}

function verifyDeviceSocketSignature(input: {
  publicKeyPem: string;
  deviceId: string;
  serial: string;
  timestamp: string;
  nonce: string;
  signature: string;
}) {
  try {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(
      buildDeviceSocketSignaturePayload({
        deviceId: input.deviceId,
        serial: input.serial,
        timestamp: input.timestamp,
        nonce: input.nonce,
      })
    );
    verifier.end();
    return verifier.verify(input.publicKeyPem, input.signature, 'base64');
  } catch {
    return false;
  }
}

async function loadActiveCertificate(deviceId: string, serial: string) {
  const db = getDatabase();
  const certificates = await db
    .select()
    .from(schema.deviceCertificates)
    .where(eq(schema.deviceCertificates.screen_id, deviceId))
    .orderBy(desc(schema.deviceCertificates.created_at));

  const cert = certificates.find((entry) => entry.serial === serial) ?? null;
  if (!cert || cert.is_revoked || cert.revoked_at || cert.expires_at.getTime() <= Date.now()) {
    return null;
  }
  return cert;
}

async function deviceExists(deviceId: string) {
  const db = getDatabase();
  const [screen] = await db.select({ id: schema.screens.id }).from(schema.screens).where(eq(schema.screens.id, deviceId));
  return Boolean(screen);
}

async function authenticateLegacy(input: DeviceSocketHandshakeInput, authConfig: DeviceSocketAuthConfig): Promise<DeviceSocketAuthResult> {
  if (!authConfig.legacyAuthAllowed) {
    return buildFailure('legacy', 'legacy_disabled');
  }

  const identity = readLegacyIdentity(input);
  if (!identity.deviceId || !identity.serial) {
    return buildFailure('legacy', 'missing_identity');
  }
  if (!validateIdentityShape(identity.deviceId, identity.serial)) {
    return buildFailure('legacy', 'malformed_auth');
  }

  const cert = await loadActiveCertificate(identity.deviceId, identity.serial);
  if (!cert) {
    return buildFailure('legacy', 'invalid_credentials');
  }

  if (!(await deviceExists(identity.deviceId))) {
    return buildFailure('legacy', 'device_not_registered');
  }

  return {
    ok: true,
    mode: 'legacy',
    reason: 'authorized',
    deviceId: identity.deviceId,
    serial: identity.serial,
    certificateId: cert.id,
  };
}

async function authenticateSigned(
  input: DeviceSocketHandshakeInput,
  authConfig: DeviceSocketAuthConfig,
  nowMs: () => number,
  replayStore?: DeviceSocketReplayStore
): Promise<DeviceSocketAuthResult> {
  if (!authConfig.signedAuthEnabled) {
    return buildFailure('signed', 'signed_disabled');
  }

  const signed = readSignedIdentity(input);
  if (!signed.deviceId || !signed.serial) {
    return buildFailure('signed', 'missing_identity');
  }
  if (!signed.version || !signed.timestamp || !signed.nonce || !signed.signature) {
    return buildFailure('signed', 'malformed_auth');
  }
  if (!validateIdentityShape(signed.deviceId, signed.serial)) {
    return buildFailure('signed', 'malformed_auth');
  }
  if (signed.version !== DEVICE_REQUEST_SIGNATURE_VERSION) {
    return buildFailure('signed', 'malformed_auth');
  }
  if (!isValidTimestamp(signed.timestamp) || !isValidNonce(signed.nonce) || !isValidSignature(signed.signature)) {
    return buildFailure('signed', 'malformed_auth');
  }

  const timestampMs = Number.parseInt(signed.timestamp, 10);
  if (!Number.isSafeInteger(timestampMs) || Math.abs(nowMs() - timestampMs) > authConfig.maxClockSkewMs) {
    return buildFailure('signed', 'signature_expired');
  }

  const cert = await loadActiveCertificate(signed.deviceId, signed.serial);
  if (!cert) {
    return buildFailure('signed', 'invalid_credentials');
  }

  if (!(await deviceExists(signed.deviceId))) {
    return buildFailure('signed', 'device_not_registered');
  }

  if (!cert.public_key_pem) {
    return buildFailure('signed', 'signature_unavailable');
  }

  const verified = verifyDeviceSocketSignature({
    publicKeyPem: cert.public_key_pem,
    deviceId: signed.deviceId,
    serial: signed.serial,
    timestamp: signed.timestamp,
    nonce: signed.nonce,
    signature: signed.signature,
  });
  if (!verified) {
    return buildFailure('signed', 'signature_invalid');
  }

  const replay = await checkDeviceSocketReplay(
    {
      deviceId: signed.deviceId,
      serial: signed.serial,
      nonce: signed.nonce,
    },
    {
      enabled: authConfig.replayProtectionEnabled,
      ttlMs: authConfig.replayCacheTtlMs,
      failClosed: authConfig.replayFailClosed,
      store: replayStore,
    }
  );
  if (!replay.ok) {
    return buildFailure('signed', authReasonForReplayFailure(replay.reason));
  }

  return {
    ok: true,
    mode: 'signed',
    reason: 'authorized',
    deviceId: signed.deviceId,
    serial: signed.serial,
    certificateId: cert.id,
  };
}

export async function authenticateDeviceSocketHandshake(
  input: DeviceSocketHandshakeInput,
  options: DeviceSocketAuthOptions = {}
): Promise<DeviceSocketAuthResult> {
  const authConfig = resolveAuthConfig(options.config);
  const auth = input.auth ?? {};
  if (hasSignedAuthFields(auth)) {
    return authenticateSigned(input, authConfig, options.nowMs ?? Date.now, options.replayStore);
  }
  return authenticateLegacy(input, authConfig);
}
