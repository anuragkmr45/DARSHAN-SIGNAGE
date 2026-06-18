import { createHash, randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { FastifyRequest } from 'fastify';
import { config as appConfig } from '@/config';
import { getDatabase, schema } from '@/db';

export type DeviceIdentitySessionSource = 'heartbeat' | 'pairing_status' | 'websocket' | 'command_poll';
export type DeviceIdentityEnforcement = 'warn' | 'block';

export interface DeviceIdentitySessionInput {
  deviceId: string;
  screenId?: string | null;
  source: DeviceIdentitySessionSource;
  installInstanceId?: string | null;
  runtimeSessionId?: string | null;
  playerVersion?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  machineObservation?: string | null;
  now?: Date;
}

export interface DeviceIdentitySessionSample {
  installInstanceSuffix: string | null;
  runtimeSessionSuffix: string | null;
  machineHash: string | null;
  ipHash: string | null;
  userAgentHash: string | null;
  playerVersion: string | null;
  source: DeviceIdentitySessionSource;
  firstSeenAt: string;
  lastSeenAt: string;
  leaseExpiresAt: string;
}

export interface DuplicateIdentitySummary {
  active: boolean;
  conflictId: string | null;
  status: 'OPEN' | 'RESOLVED' | null;
  severity: 'WARN' | 'BLOCK' | null;
  enforcement: DeviceIdentityEnforcement;
  activeSessionCount: number;
  leaseMs: number;
  restartGraceMs: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  sessions: DeviceIdentitySessionSample[];
  recommendedAction: string | null;
}

export interface DuplicateIdentityConflictRow {
  conflictId: string;
  deviceId: string;
  screenId: string;
  screenName: string | null;
  status: 'OPEN' | 'RESOLVED';
  severity: 'WARN' | 'BLOCK';
  activeSessionCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  sessions: DeviceIdentitySessionSample[];
  recommendedAction: string;
}

type StoredSession = DeviceIdentitySessionSample & {
  installInstanceHash: string | null;
  runtimeSessionHash: string;
  status: 'ACTIVE' | 'CONFLICTED';
};

type StoredConflict = {
  id: string;
  type: 'DUPLICATE_IDENTITY_CONFLICT';
  status: 'OPEN' | 'RESOLVED';
  severity: 'WARN' | 'BLOCK';
  firstSeenAt: string;
  lastSeenAt: string;
  activeSessionCount: number;
  sessions: DeviceIdentitySessionSample[];
};

type StoredIdentitySessions = {
  schemaVersion: 1;
  sessions: StoredSession[];
  conflict: StoredConflict | null;
};

const DEFAULT_MAX_SESSIONS = 8;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function getHeaderValue(request: FastifyRequest, names: string[]) {
  for (const name of names) {
    const rawValue = request.headers[name.toLowerCase()];
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function normalizeText(value: unknown, maxLength = 255) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : null;
}

function hashValue(value?: string | null) {
  const normalized = normalizeText(value, 1024);
  if (!normalized) return null;
  return createHash('sha256').update(normalized).digest('hex');
}

function shortHash(value?: string | null) {
  const hashed = hashValue(value);
  return hashed ? hashed.slice(0, 16) : null;
}

function suffix(value?: string | null, length = 8) {
  const normalized = normalizeText(value, 255);
  return normalized ? normalized.slice(-length) : null;
}

function safeDate(value: unknown) {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function normalizeStored(value: unknown): StoredIdentitySessions {
  const root = asRecord(value);
  const rawSessions = Array.isArray(root.sessions) ? root.sessions : [];
  const sessions: StoredSession[] = [];

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
      source: (normalizeText(row.source, 40) as DeviceIdentitySessionSource) || 'heartbeat',
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
  const conflict =
    conflictId && conflictFirstSeenAt && conflictLastSeenAt
      ? {
          id: conflictId,
          type: 'DUPLICATE_IDENTITY_CONFLICT' as const,
          status: rawConflict.status === 'RESOLVED' ? 'RESOLVED' as const : 'OPEN' as const,
          severity: rawConflict.severity === 'BLOCK' ? 'BLOCK' as const : 'WARN' as const,
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
                  if (!firstSeenAt || !lastSeenAt || !leaseExpiresAt) return null;
                  return {
                    installInstanceSuffix: normalizeText(row.installInstanceSuffix, 32),
                    runtimeSessionSuffix: normalizeText(row.runtimeSessionSuffix, 32),
                    machineHash: normalizeText(row.machineHash, 64),
                    ipHash: normalizeText(row.ipHash, 64),
                    userAgentHash: normalizeText(row.userAgentHash, 64),
                    playerVersion: normalizeText(row.playerVersion, 80),
                    source: (normalizeText(row.source, 40) as DeviceIdentitySessionSource) || 'heartbeat',
                    firstSeenAt,
                    lastSeenAt,
                    leaseExpiresAt,
                  } satisfies DeviceIdentitySessionSample;
                })
                .filter((item): item is DeviceIdentitySessionSample => Boolean(item))
            : [],
        }
      : null;

  return {
    schemaVersion: 1,
    sessions,
    conflict,
  };
}

function toSample(session: StoredSession): DeviceIdentitySessionSample {
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

function summarize(state: StoredIdentitySessions): DuplicateIdentitySummary {
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

export function extractDeviceIdentitySessionInput(
  request: FastifyRequest,
  params: {
    deviceId: string;
    source: DeviceIdentitySessionSource;
    body?: Record<string, unknown>;
  }
): DeviceIdentitySessionInput {
  const body = asRecord(params.body);
  const installInstanceId =
    getHeaderValue(request, ['x-signhex-install-instance-id', 'x-darshan-install-instance-id']) ??
    normalizeText(body.install_instance_id) ??
    normalizeText(asRecord(body.identity_session).install_instance_id);
  const runtimeSessionId =
    getHeaderValue(request, ['x-signhex-runtime-session-id', 'x-darshan-runtime-session-id']) ??
    normalizeText(body.runtime_session_id) ??
    normalizeText(asRecord(body.identity_session).runtime_session_id);
  const playerVersion =
    getHeaderValue(request, ['x-signhex-player-version', 'x-darshan-player-version']) ??
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

export async function recordDeviceIdentitySession(
  input: DeviceIdentitySessionInput
): Promise<DuplicateIdentitySummary> {
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
    const nextSession: StoredSession = {
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
    } else {
      activeSessions.push(nextSession);
    }
  }

  activeSessions.sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  const limitedSessions = activeSessions.slice(0, DEFAULT_MAX_SESSIONS);
  const matureSessions = limitedSessions.filter(
    (session) => now.getTime() - Date.parse(session.firstSeenAt) >= appConfig.DEVICE_SESSION_RESTART_GRACE_MS
  );
  const hasDuplicateConflict = matureSessions.length >= 2;
  const severity = appConfig.DUPLICATE_IDENTITY_ENFORCEMENT === 'block' ? 'BLOCK' : 'WARN';
  const conflict: StoredConflict | null = hasDuplicateConflict
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

  const nextState: StoredIdentitySessions = {
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

export async function listDuplicateIdentityConflicts(options: { limit?: number } = {}) {
  const db = getDatabase();
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 100);
  const result = await db.execute(sql`
    SELECT
      id::text AS screen_id,
      name AS screen_name,
      device_info -> 'identity_sessions' AS identity_sessions
    FROM screens
    WHERE device_info ? 'identity_sessions'
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `);
  const rows = result && typeof result === 'object' && Array.isArray((result as { rows?: unknown[] }).rows)
    ? (result as { rows: Array<Record<string, unknown>> }).rows
    : [];

  const conflicts: DuplicateIdentityConflictRow[] = [];
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
