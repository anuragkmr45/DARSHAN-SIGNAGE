import { createHash, randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { config as appConfig } from '../config/index.js';
import { getDatabase, schema } from '../db/index.js';
const DEFAULT_MAX_SESSIONS = 8;
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function getHeaderValue(request, names) {
    for (const name of names) {
        const rawValue = request.headers[name.toLowerCase()];
        const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }
    return null;
}
function normalizeText(value, maxLength = 255) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.slice(0, maxLength) : null;
}
function hashValue(value) {
    const normalized = normalizeText(value, 1024);
    if (!normalized)
        return null;
    return createHash('sha256').update(normalized).digest('hex');
}
function shortHash(value) {
    const hashed = hashValue(value);
    return hashed ? hashed.slice(0, 16) : null;
}
function suffix(value, length = 8) {
    const normalized = normalizeText(value, 255);
    return normalized ? normalized.slice(-length) : null;
}
function safeDate(value) {
    if (value instanceof Date)
        return value;
    if (typeof value === 'string') {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime()))
            return parsed;
    }
    return null;
}
function normalizeStored(value) {
    const root = asRecord(value);
    const rawSessions = Array.isArray(root.sessions) ? root.sessions : [];
    const sessions = [];
    for (const raw of rawSessions) {
        const row = asRecord(raw);
        const runtimeSessionHash = normalizeText(row.runtimeSessionHash);
        const firstSeenAt = safeDate(row.firstSeenAt)?.toISOString();
        const lastSeenAt = safeDate(row.lastSeenAt)?.toISOString();
        const leaseExpiresAt = safeDate(row.leaseExpiresAt)?.toISOString();
        if (!runtimeSessionHash || !firstSeenAt || !lastSeenAt || !leaseExpiresAt) {
            continue;
        }
        sessions.push({
            installInstanceHash: normalizeText(row.installInstanceHash),
            installInstanceSuffix: normalizeText(row.installInstanceSuffix, 32),
            runtimeSessionHash,
            runtimeSessionSuffix: normalizeText(row.runtimeSessionSuffix, 32),
            machineHash: normalizeText(row.machineHash, 64),
            ipHash: normalizeText(row.ipHash, 64),
            userAgentHash: normalizeText(row.userAgentHash, 64),
            playerVersion: normalizeText(row.playerVersion, 80),
            source: normalizeText(row.source, 40) || 'heartbeat',
            firstSeenAt,
            lastSeenAt,
            leaseExpiresAt,
            status: row.status === 'CONFLICTED' ? 'CONFLICTED' : 'ACTIVE',
        });
    }
    const rawConflict = asRecord(root.conflict);
    const conflictId = normalizeText(rawConflict.id);
    const conflictFirstSeenAt = safeDate(rawConflict.firstSeenAt)?.toISOString();
    const conflictLastSeenAt = safeDate(rawConflict.lastSeenAt)?.toISOString();
    const conflict = conflictId && conflictFirstSeenAt && conflictLastSeenAt
        ? {
            id: conflictId,
            type: 'DUPLICATE_IDENTITY_CONFLICT',
            status: rawConflict.status === 'RESOLVED' ? 'RESOLVED' : 'OPEN',
            severity: rawConflict.severity === 'BLOCK' ? 'BLOCK' : 'WARN',
            firstSeenAt: conflictFirstSeenAt,
            lastSeenAt: conflictLastSeenAt,
            activeSessionCount: Number(rawConflict.activeSessionCount || 0),
            sessions: Array.isArray(rawConflict.sessions)
                ? rawConflict.sessions
                    .map((item) => {
                    const row = asRecord(item);
                    const firstSeenAt = safeDate(row.firstSeenAt)?.toISOString();
                    const lastSeenAt = safeDate(row.lastSeenAt)?.toISOString();
                    const leaseExpiresAt = safeDate(row.leaseExpiresAt)?.toISOString();
                    if (!firstSeenAt || !lastSeenAt || !leaseExpiresAt)
                        return null;
                    return {
                        installInstanceSuffix: normalizeText(row.installInstanceSuffix, 32),
                        runtimeSessionSuffix: normalizeText(row.runtimeSessionSuffix, 32),
                        machineHash: normalizeText(row.machineHash, 64),
                        ipHash: normalizeText(row.ipHash, 64),
                        userAgentHash: normalizeText(row.userAgentHash, 64),
                        playerVersion: normalizeText(row.playerVersion, 80),
                        source: normalizeText(row.source, 40) || 'heartbeat',
                        firstSeenAt,
                        lastSeenAt,
                        leaseExpiresAt,
                    };
                })
                    .filter((item) => Boolean(item))
                : [],
        }
        : null;
    return {
        schemaVersion: 1,
        sessions,
        conflict,
    };
}
function toSample(session) {
    return {
        installInstanceSuffix: session.installInstanceSuffix,
        runtimeSessionSuffix: session.runtimeSessionSuffix,
        machineHash: session.machineHash,
        ipHash: session.ipHash,
        userAgentHash: session.userAgentHash,
        playerVersion: session.playerVersion,
        source: session.source,
        firstSeenAt: session.firstSeenAt,
        lastSeenAt: session.lastSeenAt,
        leaseExpiresAt: session.leaseExpiresAt,
    };
}
function summarize(state) {
    const openConflict = state.conflict?.status === 'OPEN' ? state.conflict : null;
    return {
        active: Boolean(openConflict),
        conflictId: openConflict?.id ?? null,
        status: openConflict?.status ?? state.conflict?.status ?? null,
        severity: openConflict?.severity ?? null,
        enforcement: appConfig.DUPLICATE_IDENTITY_ENFORCEMENT,
        activeSessionCount: state.sessions.length,
        leaseMs: appConfig.DEVICE_SESSION_LEASE_MS,
        restartGraceMs: appConfig.DEVICE_SESSION_RESTART_GRACE_MS,
        firstSeenAt: openConflict?.firstSeenAt ?? null,
        lastSeenAt: openConflict?.lastSeenAt ?? null,
        sessions: openConflict?.sessions ?? state.sessions.map(toSample),
        recommendedAction: openConflict ? 'VERIFY_PHYSICAL_PLAYERS_AND_REVOKE_STALE_PAIRING' : null,
    };
}
export function extractDeviceIdentitySessionInput(request, params) {
    const body = asRecord(params.body);
    const installInstanceId = getHeaderValue(request, ['x-signhex-install-instance-id', 'x-darshan-install-instance-id']) ??
        normalizeText(body.install_instance_id) ??
        normalizeText(asRecord(body.identity_session).install_instance_id);
    const runtimeSessionId = getHeaderValue(request, ['x-signhex-runtime-session-id', 'x-darshan-runtime-session-id']) ??
        normalizeText(body.runtime_session_id) ??
        normalizeText(asRecord(body.identity_session).runtime_session_id);
    const playerVersion = getHeaderValue(request, ['x-signhex-player-version', 'x-darshan-player-version']) ??
        normalizeText(body.app_version) ??
        normalizeText(body.player_version);
    const hostname = normalizeText(body.hostname);
    const networkInterface = normalizeText(body.network_interface);
    const deviceModel = normalizeText(body.device_model);
    const osVersion = normalizeText(body.os_version);
    const machineObservation = [hostname, networkInterface, deviceModel, osVersion].filter(Boolean).join('|') || null;
    return {
        deviceId: params.deviceId,
        screenId: params.deviceId,
        source: params.source,
        installInstanceId,
        runtimeSessionId,
        playerVersion,
        userAgent: getHeaderValue(request, ['user-agent']),
        ipAddress: request.ip,
        machineObservation,
    };
}
export async function recordDeviceIdentitySession(input) {
    const db = getDatabase();
    const now = input.now ?? new Date();
    const runtimeSessionHash = hashValue(input.runtimeSessionId);
    const [screen] = await db
        .select({
        id: schema.screens.id,
        device_info: schema.screens.device_info,
    })
        .from(schema.screens)
        .where(eq(schema.screens.id, input.deviceId))
        .limit(1);
    if (!screen) {
        return summarize({ schemaVersion: 1, sessions: [], conflict: null });
    }
    const deviceInfo = asRecord(screen.device_info);
    const current = normalizeStored(deviceInfo.identity_sessions);
    const activeCutoff = now.getTime();
    const activeSessions = current.sessions.filter((session) => {
        const leaseExpiresAt = safeDate(session.leaseExpiresAt);
        return leaseExpiresAt ? leaseExpiresAt.getTime() > activeCutoff : false;
    });
    if (appConfig.DUPLICATE_IDENTITY_DETECTION_ENABLED && runtimeSessionHash) {
        const existingIndex = activeSessions.findIndex((session) => session.runtimeSessionHash === runtimeSessionHash);
        const existing = existingIndex >= 0 ? activeSessions[existingIndex] : null;
        const nextSession = {
            installInstanceHash: hashValue(input.installInstanceId),
            installInstanceSuffix: suffix(input.installInstanceId),
            runtimeSessionHash,
            runtimeSessionSuffix: suffix(input.runtimeSessionId),
            machineHash: shortHash(input.machineObservation),
            ipHash: shortHash(input.ipAddress),
            userAgentHash: shortHash(input.userAgent),
            playerVersion: normalizeText(input.playerVersion, 80),
            source: input.source,
            firstSeenAt: existing?.firstSeenAt ?? now.toISOString(),
            lastSeenAt: now.toISOString(),
            leaseExpiresAt: new Date(now.getTime() + appConfig.DEVICE_SESSION_LEASE_MS).toISOString(),
            status: 'ACTIVE',
        };
        if (existingIndex >= 0) {
            activeSessions[existingIndex] = nextSession;
        }
        else {
            activeSessions.push(nextSession);
        }
    }
    activeSessions.sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
    const limitedSessions = activeSessions.slice(0, DEFAULT_MAX_SESSIONS);
    const matureSessions = limitedSessions.filter((session) => now.getTime() - Date.parse(session.firstSeenAt) >= appConfig.DEVICE_SESSION_RESTART_GRACE_MS);
    const hasDuplicateConflict = matureSessions.length >= 2;
    const severity = appConfig.DUPLICATE_IDENTITY_ENFORCEMENT === 'block' ? 'BLOCK' : 'WARN';
    const conflict = hasDuplicateConflict
        ? {
            id: current.conflict?.status === 'OPEN' ? current.conflict.id : randomUUID(),
            type: 'DUPLICATE_IDENTITY_CONFLICT',
            status: 'OPEN',
            severity,
            firstSeenAt: current.conflict?.status === 'OPEN' ? current.conflict.firstSeenAt : now.toISOString(),
            lastSeenAt: now.toISOString(),
            activeSessionCount: limitedSessions.length,
            sessions: limitedSessions.map(toSample),
        }
        : current.conflict?.status === 'OPEN'
            ? {
                ...current.conflict,
                status: 'RESOLVED',
                lastSeenAt: now.toISOString(),
                activeSessionCount: limitedSessions.length,
                sessions: limitedSessions.map(toSample),
            }
            : current.conflict;
    const nextState = {
        schemaVersion: 1,
        sessions: hasDuplicateConflict
            ? limitedSessions.map((session) => ({ ...session, status: 'CONFLICTED' }))
            : limitedSessions.map((session) => ({ ...session, status: 'ACTIVE' })),
        conflict,
    };
    await db
        .update(schema.screens)
        .set({
        device_info: {
            ...deviceInfo,
            identity_sessions: nextState,
        },
        updated_at: now,
    })
        .where(eq(schema.screens.id, input.deviceId));
    return summarize(nextState);
}
export async function listDuplicateIdentityConflicts(options = {}) {
    const db = getDatabase();
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 100);
    const result = await db.execute(sql `
    SELECT
      id::text AS screen_id,
      name AS screen_name,
      device_info -> 'identity_sessions' AS identity_sessions
    FROM screens
    WHERE device_info ? 'identity_sessions'
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `);
    const rows = result && typeof result === 'object' && Array.isArray(result.rows)
        ? result.rows
        : [];
    const conflicts = [];
    for (const row of rows) {
        const state = normalizeStored(row.identity_sessions);
        const conflict = state.conflict;
        if (!conflict || conflict.status !== 'OPEN') {
            continue;
        }
        conflicts.push({
            conflictId: conflict.id,
            deviceId: String(row.screen_id),
            screenId: String(row.screen_id),
            screenName: typeof row.screen_name === 'string' ? row.screen_name : null,
            status: conflict.status,
            severity: conflict.severity,
            activeSessionCount: conflict.activeSessionCount,
            firstSeenAt: conflict.firstSeenAt,
            lastSeenAt: conflict.lastSeenAt,
            sessions: conflict.sessions,
            recommendedAction: 'VERIFY_PHYSICAL_PLAYERS_AND_REVOKE_STALE_PAIRING',
        });
    }
    return {
        count: conflicts.length,
        items: conflicts.slice(0, limit),
    };
}
