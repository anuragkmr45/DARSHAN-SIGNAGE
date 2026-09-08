import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closeTestServer, createTestServer } from '@/test/helpers';
import { getDatabase, schema } from '@/db';
import { buildNativeDeviceRequestSignaturePayload } from '@/utils/device-request-auth';

describe('native device request authentication', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await createTestServer();
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('accepts a P-256 signed request once and rejects nonce replay or changed paths', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const installationId = randomUUID();
    const credentialId = randomUUID();
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    await db.insert(schema.screens).values({ id: screenId, name: 'Native Auth Screen', status: 'OFFLINE' });
    await db.insert(schema.deviceCredentials).values({
      credential_id: credentialId,
      screen_id: screenId,
      installation_id: installationId,
      installation_epoch: 1,
      algorithm: 'ES256',
      public_key_pem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      trust_level: 'UNVERIFIED',
    });

    const url = `/api/v1/device/${screenId}/pairing-status`;
    const timestamp = String(Date.now());
    const nonce = 'native-auth-nonce-0001';
    const payload = buildNativeDeviceRequestSignaturePayload({
      method: 'GET',
      url,
      deviceId: screenId,
      credentialId,
      timestamp,
      nonce,
      body: undefined,
    });
    // Matches iOS SecKey's fixed-width X9.62/P1363 ECDSA output rather than
    // OpenSSL's default DER output used by Android's Signature API.
    const signature = sign('sha256', Buffer.from(payload), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
    const headers = {
      'x-device-credential-id': credentialId,
      'x-device-auth-version': 'v2',
      'x-device-timestamp': timestamp,
      'x-device-nonce': nonce,
      'x-device-signature': signature,
    };

    const accepted = await server.inject({ method: 'GET', url, headers });
    expect(accepted.statusCode).toBe(200);

    const replay = await server.inject({ method: 'GET', url, headers });
    expect(replay.statusCode).toBe(403);
    expect(JSON.parse(replay.body).error.details.reason).toBe('NATIVE_DEVICE_SIGNATURE_REPLAYED');

    const tampered = await server.inject({
      method: 'GET',
      url: `${url}?unexpected=true`,
      headers: { ...headers, 'x-device-nonce': 'native-auth-nonce-0002' },
    });
    expect(tampered.statusCode).toBe(401);
    expect(JSON.parse(tampered.body).error.details.reason).toBe('NATIVE_DEVICE_SIGNATURE_INVALID');
  });
});
