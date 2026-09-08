import { createHash } from 'crypto';
import { FastifyInstance } from 'fastify';
import { inArray } from 'drizzle-orm';
import { getDatabase, schema } from '@/db';
import { isJobsInitialized, queuePlaybackRefreshDispatch, type PlaybackRefreshDispatchJob } from '@/jobs';
import { emitScreensRefreshRequired } from '@/realtime/screens-namespace';
import { sendConnectedDeviceResync } from '@/realtime/device-gateway';
import {
  createPlaybackRefreshCommands,
  REFRESH_COMMAND_DEDUPE_MS,
  type PlaybackRefreshCommandBatch,
  type PlaybackRefreshReason,
} from '@/services/playback-refresh-commands';
import { createLogger } from '@/utils/logger';

const logger = createLogger('playback-refresh-dispatch');

export type DispatchPlaybackRefreshParams = {
  reason: PlaybackRefreshReason;
  screenIds?: string[];
  groupIds?: string[];
  targetAll?: boolean;
  createdBy: string;
  publishId?: string | null;
  snapshotId?: string | null;
  defaultMediaVersion?: string | null;
  emergencyVersion?: string | null;
};

export const PLAYBACK_REFRESH_JOB_CHUNK_SIZE = 100;
const PLAYBACK_REFRESH_JOB_SINGLETON_SECONDS = Math.floor(REFRESH_COMMAND_DEDUPE_MS / 1000);

async function resolveScreenIds(
  params: Pick<DispatchPlaybackRefreshParams, 'screenIds' | 'groupIds' | 'targetAll'>
) {
  const db = getDatabase();
  const resolved = new Set<string>(params.screenIds || []);

  if (params.targetAll) {
    const screens = await db.select({ id: schema.screens.id }).from(schema.screens);
    for (const screen of screens) {
      resolved.add(screen.id);
    }
  }

  const groupIds = Array.from(new Set((params.groupIds || []).filter(Boolean)));
  if (groupIds.length > 0) {
    const members = await db
      .select({ screen_id: schema.screenGroupMembers.screen_id })
      .from(schema.screenGroupMembers)
      .where(inArray(schema.screenGroupMembers.group_id, groupIds as string[]));

    for (const member of members) {
      resolved.add(member.screen_id);
    }
  }

  return Array.from(resolved);
}

function buildPlaybackRefreshJob(
  params: DispatchPlaybackRefreshParams,
  screenIds: string[],
  options: { targetAll?: boolean; groupIds?: string[] } = {}
): PlaybackRefreshDispatchJob {
  return {
    reason: params.reason,
    screenIds,
    createdBy: params.createdBy,
    publishId: params.publishId ?? null,
    snapshotId: params.snapshotId ?? null,
    defaultMediaVersion: params.defaultMediaVersion ?? null,
    emergencyVersion: params.emergencyVersion ?? null,
    ...(options.targetAll ? { targetAll: true } : {}),
    ...(options.groupIds && options.groupIds.length > 0 ? { groupIds: options.groupIds } : {}),
  };
}

function buildPlaybackRefreshJobSingletonKey(job: PlaybackRefreshCommandBatch) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        ...job,
        screenIds: [...job.screenIds].sort(),
      })
    )
    .digest('hex');
}

function chunkScreenIds(screenIds: string[], chunkSize: number) {
  const chunks: string[][] = [];
  for (let index = 0; index < screenIds.length; index += chunkSize) {
    chunks.push(screenIds.slice(index, index + chunkSize));
  }
  return chunks;
}

