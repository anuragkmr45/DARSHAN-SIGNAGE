import { createSign, generateKeyPairSync, randomBytes, randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { config } from '@/config';
import { getDatabase, schema } from '@/db';
import {
  authenticateDeviceSocketHandshake,
  buildDeviceSocketSignaturePayload,
} from '@/realtime/device-socket-auth';
import { buildDeviceRequestSignaturePayload } from '@/utils/device-request-auth';
import { closeTestServer, createTestServer } from '@/test/helpers';
import type { FastifyInstance } from 'fastify';

function generateKeys() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function signPayload(privateKey: string, payload: string) {
  const signer = createSign('RSA-SHA256');
  signer.update(payload);
  signer.end();
  return signer.sign(privateKey, 'base64');
}

function signedSocketAuth(input: {
  deviceId: string;
  serial: string;
  privateKey: string;
  timestamp?: string;
  nonce?: string;
  signature?: string;
}) {
  const timestamp = input.timestamp ?? Date.now().toString();
  const nonce = input.nonce ?? randomBytes(16).toString('hex');
  const signature =
    input.signature ??
    signPayload(
      input.privateKey,
      buildDeviceSocketSignaturePayload({
        deviceId: input.deviceId,
        serial: input.serial,
        timestamp,
        nonce,
      })
    );
  return {
    device_id: input.deviceId,
    device_serial: input.serial,
    auth_version: 'v1',
    auth_timestamp: timestamp,
    auth_nonce: nonce,
    auth_signature: signature,
  };
}

async function seedDevice(options: {
  publicKeyPem?: string | null;
  isRevoked?: boolean;
  expiresAt?: Date;
  insertScreen?: boolean;
} = {}) {
  const db = getDatabase();
  const deviceId = randomUUID();
  const serial = `socket-auth-${randomUUID()}`;

  if (options.insertScreen !== false) {
    await db.insert(schema.screens).values({
      id: deviceId,
      name: 'Socket Auth Device',
      status: 'OFFLINE',
    });
  }

  await db.insert(schema.deviceCertificates).values({
    screen_id: deviceId,
    serial,
    certificate_pem: 'test-cert',
    public_key_pem: options.publicKeyPem ?? null,
    auth_version: options.publicKeyPem ? 'signature_v1' : 'legacy',
    is_revoked: options.isRevoked ?? false,
    revoked_at: options.isRevoked ? new Date() : null,
    expires_at: options.expiresAt ?? new Date(Date.now() + 60_000),
  });

  return { deviceId, serial };
}

describe('device socket auth verifier', () => {
  let server: FastifyInstance;
  const seededDeviceIds: string[] = [];

  beforeAll(async () => {
    server = await createTestServer();
  });

  afterEach(async () => {
    const db = getDatabase();
    for (const deviceId of seededDeviceIds.splice(0)) {
      await db.delete(schema.deviceCertificates).where(eq(schema.deviceCertificates.screen_id, deviceId));
      await db.delete(schema.screens).where(eq(schema.screens.id, deviceId));
    }
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  async function seedTrackedDevice(options?: Parameters<typeof seedDevice>[0]) {
    const device = await seedDevice(options);
    seededDeviceIds.push(device.deviceId);
    return device;
  }

  it('exposes backward-compatible socket auth config defaults', () => {
    expect(config.DEVICE_SOCKET_LEGACY_AUTH_ALLOWED).toBe(true);
    expect(config.DEVICE_SOCKET_SIGNED_AUTH_ENABLED).toBe(true);
    expect(config.DEVICE_SOCKET_AUTH_MAX_CLOCK_SKEW_MS).toBe(300_000);
    expect('DEVICE_SOCKET_SIGNED_AUTH_REQUIRED' in config).toBe(false);
  });

  it('allows legacy auth by default, including old certificate rows without public_key_pem', async () => {
    const { deviceId, serial } = await seedTrackedDevice({ publicKeyPem: null });

    const result = await authenticateDeviceSocketHandshake({
      auth: {
        device_id: deviceId,
        device_serial: serial,
      },
    });

    expect(result).toMatchObject({
      ok: true,
      mode: 'legacy',
      reason: 'authorized',
      deviceId,
      serial,
    });
  });

  it('rejects legacy auth when legacy socket auth is disabled', async () => {
    const { deviceId, serial } = await seedTrackedDevice({ publicKeyPem: null });

    const result = await authenticateDeviceSocketHandshake(
      {
        auth: {
          device_id: deviceId,
          device_serial: serial,
        },
      },
      { config: { legacyAuthAllowed: false } }
    );

    expect(result).toEqual({
      ok: false,
      mode: 'legacy',
      reason: 'legacy_disabled',
    });
  });

  it('accepts signed auth with a valid socket-specific RSA signature', async () => {
    const keys = generateKeys();
    const { deviceId, serial } = await seedTrackedDevice({ publicKeyPem: keys.publicKey });

    const result = await authenticateDeviceSocketHandshake({
      auth: signedSocketAuth({
        deviceId,
        serial,
        privateKey: keys.privateKey,
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      mode: 'signed',
      reason: 'authorized',
      deviceId,
      serial,
    });
  });

  it('rejects signed auth with a bad signature', async () => {
    const keys = generateKeys();
    const otherKeys = generateKeys();
    const { deviceId, serial } = await seedTrackedDevice({ publicKeyPem: keys.publicKey });
    const timestamp = Date.now().toString();
    const nonce = randomBytes(16).toString('hex');

    const result = await authenticateDeviceSocketHandshake({
      auth: signedSocketAuth({
        deviceId,
        serial,
        privateKey: keys.privateKey,
        timestamp,
        nonce,
        signature: signPayload(
          otherKeys.privateKey,
          buildDeviceSocketSignaturePayload({
            deviceId,
            serial,
            timestamp,
            nonce,
          })
        ),
      }),
    });

    expect(result).toEqual({
      ok: false,
      mode: 'signed',
      reason: 'signature_invalid',
    });
  });

  it('rejects signed auth with expired or future timestamps outside skew', async () => {
    const keys = generateKeys();
    const { deviceId, serial } = await seedTrackedDevice({ publicKeyPem: keys.publicKey });
    const now = Date.now();

    const expired = await authenticateDeviceSocketHandshake(
      {
        auth: signedSocketAuth({
          deviceId,
          serial,
          privateKey: keys.privateKey,
          timestamp: String(now - 301_000),
        }),
      },
      { nowMs: () => now }
    );
    const future = await authenticateDeviceSocketHandshake(
      {
        auth: signedSocketAuth({
          deviceId,
          serial,
          privateKey: keys.privateKey,
          timestamp: String(now + 301_000),
        }),
      },
      { nowMs: () => now }
    );

    expect(expired).toEqual({ ok: false, mode: 'signed', reason: 'signature_expired' });
    expect(future).toEqual({ ok: false, mode: 'signed', reason: 'signature_expired' });
  });

  it('rejects signed auth for unknown, revoked, expired, or public-keyless credentials', async () => {
    const keys = generateKeys();
    const unknownDeviceId = randomUUID();
    const unknown = await authenticateDeviceSocketHandshake({
      auth: signedSocketAuth({
        deviceId: unknownDeviceId,
        serial: `socket-auth-${randomUUID()}`,
        privateKey: keys.privateKey,
      }),
    });

    const revoked = await seedTrackedDevice({ publicKeyPem: keys.publicKey, isRevoked: true });
    const revokedResult = await authenticateDeviceSocketHandshake({
      auth: signedSocketAuth({
        deviceId: revoked.deviceId,
        serial: revoked.serial,
        privateKey: keys.privateKey,
      }),
    });

    const expired = await seedTrackedDevice({
      publicKeyPem: keys.publicKey,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const expiredResult = await authenticateDeviceSocketHandshake({
      auth: signedSocketAuth({
        deviceId: expired.deviceId,
        serial: expired.serial,
        privateKey: keys.privateKey,
      }),
    });

    const publicKeyless = await seedTrackedDevice({ publicKeyPem: null });
    const publicKeylessResult = await authenticateDeviceSocketHandshake({
      auth: signedSocketAuth({
        deviceId: publicKeyless.deviceId,
        serial: publicKeyless.serial,
        privateKey: keys.privateKey,
      }),
    });

    expect(unknown).toEqual({ ok: false, mode: 'signed', reason: 'invalid_credentials' });
    expect(revokedResult).toEqual({ ok: false, mode: 'signed', reason: 'invalid_credentials' });
    expect(expiredResult).toEqual({ ok: false, mode: 'signed', reason: 'invalid_credentials' });
    expect(publicKeylessResult).toEqual({ ok: false, mode: 'signed', reason: 'signature_unavailable' });
  });

  it('rejects signed auth when the certificate exists but the device screen row is missing', async () => {
    const keys = generateKeys();
    const { deviceId, serial } = await seedTrackedDevice({
      publicKeyPem: keys.publicKey,
      insertScreen: false,
    });

    const result = await authenticateDeviceSocketHandshake({
      auth: signedSocketAuth({
        deviceId,
        serial,
        privateKey: keys.privateKey,
      }),
    });

    expect(result).toEqual({
      ok: false,
      mode: 'signed',
      reason: 'device_not_registered',
    });
  });

  it('rejects signed auth when signed auth is disabled', async () => {
    const keys = generateKeys();
    const { deviceId, serial } = await seedTrackedDevice({ publicKeyPem: keys.publicKey });

    const result = await authenticateDeviceSocketHandshake(
      {
        auth: signedSocketAuth({
          deviceId,
          serial,
          privateKey: keys.privateKey,
        }),
      },
      { config: { signedAuthEnabled: false } }
    );

    expect(result).toEqual({
      ok: false,
      mode: 'signed',
      reason: 'signed_disabled',
    });
  });

  it('rejects partial signed fields, invalid nonce, and control characters as malformed', async () => {
    const keys = generateKeys();
    const { deviceId, serial } = await seedTrackedDevice({ publicKeyPem: keys.publicKey });

    const partial = await authenticateDeviceSocketHandshake({
      auth: {
        device_id: deviceId,
        device_serial: serial,
        auth_version: 'v1',
      },
    });
    const shortNonce = await authenticateDeviceSocketHandshake({
      auth: signedSocketAuth({
        deviceId,
        serial,
        privateKey: keys.privateKey,
        nonce: 'short',
      }),
    });
    const controlCharacter = await authenticateDeviceSocketHandshake({
      auth: {
        ...signedSocketAuth({
          deviceId,
          serial,
          privateKey: keys.privateKey,
        }),
        device_serial: `${serial}\nextra`,
      },
    });

    expect(partial).toEqual({ ok: false, mode: 'signed', reason: 'malformed_auth' });
    expect(shortNonce).toEqual({ ok: false, mode: 'signed', reason: 'malformed_auth' });
    expect(controlCharacter).toEqual({ ok: false, mode: 'signed', reason: 'malformed_auth' });
  });

  it('rejects signatures over the HTTP canonical payload', async () => {
    const keys = generateKeys();
    const { deviceId, serial } = await seedTrackedDevice({ publicKeyPem: keys.publicKey });
    const timestamp = Date.now().toString();
    const nonce = randomBytes(16).toString('hex');
    const httpSignature = signPayload(
      keys.privateKey,
      buildDeviceRequestSignaturePayload({
        method: 'CONNECT',
        url: '/device',
        deviceId,
        timestamp,
      })
    );

    const result = await authenticateDeviceSocketHandshake({
      auth: signedSocketAuth({
        deviceId,
        serial,
        privateKey: keys.privateKey,
        timestamp,
        nonce,
        signature: httpSignature,
      }),
    });

    expect(result).toEqual({
      ok: false,
      mode: 'signed',
      reason: 'signature_invalid',
    });
  });

  it('does not expose raw signed auth fields in failure results', async () => {
    const keys = generateKeys();
    const otherKeys = generateKeys();
    const { deviceId, serial } = await seedTrackedDevice({ publicKeyPem: keys.publicKey });
    const timestamp = Date.now().toString();
    const nonce = randomBytes(16).toString('hex');
    const auth = signedSocketAuth({
      deviceId,
      serial,
      privateKey: keys.privateKey,
      timestamp,
      nonce,
      signature: signPayload(
        otherKeys.privateKey,
        buildDeviceSocketSignaturePayload({
          deviceId,
          serial,
          timestamp,
          nonce,
        })
      ),
    });

    const result = await authenticateDeviceSocketHandshake({ auth });
    const encodedResult = JSON.stringify(result);

    expect(encodedResult).not.toContain(serial);
    expect(encodedResult).not.toContain(auth.auth_nonce);
    expect(encodedResult).not.toContain(auth.auth_signature);
    expect(encodedResult).not.toContain(deviceId);
    expect(result).toEqual({ ok: false, mode: 'signed', reason: 'signature_invalid' });
  });
});
