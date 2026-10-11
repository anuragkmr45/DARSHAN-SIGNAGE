import { sql } from 'drizzle-orm';
import { getDatabase } from '../db/index.js';
import { listDuplicateIdentityConflicts, } from './device-identity-session-service.js';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
function normalizeLimit(limit) {
    if (!Number.isFinite(limit) || !limit || limit <= 0)
        return DEFAULT_LIMIT;
    return Math.min(Math.trunc(limit), MAX_LIMIT);
}
function rowsFromResult(result) {
    if (result && typeof result === 'object' && Array.isArray(result.rows)) {
        return result.rows;
    }
    return [];
}
function toNumber(value) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}
function toIso(value) {
    if (value instanceof Date)
        return value.toISOString();
    if (typeof value === 'string' && value.trim().length > 0)
        return new Date(value).toISOString();
    return null;
}
export async function detectDevicePairingOrphans(options = {}) {
    const db = getDatabase();
    const limit = normalizeLimit(options.limit);
    const [certificateRowsResult, pairingRowsResult, heartbeatRowsResult, commandRowsResult, certificateCountResult, pairingCountResult, heartbeatCountResult, commandCountResult, duplicateIdentityReport,] = await Promise.all([
        db.execute(sql `
      SELECT
        dc.id::text AS id,
        dc.screen_id::text AS screen_id,
        right(dc.serial, 6) AS serial_suffix,
        dc.is_revoked AS is_revoked,
        dc.created_at AS created_at,
        dc.expires_at AS expires_at,
        dc.revoked_at AS revoked_at
      FROM device_certificates dc
      LEFT JOIN screens s ON s.id = dc.screen_id
      WHERE s.id IS NULL
      ORDER BY dc.created_at DESC
      LIMIT ${limit}
    `),
        db.execute(sql `
      SELECT
        dp.id::text AS id,
        dp.device_id::text AS device_id,
        dp.used AS used,
        dp.created_at AS created_at,
        dp.expires_at AS expires_at
      FROM device_pairings dp
      LEFT JOIN screens s ON s.id = dp.device_id
      WHERE dp.device_id IS NOT NULL AND s.id IS NULL
      ORDER BY dp.created_at DESC
      LIMIT ${limit}
    `),
        db.execute(sql `
      SELECT
        h.screen_id::text AS screen_id,
        count(*)::int AS row_count,
        max(h.created_at) AS latest_created_at
      FROM heartbeats h
      LEFT JOIN screens s ON s.id = h.screen_id
      WHERE s.id IS NULL
      GROUP BY h.screen_id
      ORDER BY max(h.created_at) DESC
      LIMIT ${limit}
    `),
        db.execute(sql `
      SELECT
        dc.screen_id::text AS screen_id,
        count(*)::int AS row_count,
        max(dc.created_at) AS latest_created_at
      FROM device_commands dc
      LEFT JOIN screens s ON s.id = dc.screen_id
      WHERE s.id IS NULL
      GROUP BY dc.screen_id
      ORDER BY max(dc.created_at) DESC
      LIMIT ${limit}
    `),
        db.execute(sql `
      SELECT count(*)::int AS count
      FROM device_certificates dc
      LEFT JOIN screens s ON s.id = dc.screen_id
      WHERE s.id IS NULL
    `),
        db.execute(sql `
      SELECT count(*)::int AS count
      FROM device_pairings dp
      LEFT JOIN screens s ON s.id = dp.device_id
      WHERE dp.device_id IS NOT NULL AND s.id IS NULL
    `),
        db.execute(sql `
      SELECT count(DISTINCT h.screen_id)::int AS count
      FROM heartbeats h
      LEFT JOIN screens s ON s.id = h.screen_id
      WHERE s.id IS NULL
    `),
        db.execute(sql `
      SELECT count(DISTINCT dc.screen_id)::int AS count
      FROM device_commands dc
      LEFT JOIN screens s ON s.id = dc.screen_id
      WHERE s.id IS NULL
    `),
        listDuplicateIdentityConflicts({ limit }),
    ]);
    const certificateRows = rowsFromResult(certificateRowsResult);
    const pairingRows = rowsFromResult(pairingRowsResult);
    const heartbeatRows = rowsFromResult(heartbeatRowsResult);
    const commandRows = rowsFromResult(commandRowsResult);
    const firstCount = (result) => rowsFromResult(result)[0]?.count;
    return {
        generated_at: new Date().toISOString(),
        limit,
        counts: {
            device_certificates: toNumber(firstCount(certificateCountResult)),
            device_pairings: toNumber(firstCount(pairingCountResult)),
            heartbeats: toNumber(firstCount(heartbeatCountResult)),
            device_commands: toNumber(firstCount(commandCountResult)),
            duplicate_identity_conflicts: duplicateIdentityReport.count,
        },
        orphans: {
            device_certificates: certificateRows.map((row) => ({
                reason: 'ORPHANED_CERTIFICATE',
                id: String(row.id),
                screen_id: String(row.screen_id),
                serial_suffix: typeof row.serial_suffix === 'string' ? row.serial_suffix : null,
                is_revoked: row.is_revoked === true,
                created_at: toIso(row.created_at),
                expires_at: toIso(row.expires_at),
                revoked_at: toIso(row.revoked_at),
            })),
            device_pairings: pairingRows.map((row) => ({
                reason: 'ORPHANED_PAIRING',
                id: String(row.id),
                device_id: String(row.device_id),
                used: row.used === true,
                created_at: toIso(row.created_at),
                expires_at: toIso(row.expires_at),
            })),
            heartbeats: heartbeatRows.map((row) => ({
                reason: 'ORPHANED_HEARTBEAT',
                screen_id: String(row.screen_id),
                row_count: toNumber(row.row_count),
                latest_created_at: toIso(row.latest_created_at),
            })),
            device_commands: commandRows.map((row) => ({
                reason: 'ORPHANED_COMMAND',
                screen_id: String(row.screen_id),
                row_count: toNumber(row.row_count),
                latest_created_at: toIso(row.latest_created_at),
            })),
        },
        duplicate_identity: {
            conflicts: duplicateIdentityReport.items,
        },
    };
}
