import { createHash } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { getDatabase, schema } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { getPresignedUrl, putObject } from '../s3/index.js';
import { buildScreenPlaybackStateById } from '../screens/playback.js';
import { emitScreenPreviewUpdateGlobal, emitScreenStateUpdateGlobal } from '../realtime/screens-namespace.js';
import { getSocketServer } from '../realtime/socket-server.js';
const logger = createLogger('device-telemetry-jobs');
export const HEARTBEAT_BUCKET = 'logs-heartbeats';
export const PROOF_OF_PLAY_BUCKET = 'logs-proof-of-play';
export const SCREENSHOT_BUCKET = 'device-screenshots';
function hashSuffix(input) {
    return createHash('sha256').update(input).digest('hex').slice(0, 12);
}
export function buildHeartbeatObjectKey(deviceId, receivedAt, payload) {
    const stamp = Date.parse(receivedAt) || Date.now();
    return `heartbeats/${deviceId}/${stamp}-${hashSuffix(JSON.stringify(payload))}.json`;
}
export function buildScreenshotObjectKey(deviceId, timestamp, storageObjectId, mimeType = 'image/png') {
    const stamp = Date.parse(timestamp) || Date.now();
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
    return `device-screenshots/${deviceId}/${stamp}-${storageObjectId}.${extension}`;
}
export function buildProofOfPlayIdempotencyKey(input) {
    return createHash('sha256')
        .update([
        input.deviceId,
        input.mediaId,
        input.scheduleId,
        input.playbackInstanceId ?? '',
        input.startTime,
        input.endTime,
        String(input.duration),
        input.completed ? '1' : '0',
    ].join('|'))
        .digest('hex');
}
export function buildProofOfPlayObjectKey(deviceId, idempotencyKey) {
    return `proof-of-play/${deviceId}/${idempotencyKey}.json`;
}
export async function processHeartbeatTelemetry(job) {
    const db = getDatabase();
    const existing = await db
        .select({ id: schema.heartbeats.id })
        .from(schema.heartbeats)
        .where(eq(schema.heartbeats.storage_object_id, job.storageObjectId))
        .limit(1);
    if (existing.length > 0) {
        return;
    }
    const payload = JSON.stringify({
        ...job.payload,
        received_at: job.receivedAt,
    });
    const upload = await putObject(HEARTBEAT_BUCKET, job.objectKey, payload, 'application/json');
    const [existingStorageObject] = await db
        .select({ id: schema.storageObjects.id })
        .from(schema.storageObjects)
        .where(eq(schema.storageObjects.id, job.storageObjectId))
        .limit(1);
    if (existingStorageObject) {
        await db
            .update(schema.storageObjects)
            .set({
            bucket: HEARTBEAT_BUCKET,
            object_key: job.objectKey,
            content_type: 'application/json',
            size: Buffer.byteLength(payload),
            sha256: upload.sha256,
        })
            .where(eq(schema.storageObjects.id, job.storageObjectId));
    }
    else {
        await db.insert(schema.storageObjects).values({
            id: job.storageObjectId,
            bucket: HEARTBEAT_BUCKET,
            object_key: job.objectKey,
            content_type: 'application/json',
            size: Buffer.byteLength(payload),
            sha256: upload.sha256,
        });
    }
    await db.insert(schema.heartbeats).values({
        screen_id: job.deviceId,
        status: job.status,
        storage_object_id: job.storageObjectId,
        created_at: new Date(job.receivedAt),
    });
}
export async function processProofOfPlayTelemetry(job) {
    const db = getDatabase();
    const existing = await db
        .select({ id: schema.proofOfPlay.id })
        .from(schema.proofOfPlay)
        .where(eq(schema.proofOfPlay.idempotency_key, job.idempotencyKey))
        .limit(1);
    if (existing.length > 0) {
        return;
    }
    const payload = JSON.stringify({
        device_id: job.deviceId,
        media_id: job.mediaId,
        schedule_id: job.scheduleId,
        playback_instance_id: job.playbackInstanceId,
        scene_id: job.sceneId ?? null,
        slot_id: job.slotId ?? null,
        item_id: job.itemId ?? null,
        start_time: job.startTime,
        end_time: job.endTime,
        duration: job.duration,
        completed: job.completed,
        received_at: job.receivedAt,
    });
    const upload = await putObject(PROOF_OF_PLAY_BUCKET, job.objectKey, payload, 'application/json');
    const [existingStorageObject] = await db
        .select({ id: schema.storageObjects.id })
        .from(schema.storageObjects)
        .where(and(eq(schema.storageObjects.bucket, PROOF_OF_PLAY_BUCKET), eq(schema.storageObjects.object_key, job.objectKey)))
        .limit(1);
    let storageObjectId = existingStorageObject?.id ?? null;
    if (existingStorageObject) {
        await db
            .update(schema.storageObjects)
            .set({
            content_type: 'application/json',
            size: Buffer.byteLength(payload),
            sha256: upload.sha256,
        })
            .where(eq(schema.storageObjects.id, existingStorageObject.id));
    }
    else {
        const [storageObject] = await db
            .insert(schema.storageObjects)
            .values({
            bucket: PROOF_OF_PLAY_BUCKET,
            object_key: job.objectKey,
            content_type: 'application/json',
            size: Buffer.byteLength(payload),
            sha256: upload.sha256,
        })
            .returning({ id: schema.storageObjects.id });
        storageObjectId = storageObject?.id ?? null;
    }
    const inserted = await db
        .insert(schema.proofOfPlay)
        .values({
        screen_id: job.deviceId,
        media_id: job.mediaId,
        presentation_id: job.scheduleId,
        schedule_id: job.scheduleId,
        scene_id: job.sceneId ?? null,
        slot_id: job.slotId ?? null,
        item_id: job.itemId ?? null,
        playback_instance_id: job.playbackInstanceId,
        started_at: new Date(job.startTime),
        ended_at: new Date(job.endTime),
        storage_object_id: storageObjectId,
        created_at: new Date(job.receivedAt),
        idempotency_key: job.idempotencyKey,
    })
        .returning({ id: schema.proofOfPlay.id });
    if (!inserted.length || !getSocketServer()) {
        return;
    }
    const playbackState = await buildScreenPlaybackStateById(job.deviceId, { db });
    if (playbackState) {
        emitScreenStateUpdateGlobal(playbackState);
    }
}
export async function processScreenshotTelemetry(job) {
    const db = getDatabase();
    const existing = await db
        .select({ id: schema.screenshots.id })
        .from(schema.screenshots)
        .where(eq(schema.screenshots.storage_object_id, job.storageObjectId))
        .limit(1);
    if (existing.length > 0) {
        return;
    }
    const imageBuffer = Buffer.from(job.imageData, 'base64');
    const contentType = job.mimeType === 'image/jpeg' || job.mimeType === 'image/webp' ? job.mimeType : 'image/png';
    const upload = await putObject(SCREENSHOT_BUCKET, job.objectKey, imageBuffer, contentType);
    const [existingStorageObject] = await db
        .select({ id: schema.storageObjects.id })
        .from(schema.storageObjects)
        .where(eq(schema.storageObjects.id, job.storageObjectId))
        .limit(1);
    if (existingStorageObject) {
        await db
            .update(schema.storageObjects)
            .set({
            bucket: SCREENSHOT_BUCKET,
            object_key: job.objectKey,
            content_type: contentType,
            size: imageBuffer.length,
            sha256: upload.sha256,
        })
            .where(eq(schema.storageObjects.id, job.storageObjectId));
    }
    else {
        await db.insert(schema.storageObjects).values({
            id: job.storageObjectId,
            bucket: SCREENSHOT_BUCKET,
            object_key: job.objectKey,
            content_type: contentType,
            size: imageBuffer.length,
            sha256: upload.sha256,
        });
    }
    await db.insert(schema.screenshots).values({
        screen_id: job.deviceId,
        storage_object_id: job.storageObjectId,
        created_at: new Date(job.timestamp),
    });
    if (!getSocketServer()) {
        return;
    }
    let screenshotUrl = null;
    try {
        screenshotUrl = await getPresignedUrl(SCREENSHOT_BUCKET, job.objectKey, 3600);
    }
    catch (error) {
        logger.warn({ error, deviceId: job.deviceId, objectKey: job.objectKey }, 'Failed to presign screenshot preview');
    }
    emitScreenPreviewUpdateGlobal({
        screenId: job.deviceId,
        captured_at: job.timestamp,
        screenshot_url: screenshotUrl,
        stale: false,
        storage_object_id: job.storageObjectId,
    });
}
