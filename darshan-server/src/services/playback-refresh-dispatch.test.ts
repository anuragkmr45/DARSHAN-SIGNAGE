import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

const {
  emitScreensRefreshRequiredMock,
  isJobsInitializedMock,
  queuePlaybackRefreshDispatchMock,
} = vi.hoisted(() => ({
  emitScreensRefreshRequiredMock: vi.fn(),
  isJobsInitializedMock: vi.fn(),
  queuePlaybackRefreshDispatchMock: vi.fn(),
}));

vi.mock('@/realtime/screens-namespace', () => ({
  emitScreensRefreshRequired: emitScreensRefreshRequiredMock,
}));

vi.mock('@/jobs', () => ({
  isJobsInitialized: isJobsInitializedMock,
  queuePlaybackRefreshDispatch: queuePlaybackRefreshDispatchMock,
}));

import { closeDatabase, getDatabase, initializeDatabase, schema } from '@/db';
import {
  PLAYBACK_REFRESH_JOB_CHUNK_SIZE,
  dispatchPlaybackRefresh,
} from '@/services/playback-refresh-dispatch';

describe('playback refresh dispatch', () => {
  const fastify = {} as FastifyInstance;

  beforeAll(async () => {
    await initializeDatabase();
  });

  beforeEach(async () => {
    isJobsInitializedMock.mockReset();
    queuePlaybackRefreshDispatchMock.mockReset();
    emitScreensRefreshRequiredMock.mockReset();
    const db = getDatabase();
    await db.delete(schema.commandOutbox);
    await db.delete(schema.deviceDesiredStateHistory);
    await db.delete(schema.deviceDesiredState);
    await db.delete(schema.deviceCommandStatusHistory);
    await db.delete(schema.deviceCommands);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('queues chunked refresh-dispatch jobs when the job runtime is available', async () => {
    isJobsInitializedMock.mockReturnValue(true);
    queuePlaybackRefreshDispatchMock.mockResolvedValue('job-id');

    const screenIds = Array.from(
      { length: PLAYBACK_REFRESH_JOB_CHUNK_SIZE * 2 + 5 },
      () => randomUUID()
    );

    const result = await dispatchPlaybackRefresh(fastify, {
      reason: 'PUBLISH',
      screenIds,
      createdBy: randomUUID(),
      publishId: randomUUID(),
      snapshotId: randomUUID(),
    });

    expect(result.commandsCreated).toBe(0);
    expect(queuePlaybackRefreshDispatchMock).toHaveBeenCalledTimes(3);
    expect(
      queuePlaybackRefreshDispatchMock.mock.calls.map(([job]) => job.screenIds.length)
    ).toEqual([PLAYBACK_REFRESH_JOB_CHUNK_SIZE, PLAYBACK_REFRESH_JOB_CHUNK_SIZE, 5]);
    expect(queuePlaybackRefreshDispatchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        singletonKey: expect.any(String),
        singletonSeconds: 60,
      })
    );
    expect(emitScreensRefreshRequiredMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: 'PUBLISH',
        screen_ids: screenIds,
        group_ids: [],
      })
    );

    const db = getDatabase();
    const commands = await db
      .select()
      .from(schema.deviceCommands)
      .where(inArray(schema.deviceCommands.screen_id, screenIds as string[]));

    expect(commands).toHaveLength(0);
  });

  it('creates default-media refresh commands inline when the job client is initialized', async () => {
    isJobsInitializedMock.mockReturnValue(true);
    queuePlaybackRefreshDispatchMock.mockResolvedValue('job-id');

    const screenIds = [randomUUID(), randomUUID()];
    const result = await dispatchPlaybackRefresh(fastify, {
      reason: 'DEFAULT_MEDIA',
      screenIds,
      createdBy: randomUUID(),
    });

    expect(result.commandsCreated).toBe(2);
    expect(queuePlaybackRefreshDispatchMock).not.toHaveBeenCalled();

    const db = getDatabase();
    const commands = await db
      .select()
      .from(schema.deviceCommands)
      .where(inArray(schema.deviceCommands.screen_id, screenIds as string[]));

    expect(commands).toHaveLength(2);
    expect(commands.every((command) => command.type === 'REFRESH')).toBe(true);
    expect(commands.every((command) => (command.payload as { reason?: string } | null)?.reason === 'DEFAULT_MEDIA')).toBe(true);
    expect(commands.every((command) => command.desired_default_media_version !== null)).toBe(true);

    const desiredStates = await db
      .select()
      .from(schema.deviceDesiredState)
      .where(inArray(schema.deviceDesiredState.screen_id, screenIds as string[]));

    expect(desiredStates).toHaveLength(2);
    expect(desiredStates.every((state) => state.default_media_version !== null)).toBe(true);
    expect(desiredStates.every((state) => state.last_changed_reason === 'DEFAULT_MEDIA')).toBe(true);

    const outboxRows = await db
      .select()
      .from(schema.commandOutbox)
      .where(inArray(schema.commandOutbox.command_id, commands.map((command) => command.id)));

    expect(outboxRows).toHaveLength(2);
    expect(outboxRows.every((row) => row.event_type === 'COMMAND_AVAILABLE' && row.status === 'PENDING')).toBe(true);
  });

  it('creates lifecycle side effects for a fleet default-media refresh in one robust path', async () => {
    isJobsInitializedMock.mockReturnValue(true);
    queuePlaybackRefreshDispatchMock.mockResolvedValue('job-id');

    const screenIds = Array.from({ length: 40 }, () => randomUUID());
    const result = await dispatchPlaybackRefresh(fastify, {
      reason: 'DEFAULT_MEDIA',
      screenIds,
      createdBy: randomUUID(),
    });

    expect(result.commandsCreated).toBe(screenIds.length);
    expect(queuePlaybackRefreshDispatchMock).not.toHaveBeenCalled();

    const db = getDatabase();
    const commands = await db
      .select()
      .from(schema.deviceCommands)
      .where(inArray(schema.deviceCommands.screen_id, screenIds as string[]));

    expect(commands).toHaveLength(screenIds.length);

    const commandIds = commands.map((command) => command.id);
    const [history, desiredStates, desiredStateHistory, outboxRows] = await Promise.all([
      db
        .select()
        .from(schema.deviceCommandStatusHistory)
        .where(inArray(schema.deviceCommandStatusHistory.command_id, commandIds)),
      db
        .select()
        .from(schema.deviceDesiredState)
        .where(inArray(schema.deviceDesiredState.screen_id, screenIds as string[])),
      db
        .select()
        .from(schema.deviceDesiredStateHistory)
        .where(inArray(schema.deviceDesiredStateHistory.command_id, commandIds)),
      db
        .select()
        .from(schema.commandOutbox)
        .where(inArray(schema.commandOutbox.command_id, commandIds)),
    ]);

    expect(history).toHaveLength(screenIds.length);
    expect(desiredStates).toHaveLength(screenIds.length);
    expect(desiredStateHistory).toHaveLength(screenIds.length);
    expect(outboxRows).toHaveLength(screenIds.length);
    expect(
      desiredStates.every(
        (state) => state.default_media_version !== null && state.last_changed_reason === 'DEFAULT_MEDIA'
      )
    ).toBe(true);
    expect(outboxRows.every((row) => row.event_type === 'COMMAND_AVAILABLE' && row.status === 'PENDING')).toBe(true);
  });

  it('preserves existing desired snapshot state when default media refreshes are batched', async () => {
    isJobsInitializedMock.mockReturnValue(false);

    const screenId = randomUUID();
    const snapshotId = randomUUID();
    const createdBy = randomUUID();

    await dispatchPlaybackRefresh(fastify, {
      reason: 'PUBLISH',
      screenIds: [screenId],
      createdBy,
      publishId: randomUUID(),
      snapshotId,
    });

    await dispatchPlaybackRefresh(fastify, {
      reason: 'DEFAULT_MEDIA',
      screenIds: [screenId],
      createdBy,
    });

    const db = getDatabase();
    const [desiredState] = await db
      .select()
      .from(schema.deviceDesiredState)
      .where(inArray(schema.deviceDesiredState.screen_id, [screenId]));

    expect(desiredState?.snapshot_id).toBe(snapshotId);
    expect(desiredState?.default_media_version).not.toBeNull();
    expect(desiredState?.last_changed_reason).toBe('DEFAULT_MEDIA');
    expect(desiredState?.command_version).toBe(2);
    expect(desiredState?.state_version).toBe(2);
  });

  it('falls back to inline command creation when queueing fails', async () => {
    isJobsInitializedMock.mockReturnValue(true);
    queuePlaybackRefreshDispatchMock.mockRejectedValue(new Error('pg-boss unavailable'));

    const screenIds = [randomUUID(), randomUUID()];
    const result = await dispatchPlaybackRefresh(fastify, {
      reason: 'EMERGENCY',
      screenIds,
      createdBy: randomUUID(),
    });

    expect(queuePlaybackRefreshDispatchMock).toHaveBeenCalledTimes(1);
    expect(result.commandsCreated).toBe(2);

    const db = getDatabase();
    const commands = await db
      .select()
      .from(schema.deviceCommands)
      .where(inArray(schema.deviceCommands.screen_id, screenIds as string[]));

    expect(commands).toHaveLength(2);
    expect(commands.every((command) => command.type === 'REFRESH' && command.status === 'PENDING')).toBe(true);
    expect(commands.every((command) => (command.payload as { reason?: string } | null)?.reason === 'EMERGENCY')).toBe(true);

    const history = await db
      .select()
      .from(schema.deviceCommandStatusHistory)
      .where(inArray(schema.deviceCommandStatusHistory.command_id, commands.map((command) => command.id)));

    expect(history).toHaveLength(2);
    expect(history.every((entry) => entry.new_status === 'PENDING' && entry.reason === 'created')).toBe(true);

    const desiredStates = await db
      .select()
      .from(schema.deviceDesiredState)
      .where(inArray(schema.deviceDesiredState.screen_id, screenIds as string[]));
    expect(desiredStates).toHaveLength(2);
    expect(desiredStates.every((state) => state.emergency_version !== null)).toBe(true);
    expect(desiredStates.every((state) => state.last_command_reason === 'EMERGENCY')).toBe(true);

    const outboxRows = await db
      .select()
      .from(schema.commandOutbox)
      .where(inArray(schema.commandOutbox.command_id, commands.map((command) => command.id)));
    expect(outboxRows).toHaveLength(2);
    expect(outboxRows.every((row) => row.event_type === 'COMMAND_AVAILABLE' && row.status === 'PENDING')).toBe(true);
  });
});
