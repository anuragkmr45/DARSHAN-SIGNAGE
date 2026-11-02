import { and, asc, eq, gt, gte, isNull, lt, lte, or } from 'drizzle-orm';
import { config as appConfig } from '@/config';
import { DbExecutor, getDatabase, schema } from '@/db';
import { createLogger } from '@/utils/logger';

export const AVAILABILITY_HEARTBEAT_GRACE_MS = 90_000;
export const BACKEND_CHECKPOINT_INTERVAL_MS = 30_000;
export const AVAILABILITY_TIMEZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const logger = createLogger('screen-availability');

type AvailabilityState = 'ONLINE' | 'OFFLINE';
type AvailabilitySource = 'HEARTBEAT' | 'EXPLICIT_OFFLINE' | 'PLAYER_ERROR' | 'STALE_TIMEOUT';
type Range = { start: number; end: number };
type StateRange = Range & { state: AvailabilityState | 'UNKNOWN' };

let monitorTimer: NodeJS.Timeout | null = null;

async function getOpenInterval(executor: DbExecutor, screenId: string) {
  const [open] = await executor
    .select()
    .from(schema.screenAvailabilityIntervals)
    .where(and(eq(schema.screenAvailabilityIntervals.screen_id, screenId), isNull(schema.screenAvailabilityIntervals.ended_at)))
    .for('update');
  return open ?? null;
}

async function changeState(
  executor: DbExecutor,
  screenId: string,
  state: AvailabilityState,
  source: AvailabilitySource,
  at: Date,
) {
  const open = await getOpenInterval(executor, screenId);
  if (open?.state === state) return;

  if (open) {
    const transitionAt = at < open.started_at ? open.started_at : at;
    await executor
      .update(schema.screenAvailabilityIntervals)
      .set({ ended_at: transitionAt, updated_at: at })
      .where(eq(schema.screenAvailabilityIntervals.id, open.id));
  }

  await executor.insert(schema.screenAvailabilityIntervals).values({
    screen_id: screenId,
    state,
    source,
    started_at: at,
    updated_at: at,
  });
}

/** Caller must hold a FOR UPDATE lock on the Screen row. */
export async function recordScreenAvailabilityHeartbeat(
  executor: DbExecutor,
  input: {
    screenId: string;
    status: 'ONLINE' | 'OFFLINE' | 'ERROR';
    receivedAt: Date;
    previousLastHeartbeatAt: Date | null;
  },
) {
  if (input.status === 'ONLINE') {
    const staleAt = input.previousLastHeartbeatAt
      ? new Date(input.previousLastHeartbeatAt.getTime() + AVAILABILITY_HEARTBEAT_GRACE_MS)
      : null;
    if (staleAt && staleAt < input.receivedAt) {
      await changeState(executor, input.screenId, 'OFFLINE', 'STALE_TIMEOUT', staleAt);
    }
    await changeState(executor, input.screenId, 'ONLINE', 'HEARTBEAT', input.receivedAt);
    return;
  }

  await changeState(
    executor,
    input.screenId,
    'OFFLINE',
    input.status === 'OFFLINE' ? 'EXPLICIT_OFFLINE' : 'PLAYER_ERROR',
    input.receivedAt,
  );
}

export async function recordBackendReadinessCheckpoint(now = new Date(), executor: DbExecutor = getDatabase()) {
  const bucket = Math.floor(now.getTime() / BACKEND_CHECKPOINT_INTERVAL_MS);
  const id = `${appConfig.SIGNHEX_DEPLOYMENT_ID}:${appConfig.SIGNHEX_SERVER_ID}:${bucket}`;
  await executor
    .insert(schema.backendReadinessCheckpoints)
    .values({
      id,
      deployment_id: appConfig.SIGNHEX_DEPLOYMENT_ID,
      server_id: appConfig.SIGNHEX_SERVER_ID,
      observed_at: now,
      updated_at: now,
    })
    // Preserve the first successful observation in the bucket. Moving it to a
    // later heartbeat would create an artificial unknown gap at the boundary.
    .onConflictDoNothing();
}

