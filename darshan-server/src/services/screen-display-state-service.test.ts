import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeTestServer, createTestServer } from '@/test/helpers';
import { getDatabase, getDatabasePool, schema } from '@/db';
import { recordDisplayProfile, updateDisplaySelection } from './screen-display-state-service';
import type { DisplayProfileV1 } from '@/utils/display-profile';

function profile(overrides: Partial<DisplayProfileV1> = {}): DisplayProfileV1 {
  const session = overrides.runtime_session_id ?? randomUUID();
  const output: NonNullable<DisplayProfileV1['output']> = {
    key: 'platform:1',
    electron_id: '1',
    identity_confidence: 'PLATFORM',
    label: 'Display 1',
    detected: true,
    internal: false,
    primary: true,
    bounds_dip: { x: 0, y: 0, width: 1920, height: 1080 },
    work_area_dip: { x: 0, y: 0, width: 1920, height: 1040 },
    scale_factor: 1,
    estimated_backing_px: { width: 1920, height: 1080 },
    native_mode_px: null,
    rotation_degrees: 0,
    refresh_rate_hz: 60,
    orientation: 'LANDSCAPE',
    aspect: { exact_key: '16:9', numeric_value: 16 / 9, match_key: '16:9', relative_error: 0, normalizer_version: 1 },
  };
  return {
    schema_version: 1,
    runtime_session_id: session,
    observation_seq: 1,
    observed_at: '2026-01-01T00:00:00.000Z',
    selection: {
      mode: 'PRIMARY',
      preferred_key: null,
      active_key: 'platform:1',
      fallback_used: false,
      fallback_reason: null,
    },
    placement: 'VERIFIED',
    output,
    inventory: [output],
    viewport: null,
    ...overrides,
  };
}

describe('screen display state service', () => {
  let server: Awaited<ReturnType<typeof createTestServer>>;

  beforeAll(async () => {
    server = await createTestServer();
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('orders observations, preserves content revision across player restart, and validates pinned selection', async () => {
    const screenId = randomUUID();
    await getDatabase().insert(schema.screens).values({ id: screenId, name: `Display state ${screenId}` });

    const firstProfile = profile();
    const first = await recordDisplayProfile(screenId, firstProfile);
    expect(first.applied).toBe(true);
    expect(first.state.profile_revision).toBe(1);

    const restarted = await recordDisplayProfile(
      screenId,
      profile({ runtime_session_id: randomUUID(), observation_seq: 0, observed_at: '2026-01-01T00:01:00.000Z' }),
    );
    expect(restarted.applied).toBe(true);
    expect(restarted.state.profile_revision).toBe(1);

    const stale = await recordDisplayProfile(
      screenId,
      profile({ runtime_session_id: firstProfile.runtime_session_id, observation_seq: 99, observed_at: '2026-01-01T00:00:30.000Z' }),
    );
    expect(stale).toMatchObject({ applied: false, reason: 'STALE_OBSERVATION' });

    const selected = await updateDisplaySelection(screenId, {
      mode: 'PINNED',
      display_key: 'platform:1',
      expected_profile_revision: restarted.state.profile_revision,
    });
    expect(selected.desired_selection).toEqual({ mode: 'PINNED', preferred_key: 'platform:1' });
    expect(selected.selection_version).toBe(2);
  });

  it('waits for the device lifecycle lock and commits profile plus legacy Screen dimensions together', async () => {
    const db = getDatabase();
    const pool = getDatabasePool();
    if (!pool) throw new Error('PostgreSQL pool is required for display lifecycle tests');
    const screenId = randomUUID();
    await db.insert(schema.screens).values({ id: screenId, name: `Contended display state ${screenId}` });

    const client = await pool.connect();
    let write: ReturnType<typeof recordDisplayProfile> | undefined;
    let settled = false;
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`darshan:device-pairing:${screenId}`],
      );

      write = recordDisplayProfile(screenId, profile()).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(settled).toBe(false);

      await client.query('ROLLBACK');
      const result = await write;
      expect(result.applied).toBe(true);

      const [state] = await db
        .select()
        .from(schema.screenDisplayStates)
        .where(eq(schema.screenDisplayStates.screen_id, screenId));
      const [screen] = await db.select().from(schema.screens).where(eq(schema.screens.id, screenId));
      expect(state.profile_revision).toBe(1);
      expect(screen).toEqual(expect.objectContaining({
        width: 1920,
        height: 1080,
        aspect_ratio: '16:9',
        orientation: 'LANDSCAPE',
      }));
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      await write?.catch(() => undefined);
    }
  });
});
