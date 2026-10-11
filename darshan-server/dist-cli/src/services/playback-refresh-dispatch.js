import { createHash } from 'crypto';
import { inArray } from 'drizzle-orm';
import { getDatabase, schema } from '../db/index.js';
import { isJobsInitialized, queuePlaybackRefreshDispatch } from '../jobs/index.js';
import { emitScreensRefreshRequired } from '../realtime/screens-namespace.js';
import { createPlaybackRefreshCommands, REFRESH_COMMAND_DEDUPE_MS, } from './playback-refresh-commands.js';
import { createLogger } from '../utils/logger.js';
const logger = createLogger('playback-refresh-dispatch');
export const PLAYBACK_REFRESH_JOB_CHUNK_SIZE = 100;
const PLAYBACK_REFRESH_JOB_SINGLETON_SECONDS = Math.floor(REFRESH_COMMAND_DEDUPE_MS / 1000);
async function resolveScreenIds(params) {
    const db = getDatabase();
    const resolved = new Set(params.screenIds || []);
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
            .where(inArray(schema.screenGroupMembers.group_id, groupIds));
        for (const member of members) {
            resolved.add(member.screen_id);
        }
    }
    return Array.from(resolved);
}
function buildPlaybackRefreshJob(params, screenIds) {
    return {
        reason: params.reason,
        screenIds,
        createdBy: params.createdBy,
        publishId: params.publishId ?? null,
        snapshotId: params.snapshotId ?? null,
        defaultMediaVersion: params.defaultMediaVersion ?? null,
        emergencyVersion: params.emergencyVersion ?? null,
    };
}
function buildPlaybackRefreshJobSingletonKey(job) {
    return createHash('sha256')
        .update(JSON.stringify({
        ...job,
        screenIds: [...job.screenIds].sort(),
    }))
        .digest('hex');
}
function chunkScreenIds(screenIds, chunkSize) {
    const chunks = [];
    for (let index = 0; index < screenIds.length; index += chunkSize) {
        chunks.push(screenIds.slice(index, index + chunkSize));
    }
    return chunks;
}
export async function dispatchPlaybackRefresh(fastify, params) {
    const resolvedScreenIds = await resolveScreenIds(params);
    const groupIds = Array.from(new Set((params.groupIds || []).filter(Boolean)));
    emitScreensRefreshRequired(fastify, {
        reason: params.reason,
        screen_ids: resolvedScreenIds,
        group_ids: groupIds,
    });
    if (resolvedScreenIds.length === 0) {
        return {
            resolvedScreenIds,
            commandsCreated: 0,
        };
    }
    const requiresImmediateCommandCreation = params.reason === 'TAKE_DOWN' || params.reason === 'DEFAULT_MEDIA';
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
    const queuedScreenIds = new Set();
    try {
        for (const screenIdChunk of chunkScreenIds(resolvedScreenIds, PLAYBACK_REFRESH_JOB_CHUNK_SIZE)) {
            const job = buildPlaybackRefreshJob(params, screenIdChunk);
            const queueOptions = params.reason === 'TAKE_DOWN' || params.reason === 'DEFAULT_MEDIA'
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
    }
    catch (error) {
        logger.warn({
            err: error,
            reason: params.reason,
            queuedScreenCount: queuedScreenIds.size,
        }, 'Queued playback refresh dispatch failed; falling back to inline command creation');
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