export async function reconcileStaleScreenAvailability(now = new Date()) {
  const db = getDatabase();
  const cutoff = new Date(now.getTime() - AVAILABILITY_HEARTBEAT_GRACE_MS);
  const candidates = await db
    .select({ id: schema.screens.id })
    .from(schema.screens)
    .innerJoin(
      schema.screenAvailabilityIntervals,
      and(
        eq(schema.screenAvailabilityIntervals.screen_id, schema.screens.id),
        eq(schema.screenAvailabilityIntervals.state, 'ONLINE'),
        isNull(schema.screenAvailabilityIntervals.ended_at),
      ),
    )
    .where(lte(schema.screens.last_heartbeat_at, cutoff));

  for (const candidate of candidates) {
    await db.transaction(async (tx) => {
      const [screen] = await tx
        .select({ lastHeartbeatAt: schema.screens.last_heartbeat_at })
        .from(schema.screens)
        .where(eq(schema.screens.id, candidate.id))
        .for('update');
      if (!screen?.lastHeartbeatAt || screen.lastHeartbeatAt > cutoff) return;
      const staleAt = new Date(screen.lastHeartbeatAt.getTime() + AVAILABILITY_HEARTBEAT_GRACE_MS);
      await changeState(tx, candidate.id, 'OFFLINE', 'STALE_TIMEOUT', staleAt);
    });
  }
}

async function runMonitorTick() {
  try {
    const now = new Date();
    await recordBackendReadinessCheckpoint(now);
    await reconcileStaleScreenAvailability(now);
  } catch (error) {
    logger.warn(error, 'Availability monitor tick failed');
  }
}

export function startScreenAvailabilityMonitor() {
  if (monitorTimer) return;
  void runMonitorTick();
  monitorTimer = setInterval(() => void runMonitorTick(), BACKEND_CHECKPOINT_INTERVAL_MS);
  monitorTimer.unref();
}

export function stopScreenAvailabilityMonitor() {
  if (!monitorTimer) return;
  clearInterval(monitorTimer);
  monitorTimer = null;
}

function mergeRanges(input: Range[]): Range[] {
  const sorted = input.filter((range) => range.end > range.start).sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || range.start > previous.end) merged.push({ ...range });
    else previous.end = Math.max(previous.end, range.end);
  }
  return merged;
}

function intersect(a: Range, b: Range): Range | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { start, end } : null;
}

function complement(range: Range, covered: Range[]): Range[] {
  const result: Range[] = [];
  let cursor = range.start;
  for (const item of mergeRanges(covered)) {
    if (item.end <= range.start || item.start >= range.end) continue;
    const clipped = intersect(range, item);
    if (!clipped) continue;
    if (clipped.start > cursor) result.push({ start: cursor, end: clipped.start });
    cursor = Math.max(cursor, clipped.end);
  }
  if (cursor < range.end) result.push({ start: cursor, end: range.end });
  return result;
}

