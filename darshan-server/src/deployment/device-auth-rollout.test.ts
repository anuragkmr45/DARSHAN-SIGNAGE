import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, initializeDatabase, schema } from '@/db';
import {
  getDeviceAuthRolloutStatus,
  recordDeviceAuthRolloutObservation,
} from './device-auth-rollout';

describe('device authentication rollout evidence', () => {
  const screenIds: string[] = [];

  beforeAll(async () => {
    await initializeDatabase();
  });

  afterEach(async () => {
    const db = getDatabase();
    for (const screenId of screenIds.splice(0)) {
      await db.delete(schema.screens).where(eq(schema.screens.id, screenId));
    }
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('does not treat an empty active fleet as signature-only evidence', async () => {
    const status = await getDeviceAuthRolloutStatus({
      since: new Date(Date.now() - 1_000),
      legacyFreeDays: 7,
      screenIds: [randomUUID()],
    });

    expect(status).toMatchObject({
      readyForSignatureOnly: false,
      activeScreenCount: 0,
      blockers: [
        {
          screenId: '__fleet__',
          name: 'Active player fleet',
          reasons: ['no_active_screens'],
        },
      ],
    });
  });

  it('requires signed HTTP and socket evidence after restart and blocks recent legacy use', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    screenIds.push(screenId);
    await db.insert(schema.screens).values({ id: screenId, name: 'Rollout Screen', status: 'ACTIVE' });
    const since = new Date(Date.now() - 1_000);

    let status = await getDeviceAuthRolloutStatus({ since, legacyFreeDays: 7, screenIds: [screenId] });
    expect(status).toMatchObject({
      readyForSignatureOnly: false,
      activeScreenCount: 1,
      blockers: [{ screenId, reasons: ['missing_signed_http_since_restart', 'missing_signed_socket_since_restart'] }],
    });

    await recordDeviceAuthRolloutObservation({ screenId, channel: 'http', method: 'signed' });
    await recordDeviceAuthRolloutObservation({ screenId, channel: 'socket', method: 'signed' });
    status = await getDeviceAuthRolloutStatus({ since, legacyFreeDays: 7, screenIds: [screenId] });
    expect(status.readyForSignatureOnly).toBe(true);

    await recordDeviceAuthRolloutObservation({ screenId, channel: 'http', method: 'legacy' });
    status = await getDeviceAuthRolloutStatus({ since, legacyFreeDays: 7, screenIds: [screenId] });
    expect(status).toMatchObject({
      readyForSignatureOnly: false,
      blockers: [{ screenId, reasons: ['legacy_http_seen_in_window'] }],
    });
  });
});
