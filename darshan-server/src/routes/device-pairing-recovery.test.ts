import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import forge from 'node-forge';
import { eq } from 'drizzle-orm';
import { createTestServer, closeTestServer, testUser } from '@/test/helpers';
import { getDatabase, getDatabasePool, schema } from '@/db';
import { generateAccessToken } from '@/auth/jwt';
import { createSessionRepository } from '@/db/repositories/session';
import { HTTP_STATUS } from '@/http-status-codes';
import * as s3 from '@/s3';

function buildCsrWithDeviceId(deviceId: string) {
  const keyPair = forge.pki.rsa.generateKeyPair(2048);
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = keyPair.publicKey;
  csr.setSubject([{ name: 'commonName', value: deviceId }]);
  csr.sign(keyPair.privateKey, forge.md.sha256.create());
  return forge.pki.certificationRequestToPem(csr);
}

async function issueAdminToken() {
  const db = getDatabase();
  const [adminRole] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'ADMIN')).limit(1);
  if (!adminRole) {
    throw new Error('ADMIN role is required for device pairing recovery tests');
  }

  const currentPermissions =
    adminRole.permissions && typeof adminRole.permissions === 'object'
      ? (adminRole.permissions as { grants?: Array<{ action: string; subject: string }> })
      : {};
  const mergedGrants = [...(currentPermissions.grants || [])];
  for (const grant of [
    { action: 'create', subject: 'DevicePairing' },
    { action: 'create', subject: 'Screen' },
    { action: 'update', subject: 'Screen' },
    { action: 'delete', subject: 'Screen' },
  ]) {
    if (!mergedGrants.some((current) => current.action === grant.action && current.subject === grant.subject)) {
      mergedGrants.push(grant);
    }
  }

  await db
    .update(schema.roles)
    .set({ permissions: { grants: mergedGrants } })
    .where(eq(schema.roles.id, adminRole.id));

  const token = await generateAccessToken(testUser.id, testUser.email, adminRole.id, adminRole.name);
  await createSessionRepository().create({
    user_id: testUser.id,
    access_jti: token.jti,
    expires_at: token.expiresAt,
  });
  return token.token;
}