function istDateLabel(epochMs: number) {
  return new Date(epochMs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function nextIstMidnight(epochMs: number) {
  const shifted = new Date(epochMs + IST_OFFSET_MS);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1) - IST_OFFSET_MS;
}

type DurationAccumulator = { onlineMs: number; offlineMs: number; unknownMs: number };

function addSegment(
  accumulator: DurationAccumulator,
  daily: Map<string, DurationAccumulator>,
  segment: StateRange,
) {
  const key = segment.state === 'ONLINE' ? 'onlineMs' : segment.state === 'OFFLINE' ? 'offlineMs' : 'unknownMs';
  accumulator[key] += segment.end - segment.start;
  let cursor = segment.start;
  while (cursor < segment.end) {
    const end = Math.min(segment.end, nextIstMidnight(cursor));
    const date = istDateLabel(cursor);
    const bucket = daily.get(date) ?? { onlineMs: 0, offlineMs: 0, unknownMs: 0 };
    bucket[key] += end - cursor;
    daily.set(date, bucket);
    cursor = end;
  }
}

function seconds(ms: number) {
  return Math.round(ms / 1000);
}

function formatDurations(value: DurationAccumulator) {
  const knownMs = value.onlineMs + value.offlineMs;
  return {
    online_seconds: seconds(value.onlineMs),
    estimated_offline_seconds: seconds(value.offlineMs),
    unknown_seconds: seconds(value.unknownMs),
    known_seconds: seconds(knownMs),
    uptime_percent: knownMs > 0 ? Number(((value.onlineMs / knownMs) * 100).toFixed(2)) : null,
  };
}

export async function buildAvailabilityReport(input: { rangeStart: Date; rangeEnd: Date }) {
  await reconcileStaleScreenAvailability(input.rangeEnd);
  const db = getDatabase();
  const checkpointLookback = new Date(input.rangeStart.getTime() - AVAILABILITY_HEARTBEAT_GRACE_MS);
  const [screens, intervals, checkpoints] = await Promise.all([
    db.select({
      id: schema.screens.id,
      name: schema.screens.name,
      createdAt: schema.screens.created_at,
      lastHeartbeatAt: schema.screens.last_heartbeat_at,
    }).from(schema.screens).where(lt(schema.screens.created_at, input.rangeEnd)).orderBy(asc(schema.screens.name)),
    db.select().from(schema.screenAvailabilityIntervals).where(and(
      lt(schema.screenAvailabilityIntervals.started_at, input.rangeEnd),
      or(isNull(schema.screenAvailabilityIntervals.ended_at), gt(schema.screenAvailabilityIntervals.ended_at, input.rangeStart)),
    )).orderBy(asc(schema.screenAvailabilityIntervals.started_at)),
    db.select({ observedAt: schema.backendReadinessCheckpoints.observed_at })
      .from(schema.backendReadinessCheckpoints)
      .where(and(
        eq(schema.backendReadinessCheckpoints.deployment_id, appConfig.SIGNHEX_DEPLOYMENT_ID),
        gte(schema.backendReadinessCheckpoints.observed_at, checkpointLookback),
        lte(schema.backendReadinessCheckpoints.observed_at, input.rangeEnd),
      ))
      .orderBy(asc(schema.backendReadinessCheckpoints.observed_at)),
  ]);

  const requestedRange: Range = { start: input.rangeStart.getTime(), end: input.rangeEnd.getTime() };
  const backendKnown = mergeRanges(checkpoints.map((item) => ({
    start: item.observedAt.getTime(),
    end: Math.min(requestedRange.end, item.observedAt.getTime() + AVAILABILITY_HEARTBEAT_GRACE_MS),
  })).map((range) => intersect(range, requestedRange)).filter((range): range is Range => Boolean(range)));

  const fleet: DurationAccumulator = { onlineMs: 0, offlineMs: 0, unknownMs: 0 };
  const daily = new Map<string, DurationAccumulator>();
  const screenResults = screens.map((screen) => {
    const monitored: Range = {
      start: Math.max(requestedRange.start, screen.createdAt.getTime()),
      end: requestedRange.end,
    };
    const screenIntervals = intervals.filter((item) => item.screen_id === screen.id);
    const reported: StateRange[] = [];
    for (const item of screenIntervals) {
      const stateRange: Range = {
        start: item.started_at.getTime(),
        end: item.ended_at?.getTime() ?? requestedRange.end,
      };
      for (const backendRange of backendKnown) {
        const overlap = intersect(monitored, intersect(stateRange, backendRange) ?? { start: 0, end: 0 });
        if (overlap) reported.push({ ...overlap, state: item.state as AvailabilityState });
      }
    }
    const unknown = complement(monitored, reported).map((range) => ({ ...range, state: 'UNKNOWN' as const }));
    const total: DurationAccumulator = { onlineMs: 0, offlineMs: 0, unknownMs: 0 };
    for (const segment of [...reported, ...unknown]) addSegment(total, daily, segment);
    fleet.onlineMs += total.onlineMs;
    fleet.offlineMs += total.offlineMs;
    fleet.unknownMs += total.unknownMs;
    return {
      screen_id: screen.id,
      screen_name: screen.name,
      last_heartbeat_at: screen.lastHeartbeatAt?.toISOString() ?? null,
      never_seen: screen.lastHeartbeatAt === null,
      ...formatDurations(total),
    };
  });

  return {
    range: {
      start_at: input.rangeStart.toISOString(),
      end_at: input.rangeEnd.toISOString(),
      timezone: AVAILABILITY_TIMEZONE,
      offline_threshold_seconds: AVAILABILITY_HEARTBEAT_GRACE_MS / 1000,
    },
    summary: {
      screens: screenResults.length,
      monitored_seconds: seconds(fleet.onlineMs + fleet.offlineMs + fleet.unknownMs),
      ...formatDurations(fleet),
    },
    screens: screenResults,
    daily: [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, ...formatDurations(value) })),
  };
}
