import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDatabase, schema, type Database } from '@/db';

export type DeviceAuthObservationChannel = 'http' | 'socket';
export type DeviceAuthObservationMethod = 'signed' | 'legacy';

export type DeviceAuthRolloutBlocker = {
  screenId: string;
  name: string;
  reasons: string[];
};

export type DeviceAuthRolloutStatus = {
  readyForSignatureOnly: boolean;
  activeScreenCount: number;
  since: string;
  legacyFreeDays: number;
  legacyCutoff: string;
  blockers: DeviceAuthRolloutBlocker[];
};

const observationColumn: Record<`${DeviceAuthObservationMethod}:${DeviceAuthObservationChannel}`, string> = {
  'signed:http': 'last_signed_http_at',
  'signed:socket': 'last_signed_socket_at',
  'legacy:http': 'last_legacy_http_at',
  'legacy:socket': 'last_legacy_socket_at',
};

/**
 * Preserve only the latest successful authentication for each channel and
 * method. This makes fleet-rollout decisions durable without storing every
 * request or creating unbounded metrics labels.
 */
export async function recordDeviceAuthRolloutObservation(input: {
  screenId: string;
  channel: DeviceAuthObservationChannel;
  method: DeviceAuthObservationMethod;
}): Promise<void> {
  const column = observationColumn[`${input.method}:${input.channel}`];
  // `column` comes only from the closed map above. The screen id remains a
  // bound parameter, so a caller cannot affect the SQL structure.
  const columnIdentifier = sql.raw(column);
  await getDatabase().execute(sql`
    INSERT INTO device_auth_rollout_observations (screen_id, ${columnIdentifier}, updated_at)
    VALUES (${input.screenId}, now(), now())
    ON CONFLICT (screen_id) DO UPDATE
      SET ${columnIdentifier} = EXCLUDED.${columnIdentifier}, updated_at = now()
  `);
}

export async function getDeviceAuthRolloutStatus(input: {
  since: Date;
  legacyFreeDays: number;
  /** Internal/test scope only; production CLI always evaluates the whole active fleet. */
  screenIds?: string[];
  db?: Database;
}): Promise<DeviceAuthRolloutStatus> {
  if (!Number.isInteger(input.legacyFreeDays) || input.legacyFreeDays < 1 || input.legacyFreeDays > 365) {
    throw new Error('legacyFreeDays must be an integer from 1 to 365');
  }
  const legacyCutoff = new Date(Date.now() - input.legacyFreeDays * 24 * 60 * 60 * 1000);
  const db = input.db ?? getDatabase();
  const rows = await db
    .select({
      screenId: schema.screens.id,
      name: schema.screens.name,
      lastSignedHttpAt: schema.deviceAuthRolloutObservations.last_signed_http_at,
      lastSignedSocketAt: schema.deviceAuthRolloutObservations.last_signed_socket_at,
      lastLegacyHttpAt: schema.deviceAuthRolloutObservations.last_legacy_http_at,
      lastLegacySocketAt: schema.deviceAuthRolloutObservations.last_legacy_socket_at,
    })
    .from(schema.screens)
    .leftJoin(
      schema.deviceAuthRolloutObservations,
      eq(schema.deviceAuthRolloutObservations.screen_id, schema.screens.id)
    )
    .where(
      input.screenIds && input.screenIds.length > 0
        ? and(eq(schema.screens.status, 'ACTIVE'), inArray(schema.screens.id, input.screenIds))
        : eq(schema.screens.status, 'ACTIVE')
    );

  const screenBlockers = rows.flatMap((row) => {
    const reasons: string[] = [];
    if (!row.lastSignedHttpAt || row.lastSignedHttpAt < input.since) reasons.push('missing_signed_http_since_restart');
    if (!row.lastSignedSocketAt || row.lastSignedSocketAt < input.since) reasons.push('missing_signed_socket_since_restart');
    if (row.lastLegacyHttpAt && row.lastLegacyHttpAt >= legacyCutoff) reasons.push('legacy_http_seen_in_window');
    if (row.lastLegacySocketAt && row.lastLegacySocketAt >= legacyCutoff) reasons.push('legacy_socket_seen_in_window');
    return reasons.length > 0 ? [{ screenId: row.screenId, name: row.name, reasons }] : [];
  });
  const blockers =
    rows.length === 0
      ? [{ screenId: '__fleet__', name: 'Active player fleet', reasons: ['no_active_screens'] }]
      : screenBlockers;

  return {
    readyForSignatureOnly: rows.length > 0 && blockers.length === 0,
    activeScreenCount: rows.length,
    since: input.since.toISOString(),
    legacyFreeDays: input.legacyFreeDays,
    legacyCutoff: legacyCutoff.toISOString(),
    blockers,
  };
}