describe('Device pairing in-place recovery', () => {
  let server: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    vi.spyOn(s3, 'putObject').mockResolvedValue({ sha256: 'test-sha256' } as any);
    server = await createTestServer();
    adminToken = await issueAdminToken();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await closeTestServer(server);
  });

  it('reissues credentials for an existing screen without creating a new device id', async () => {
    const db = getDatabase();
    const deviceId = randomUUID();
    const oldSerial = `serial-${randomUUID()}`;

    await db.insert(schema.screens).values({
      id: deviceId,
      name: 'Recovery Screen',
      status: 'OFFLINE',
    });

    await db.insert(schema.deviceCertificates).values({
      screen_id: deviceId,
      serial: oldSerial,
      certificate_pem: 'old-cert',
      expires_at: new Date(Date.now() + 60_000),
    });

    const generateResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/device-pairing/generate',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        device_id: deviceId,
        expires_in: 600,
      },
    });

    expect(generateResponse.statusCode).toBe(HTTP_STATUS.CREATED);
    const generated = JSON.parse(generateResponse.body);

    const confirmResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/device-pairing/confirm',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        pairing_code: generated.pairing_code,
        name: 'Recovery Screen',
        location: 'Lobby',
      },
    });

    expect(confirmResponse.statusCode).toBe(HTTP_STATUS.OK);

    const completeResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/device-pairing/complete',
      payload: {
        pairing_code: generated.pairing_code,
        csr: buildCsrWithDeviceId(deviceId),
      },
    });

    expect(completeResponse.statusCode).toBe(HTTP_STATUS.CREATED);
    const completed = JSON.parse(completeResponse.body);
    expect(completed.device_id).toBe(deviceId);
    expect(completed.fingerprint).toBeTruthy();

    const certRows = await db
      .select()
      .from(schema.deviceCertificates)
      .where(eq(schema.deviceCertificates.screen_id, deviceId));

    expect(certRows).toHaveLength(2);
    const revokedOld = certRows.find((row) => row.serial === oldSerial);
    const activeNew = certRows.find((row) => row.serial === completed.fingerprint);
    expect(revokedOld?.revoked_at).toBeTruthy();
    expect(revokedOld?.is_revoked).toBe(true);
    expect(activeNew?.revoked_at ?? null).toBeNull();
    expect(activeNew?.public_key_pem).toContain('BEGIN PUBLIC KEY');
    expect(activeNew?.auth_version).toBe('signature_v1');

    const oldHeartbeat = await server.inject({
      method: 'POST',
      url: '/api/v1/device/heartbeat',
      headers: {
        'x-device-serial': oldSerial,
      },
      payload: {
        device_id: deviceId,
        status: 'ONLINE',
        uptime: 100,
        memory_usage: 10,
        cpu_usage: 5,
      },
    });

    expect(oldHeartbeat.statusCode).toBe(HTTP_STATUS.FORBIDDEN);

    const newHeartbeat = await server.inject({
      method: 'POST',
      url: '/api/v1/device/heartbeat',
      headers: {
        'x-device-serial': completed.fingerprint,
      },
      payload: {
        device_id: deviceId,
        status: 'ONLINE',
        uptime: 100,
        memory_usage: 10,
        cpu_usage: 5,
      },
    });

    expect(newHeartbeat.statusCode).toBe(HTTP_STATUS.OK);
  });

  it('starts recovery through the dedicated recovery endpoint', async () => {
    const db = getDatabase();
    const deviceId = randomUUID();

    await db.insert(schema.screens).values({
      id: deviceId,
      name: 'Dedicated Recovery Screen',
      status: 'OFFLINE',
    });

    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/device-pairing/recovery/${deviceId}`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        expires_in: 900,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.CREATED);
    const body = JSON.parse(response.body);
    expect(body.pairing_code).toBeTruthy();
    expect(body.recovery.mode).toBe('RECOVERY');
    expect(body.recovery.device_id).toBe(deviceId);
    expect(body.recovery.screen.id).toBe(deviceId);
    expect(body.diagnostics.recommended_action).toBeTruthy();
  });

  it('requires matching Screen-update and DevicePairing-create grants before retiring recovery codes', async () => {
    const db = getDatabase();
    const permittedScreenId = randomUUID();
    const hiddenScreenId = randomUUID();
    const pairingOnlyRoleId = randomUUID();
    const pairingOnlyUserId = randomUUID();
    const scopedRoleId = randomUUID();
    const scopedUserId = randomUUID();

    await db.insert(schema.screens).values([
      { id: permittedScreenId, name: 'Scoped recovery screen', location: 'Lobby', status: 'OFFLINE' },
      { id: hiddenScreenId, name: 'Hidden recovery screen', status: 'OFFLINE' },
    ]);
    await db.insert(schema.roles).values([
      {
        id: pairingOnlyRoleId,
        name: `PAIRING_ONLY_${pairingOnlyRoleId}`,
        is_system: false,
        permissions: {
          grants: [
            { action: 'create', subject: 'DevicePairing', conditions: { screen_id: permittedScreenId } },
          ],
        },
      },
      {
        id: scopedRoleId,
        name: `SCOPED_RECOVERY_${scopedRoleId}`,
        is_system: false,
        permissions: {
          grants: [
            {
              action: 'update',
              subject: 'Screen',
              conditions: { id: permittedScreenId, location: 'Lobby' },
            },
            { action: 'create', subject: 'DevicePairing', conditions: { screen_id: permittedScreenId } },
            { action: 'manage', subject: 'DevicePairing', conditions: { screen_id: permittedScreenId } },
          ],
        },
      },
    ]);
    const pairingOnlyEmail = `pairing-only-${pairingOnlyUserId}@example.test`;
    const scopedEmail = `scoped-recovery-${scopedUserId}@example.test`;
    await db.insert(schema.users).values([
      {
        id: pairingOnlyUserId,
        email: pairingOnlyEmail,
        password_hash: 'not-used-by-token-test',
        role_id: pairingOnlyRoleId,
        is_active: true,
      },
      {
        id: scopedUserId,
        email: scopedEmail,
        password_hash: 'not-used-by-token-test',
        role_id: scopedRoleId,
        is_active: true,
      },
    ]);
    const pairingOnlyAccess = await generateAccessToken(
      pairingOnlyUserId,
      pairingOnlyEmail,
      pairingOnlyRoleId,
      `PAIRING_ONLY_${pairingOnlyRoleId}`,
    );
    const scopedAccess = await generateAccessToken(
      scopedUserId,
      scopedEmail,
      scopedRoleId,
      `SCOPED_RECOVERY_${scopedRoleId}`,
    );
    await db.insert(schema.sessions).values([
      {
        user_id: pairingOnlyUserId,
        access_jti: pairingOnlyAccess.jti,
        expires_at: pairingOnlyAccess.expiresAt,
      },
      {
        user_id: scopedUserId,
        access_jti: scopedAccess.jti,
        expires_at: scopedAccess.expiresAt,
      },
    ]);

    for (const url of [
      `/api/v1/device-pairing/recovery/${permittedScreenId}`,
      '/api/v1/device-pairing/generate',
    ]) {
      const denied = await server.inject({
        method: 'POST',
        url,
        headers: { authorization: `Bearer ${pairingOnlyAccess.token}` },
        payload: url.endsWith('/generate')
          ? { device_id: permittedScreenId, expires_in: 900 }
          : { expires_in: 900 },
      });
      expect(denied.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    }
    expect(
      await db.select().from(schema.devicePairings).where(eq(schema.devicePairings.device_id, permittedScreenId)),
    ).toHaveLength(0);

    const permitted = await server.inject({
      method: 'POST',
      url: `/api/v1/device-pairing/recovery/${permittedScreenId}`,
      headers: { authorization: `Bearer ${scopedAccess.token}` },
      payload: { expires_in: 900 },
    });
    expect(permitted.statusCode).toBe(HTTP_STATUS.CREATED);
    const permittedBody = JSON.parse(permitted.body);

    const deniedProposal = await server.inject({
      method: 'POST',
      url: '/api/v1/device-pairing/confirm',
      headers: { authorization: `Bearer ${scopedAccess.token}` },
      payload: {
        pairing_code: permittedBody.pairing_code,
        name: 'Scoped recovery screen',
        location: 'Other',
      },
    });
    expect(deniedProposal.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    const [unchangedPairing] = await db
      .select()
      .from(schema.devicePairings)
      .where(eq(schema.devicePairings.id, permittedBody.id));
    expect((unchangedPairing?.device_info as any)?.pairing?.confirmed).not.toBe(true);

    const confirmed = await server.inject({
      method: 'POST',
      url: '/api/v1/device-pairing/confirm',
      headers: { authorization: `Bearer ${scopedAccess.token}` },
      payload: {
        pairing_code: permittedBody.pairing_code,
        name: 'Scoped recovery screen',
        location: 'Lobby',
      },
    });
    expect(confirmed.statusCode).toBe(HTTP_STATUS.OK);

    const revoked = await server.inject({
      method: 'POST',
      url: `/api/v1/device-pairing/${permittedScreenId}/revoke`,
      headers: { authorization: `Bearer ${scopedAccess.token}` },
      payload: { reason: 'scoped_recovery_test' },
    });
    expect(revoked.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(revoked.body).invalidated_pairings).toBe(1);

    const hidden = await server.inject({
      method: 'POST',
      url: `/api/v1/device-pairing/recovery/${hiddenScreenId}`,
      headers: { authorization: `Bearer ${scopedAccess.token}` },
      payload: { expires_in: 900 },
    });
    expect(hidden.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    expect(
      await db.select().from(schema.devicePairings).where(eq(schema.devicePairings.device_id, hiddenScreenId)),
    ).toHaveLength(0);

    const [hiddenPairing] = await db.insert(schema.devicePairings).values({
      device_id: hiddenScreenId,
      pairing_code: `HIDDEN-${randomUUID()}`,
      expires_at: new Date(Date.now() + 60_000),
      used: false,
    }).returning();

    const pairingOnlyList = await server.inject({
      method: 'GET',
      url: '/api/v1/device-pairing?page=1&limit=100',
      headers: { authorization: `Bearer ${pairingOnlyAccess.token}` },
    });
    expect(pairingOnlyList.statusCode).toBe(HTTP_STATUS.FORBIDDEN);

    const scopedList = await server.inject({
      method: 'GET',
      url: '/api/v1/device-pairing?page=1&limit=100',
      headers: { authorization: `Bearer ${scopedAccess.token}` },
    });
    expect(scopedList.statusCode).toBe(HTTP_STATUS.OK);
    const scopedListBody = JSON.parse(scopedList.body);
    expect(scopedListBody.pagination.total).toBe(1);
    expect(scopedListBody.items.map((item: any) => item.device_id)).toEqual([permittedScreenId]);
    expect(scopedListBody.items.some((item: any) => item.id === hiddenPairing.id)).toBe(false);

    const invalidPage = await server.inject({
      method: 'GET',
      url: '/api/v1/device-pairing?page=0&limit=101',
      headers: { authorization: `Bearer ${scopedAccess.token}` },
    });
    expect(invalidPage.statusCode).toBe(HTTP_STATUS.UNPROCESSABLE_CONTENT);

    const hiddenRevoke = await server.inject({
      method: 'POST',
      url: `/api/v1/device-pairing/${hiddenScreenId}/revoke`,
      headers: { authorization: `Bearer ${scopedAccess.token}` },
      payload: { reason: 'must_remain_denied' },
    });
    expect(hiddenRevoke.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    const [unchangedHiddenPairing] = await db
      .select()
      .from(schema.devicePairings)
      .where(eq(schema.devicePairings.id, hiddenPairing.id));
    expect(unchangedHiddenPairing.used).toBe(false);
  });

  it('returns a retryable conflict without mutation when another pairing lifecycle owns the device lock', async () => {
    const db = getDatabase();
    const pool = getDatabasePool();
    if (!pool) throw new Error('PostgreSQL pool is required for pairing lock tests');
    const deviceId = randomUUID();
    await db.insert(schema.screens).values({
      id: deviceId,
      name: 'Contended recovery screen',
      status: 'OFFLINE',
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`darshan:device-pairing:${deviceId}`],
      );

      const contended = await server.inject({
        method: 'POST',
        url: `/api/v1/device-pairing/recovery/${deviceId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { expires_in: 900 },
      });
      expect(contended.statusCode).toBe(HTTP_STATUS.CONFLICT);
      expect(JSON.parse(contended.body).error.message).toMatch(/device lifecycle operation is in progress/i);
      expect(
        await db.select().from(schema.devicePairings).where(eq(schema.devicePairings.device_id, deviceId)),
      ).toHaveLength(0);

      const contendedUpdate = await server.inject({
        method: 'PATCH',
        url: `/api/v1/screens/${deviceId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Must not apply while locked' },
      });
      expect(contendedUpdate.statusCode).toBe(HTTP_STATUS.CONFLICT);
      expect(JSON.parse(contendedUpdate.body).error.message).toMatch(/device lifecycle operation is in progress/i);
      const [unchangedScreen] = await db.select().from(schema.screens).where(eq(schema.screens.id, deviceId));
      expect(unchangedScreen.name).toBe('Contended recovery screen');

      const contendedDisplaySelection = await server.inject({
        method: 'PUT',
        url: `/api/v1/screens/${deviceId}/display-selection`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { mode: 'PRIMARY' },
      });
      expect(contendedDisplaySelection.statusCode).toBe(HTTP_STATUS.CONFLICT);
      expect(JSON.parse(contendedDisplaySelection.body).error.message).toMatch(/device lifecycle operation is in progress/i);

      const contendedScreenshotSettings = await server.inject({
        method: 'POST',
        url: `/api/v1/screens/${deviceId}/screenshot-settings`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { enabled: true, interval_seconds: 30 },
      });
      expect(contendedScreenshotSettings.statusCode).toBe(HTTP_STATUS.CONFLICT);
      expect(JSON.parse(contendedScreenshotSettings.body).error.message).toMatch(/device lifecycle operation is in progress/i);

      const contendedScreenshot = await server.inject({
        method: 'POST',
        url: `/api/v1/screens/${deviceId}/screenshot`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { reason: 'contended_test' },
      });
      expect(contendedScreenshot.statusCode).toBe(HTTP_STATUS.CONFLICT);
      expect(JSON.parse(contendedScreenshot.body).error.message).toMatch(/device lifecycle operation is in progress/i);

      const contendedDirectCommand = await server.inject({
        method: 'POST',
        url: `/api/v1/device/${deviceId}/commands`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { type: 'PING', payload: { reason: 'contended_test' } },
      });
      expect(contendedDirectCommand.statusCode).toBe(HTTP_STATUS.CONFLICT);
      expect(JSON.parse(contendedDirectCommand.body).error.message).toMatch(/device lifecycle operation is in progress/i);

      expect(
        await db.select().from(schema.screenDisplayStates).where(eq(schema.screenDisplayStates.screen_id, deviceId)),
      ).toHaveLength(0);
      expect(
        await db.select().from(schema.deviceCommands).where(eq(schema.deviceCommands.screen_id, deviceId)),
      ).toHaveLength(0);
      const [unchangedScreenshotPolicy] = await db
        .select()
        .from(schema.screens)
        .where(eq(schema.screens.id, deviceId));
      expect(unchangedScreenshotPolicy.screenshot_enabled).toBe(false);
      expect(unchangedScreenshotPolicy.screenshot_interval_seconds).toBeNull();

      const contendedDelete = await server.inject({
        method: 'DELETE',
        url: `/api/v1/screens/${deviceId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(contendedDelete.statusCode).toBe(HTTP_STATUS.CONFLICT);
      expect(JSON.parse(contendedDelete.body).error.message).toMatch(/device lifecycle operation is in progress/i);
      expect(await db.select().from(schema.screens).where(eq(schema.screens.id, deviceId))).toHaveLength(1);

      await client.query('ROLLBACK');

      const updateAfterRelease = await server.inject({
        method: 'PATCH',
        url: `/api/v1/screens/${deviceId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Updated after lock release' },
      });
      expect(updateAfterRelease.statusCode).toBe(HTTP_STATUS.OK);

      const displaySelectionAfterRelease = await server.inject({
        method: 'PUT',
        url: `/api/v1/screens/${deviceId}/display-selection`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { mode: 'PRIMARY' },
      });
      expect(displaySelectionAfterRelease.statusCode).toBe(HTTP_STATUS.OK);
      expect(JSON.parse(displaySelectionAfterRelease.body).command.type).toBe('SET_ACTIVE_DISPLAY');

      const screenshotSettingsAfterRelease = await server.inject({
        method: 'POST',
        url: `/api/v1/screens/${deviceId}/screenshot-settings`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { enabled: true, interval_seconds: 30 },
      });
      expect(screenshotSettingsAfterRelease.statusCode).toBe(HTTP_STATUS.OK);
      expect(JSON.parse(screenshotSettingsAfterRelease.body)).toEqual(expect.objectContaining({
        screen_id: deviceId,
        screenshot_enabled: true,
        screenshot_interval_seconds: 30,
        command_id: expect.any(String),
      }));

      const screenshotAfterRelease = await server.inject({
        method: 'POST',
        url: `/api/v1/screens/${deviceId}/screenshot`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { reason: 'after_lock_release' },
      });
      expect(screenshotAfterRelease.statusCode).toBe(HTTP_STATUS.OK);
      expect(JSON.parse(screenshotAfterRelease.body).command_id).toEqual(expect.any(String));

      const directCommandAfterRelease = await server.inject({
        method: 'POST',
        url: `/api/v1/device/${deviceId}/commands`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { type: 'PING', payload: { reason: 'after_lock_release' } },
      });
      expect(directCommandAfterRelease.statusCode).toBe(HTTP_STATUS.CREATED);
      expect(JSON.parse(directCommandAfterRelease.body)).toEqual(expect.objectContaining({
        screen_id: deviceId,
        type: 'PING',
        status: 'PENDING',
      }));

      const commandsAfterRelease = await db
        .select({ type: schema.deviceCommands.type })
        .from(schema.deviceCommands)
        .where(eq(schema.deviceCommands.screen_id, deviceId));
      expect(commandsAfterRelease.map((command) => command.type).sort()).toEqual([
        'PING',
        'SET_ACTIVE_DISPLAY',
        'SET_SCREENSHOT_INTERVAL',
        'TAKE_SCREENSHOT',
      ]);
      expect(
        await db
          .select()
          .from(schema.deviceCommandStatusHistory)
          .where(eq(schema.deviceCommandStatusHistory.screen_id, deviceId)),
      ).toHaveLength(4);
      expect(
        await db.select().from(schema.commandOutbox).where(eq(schema.commandOutbox.screen_id, deviceId)),
      ).toHaveLength(4);
      expect(
        await db.select().from(schema.deviceDesiredState).where(eq(schema.deviceDesiredState.screen_id, deviceId)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(schema.deviceDesiredStateHistory)
          .where(eq(schema.deviceDesiredStateHistory.screen_id, deviceId)),
      ).toHaveLength(4);

      await db.insert(schema.mediaCacheReports).values({
        screen_id: deviceId,
        event_type: 'SCREEN_DELETE_CLEANUP_TEST',
        reported_at: new Date(),
      });

      const retry = await server.inject({
        method: 'POST',
        url: `/api/v1/device-pairing/recovery/${deviceId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { expires_in: 900 },
      });
      expect(retry.statusCode).toBe(HTTP_STATUS.CREATED);

      const deleteAfterRelease = await server.inject({
        method: 'DELETE',
        url: `/api/v1/screens/${deviceId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(deleteAfterRelease.statusCode).toBe(HTTP_STATUS.OK);
      expect(JSON.parse(deleteAfterRelease.body).cleanup).toEqual(expect.objectContaining({
        command_outbox: 4,
        command_history: 4,
        desired_state_history: 4,
        desired_state: 1,
        display_state: 1,
        device_commands: 4,
        media_cache_reports: 1,
      }));
      expect(await db.select().from(schema.screens).where(eq(schema.screens.id, deviceId))).toHaveLength(0);
      expect(
        await db.select().from(schema.devicePairings).where(eq(schema.devicePairings.device_id, deviceId)),
      ).toHaveLength(0);
      expect(
        await db.select().from(schema.deviceCommands).where(eq(schema.deviceCommands.screen_id, deviceId)),
      ).toHaveLength(0);
      expect(
        await db.select().from(schema.screenDisplayStates).where(eq(schema.screenDisplayStates.screen_id, deviceId)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(schema.deviceCommandStatusHistory)
          .where(eq(schema.deviceCommandStatusHistory.screen_id, deviceId)),
      ).toHaveLength(0);
      expect(
        await db.select().from(schema.commandOutbox).where(eq(schema.commandOutbox.screen_id, deviceId)),
      ).toHaveLength(0);
      expect(
        await db.select().from(schema.deviceDesiredState).where(eq(schema.deviceDesiredState.screen_id, deviceId)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(schema.deviceDesiredStateHistory)
          .where(eq(schema.deviceDesiredStateHistory.screen_id, deviceId)),
      ).toHaveLength(0);
      expect(
        await db.select().from(schema.mediaCacheReports).where(eq(schema.mediaCacheReports.screen_id, deviceId)),
      ).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
});