export async function dispatchPlaybackRefresh(
  fastify: FastifyInstance,
  params: DispatchPlaybackRefreshParams
) {
  const groupIds = Array.from(new Set((params.groupIds || []).filter(Boolean)));
  const isFleetDefaultMediaRefresh = params.reason === 'DEFAULT_MEDIA' && params.targetAll === true;
  // A fleet default change has a compact selector job. Do not read and
  // serialize the complete screen table in the API request path.
  const resolvedScreenIds = isFleetDefaultMediaRefresh ? [] : await resolveScreenIds(params);

  emitScreensRefreshRequired(fastify, {
    reason: params.reason,
    // CMS clients only need a re-fetch signal for a fleet change. Sending a
    // 10k-device ID list through Socket.IO makes the notification itself a
    // scalability and payload-limit failure.
    screen_ids: isFleetDefaultMediaRefresh ? [] : resolvedScreenIds,
    group_ids: groupIds,
    target_all: params.targetAll === true,
  });

  if (isFleetDefaultMediaRefresh) {
    try {
      await sendConnectedDeviceResync({ reason: 'DEFAULT_MEDIA', resources: ['desired_state', 'snapshot'] });
    } catch (error) {
      // Command creation/polling remain authoritative recovery paths. A
      // transient realtime-bus outage must not make a valid CMS setting write
      // fail after it has committed.
      logger.warn({ err: error }, 'Fleet default-media wake failed; command and polling recovery remain active');
    }

    if (isJobsInitialized()) {
      try {
        await queuePlaybackRefreshDispatch(
          buildPlaybackRefreshJob(params, [], { targetAll: true }),
          {
            singletonKey: 'playback-refresh:default-media:fleet',
            singletonSeconds: 30,
          }
        );
        return { resolvedScreenIds, commandsCreated: 0 };
      } catch (error) {
        logger.warn({ err: error, reason: params.reason }, 'Fleet default-media refresh queue failed; falling back to inline command creation');
      }
    }

    // No worker is available (or its enqueue failed). Correctness wins over
    // latency in this degraded condition: create the durable command state
    // synchronously so every player still converges through polling.
    const fallbackScreenIds = await resolveScreenIds(params);
    const inlineResult = await createPlaybackRefreshCommands({
      reason: params.reason,
      screenIds: fallbackScreenIds,
      createdBy: params.createdBy,
      publishId: params.publishId ?? null,
      snapshotId: params.snapshotId ?? null,
      defaultMediaVersion: params.defaultMediaVersion ?? null,
      emergencyVersion: params.emergencyVersion ?? null,
    });
    return { resolvedScreenIds: fallbackScreenIds, commandsCreated: inlineResult.commandsCreated };
  }

  if (resolvedScreenIds.length === 0) {
    return {
      resolvedScreenIds,
      commandsCreated: 0,
    };
  }

  const requiresImmediateCommandCreation =
    params.reason === 'TAKE_DOWN' || (params.reason === 'DEFAULT_MEDIA' && !isFleetDefaultMediaRefresh);

  if (requiresImmediateCommandCreation || !isJobsInitialized()) {
    const inlineResult = await createPlaybackRefreshCommands({
      reason: params.reason,
      screenIds: resolvedScreenIds,
      createdBy: params.createdBy,
      publishId: params.publishId ?? null,
      snapshotId: params.snapshotId ?? null,
      defaultMediaVersion: params.defaultMediaVersion ?? null,
      emergencyVersion: params.emergencyVersion ?? null,
    });

    return {
      resolvedScreenIds,
      commandsCreated: inlineResult.commandsCreated,
    };
  }

  const queuedScreenIds = new Set<string>();

  try {
    for (const screenIdChunk of chunkScreenIds(resolvedScreenIds, PLAYBACK_REFRESH_JOB_CHUNK_SIZE)) {
      const job = buildPlaybackRefreshJob(params, screenIdChunk);
      const queueOptions =
        params.reason === 'TAKE_DOWN'
          ? undefined
          : {
              singletonKey: buildPlaybackRefreshJobSingletonKey(job),
              singletonSeconds: PLAYBACK_REFRESH_JOB_SINGLETON_SECONDS,
            };

      await queuePlaybackRefreshDispatch(job, queueOptions);
      screenIdChunk.forEach((screenId) => queuedScreenIds.add(screenId));
    }

    return {
      resolvedScreenIds,
      commandsCreated: 0,
    };
  } catch (error) {
    logger.warn(
      {
        err: error,
        reason: params.reason,
        queuedScreenCount: queuedScreenIds.size,
      },
      'Queued playback refresh dispatch failed; falling back to inline command creation'
    );

    const remainingScreenIds = resolvedScreenIds.filter((screenId) => !queuedScreenIds.has(screenId));
    if (remainingScreenIds.length === 0) {
      return {
        resolvedScreenIds,
        commandsCreated: 0,
      };
    }

    const inlineResult = await createPlaybackRefreshCommands({
      reason: params.reason,
      screenIds: remainingScreenIds,
      createdBy: params.createdBy,
      publishId: params.publishId ?? null,
      snapshotId: params.snapshotId ?? null,
      defaultMediaVersion: params.defaultMediaVersion ?? null,
      emergencyVersion: params.emergencyVersion ?? null,
    });

    return {
      resolvedScreenIds,
      commandsCreated: inlineResult.commandsCreated,
    };
  }
}
