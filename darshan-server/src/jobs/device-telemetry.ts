import { createHash } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getDatabase, schema } from '@/db';
import { createLogger } from '@/utils/logger';
import { deleteObject, getPresignedUrl, putObject } from '@/s3';
import { buildScreenPlaybackStateById } from '@/screens/playback';
import { emitScreenPreviewUpdateGlobal, emitScreenStateUpdateGlobal } from '@/realtime/screens-namespace';
import { getSocketServer } from '@/realtime/socket-server';

const logger = createLogger('device-telemetry-jobs');

export const HEARTBEAT_BUCKET = 'logs-heartbeats';
export const PROOF_OF_PLAY_BUCKET = 'logs-proof-of-play';
export const SCREENSHOT_BUCKET = 'device-screenshots';

async function discardUnreferencedTelemetryObject(
  storageObjectId: string | null,
  bucket: string,
  objectKey: string,
  cause: unknown
) {
  const db = getDatabase();
  // A concurrent proof-of-play retry can lose the bucket/key uniqueness race
  // before it learns the winning row id. Resolve by key as well so compensating
  // cleanup never removes an object already referenced by the winning job.
  const resolvedStorageObjectId = storageObjectId ?? (await db
    .select({ id: schema.storageObjects.id })
    .from(schema.storageObjects)
    .where(and(eq(schema.storageObjects.bucket, bucket), eq(schema.storageObjects.object_key, objectKey)))
    .limit(1))[0]?.id ?? null;
  const referenced = resolvedStorageObjectId
    ? await db.execute<{ referenced: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1 FROM heartbeats WHERE storage_object_id = ${resolvedStorageObjectId}::uuid
          UNION ALL
          SELECT 1 FROM proof_of_play WHERE storage_object_id = ${resolvedStorageObjectId}::uuid
          UNION ALL
          SELECT 1 FROM screenshots WHERE storage_object_id = ${resolvedStorageObjectId}::uuid
        ) AS referenced
      `)
    : null;
  if (referenced?.rows[0]?.referenced) return;

  try {
    await deleteObject(bucket, objectKey);
  } catch (cleanupError) {
    // Retain the storage row when object deletion fails so the ordinary orphan
    // cleanup path still has an addressable retry record.
    await db
      .insert(schema.storageObjects)
      .values({
        ...(resolvedStorageObjectId ? { id: resolvedStorageObjectId } : {}),
        bucket,
        object_key: objectKey,
      })
      .onConflictDoNothing();
    logger.error({ cause, cleanupError, storageObjectId: resolvedStorageObjectId, bucket, objectKey }, 'Failed to discard rejected telemetry object');
    return;
  }

  if (resolvedStorageObjectId) {
    await db.execute(sql`
      DELETE FROM storage_objects
      WHERE id = ${resolvedStorageObjectId}::uuid
        AND NOT EXISTS (SELECT 1 FROM heartbeats WHERE storage_object_id = ${resolvedStorageObjectId}::uuid)
        AND NOT EXISTS (SELECT 1 FROM proof_of_play WHERE storage_object_id = ${resolvedStorageObjectId}::uuid)
        AND NOT EXISTS (SELECT 1 FROM screenshots WHERE storage_object_id = ${resolvedStorageObjectId}::uuid)
    `);
  }
}

export interface HeartbeatTelemetryJob {
  deviceId: string;
  status: 'ONLINE' | 'OFFLINE' | 'ERROR';
  payload: Record<string, unknown>;
  receivedAt: string;
  objectKey: string;
  storageObjectId: string;
}

export interface ProofOfPlayTelemetryJob {
  deviceId: string;
  mediaId: string;
  scheduleId: string;
  publishId?: string | null;
  playbackInstanceId: string;
  sceneId?: string | null;
  slotId?: string | null;
  itemId?: string | null;
  pageNumber?: number | null;
  startTime: string;
  endTime: string;
  duration: number;
  completed: boolean;
  receivedAt: string;
  objectKey: string;
  idempotencyKey: string;
}

export interface ScreenshotTelemetryJob {
  deviceId: string;
  timestamp: string;
  imageData: string;
  mimeType?: string;
  objectKey: string;
  storageObjectId: string;
}

function hashSuffix(input: string) {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

export function buildHeartbeatObjectKey(deviceId: string, receivedAt: string, payload: Record<string, unknown>) {
  const stamp = Date.parse(receivedAt) || Date.now();
  return `heartbeats/${deviceId}/${stamp}-${hashSuffix(JSON.stringify(payload))}.json`;
}

export function buildScreenshotObjectKey(
  deviceId: string,
  timestamp: string,
  storageObjectId: string,
  mimeType: string = 'image/png'
) {
  const stamp = Date.parse(timestamp) || Date.now();
  const extension =
    mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
  return `device-screenshots/${deviceId}/${stamp}-${storageObjectId}.${extension}`;
}

export function buildProofOfPlayIdempotencyKey(input: {
  deviceId: string;
  mediaId: string;
  scheduleId: string;
  publishId?: string | null;
  playbackInstanceId?: string | null;
  startTime: string;
  endTime: string;
  duration: number;
  completed: boolean;
  pageNumber?: number | null;
}) {
  const identity = [
    input.deviceId,
    input.mediaId,
    input.scheduleId,
    input.playbackInstanceId ?? '',
  ];
  if (input.publishId != null) identity.push(`publish:${input.publishId}`);
  // Preserve the pre-page-selection hash exactly for legacy/null events so an
  // upgrade cannot duplicate an event whose first response was lost.
  if (input.pageNumber != null) identity.push(`page:${input.pageNumber}`);
  identity.push(
    input.startTime,
    input.endTime,
    String(input.duration),
    input.completed ? '1' : '0'
  );
  return createHash('sha256')
    .update(identity.join('|'))
    .digest('hex');
}

export function buildProofOfPlayObjectKey(deviceId: string, idempotencyKey: string) {
  return `proof-of-play/${deviceId}/${idempotencyKey}.json`;
}

export async function processHeartbeatTelemetry(job: HeartbeatTelemetryJob) {
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
  try {
    await db.transaction(async (tx) => {
      const [existingStorageObject] = await tx
        .select({ id: schema.storageObjects.id })
        .from(schema.storageObjects)
        .where(eq(schema.storageObjects.id, job.storageObjectId))
        .limit(1);

      if (existingStorageObject) {
        await tx
          .update(schema.storageObjects)
          .set({
            bucket: HEARTBEAT_BUCKET,
            object_key: job.objectKey,
            content_type: 'application/json',
            size: Buffer.byteLength(payload),
            sha256: upload.sha256,
          })
          .where(eq(schema.storageObjects.id, job.storageObjectId));
      } else {
        await tx.insert(schema.storageObjects).values({
          id: job.storageObjectId,
          bucket: HEARTBEAT_BUCKET,
          object_key: job.objectKey,
          content_type: 'application/json',
          size: Buffer.byteLength(payload),
          sha256: upload.sha256,
        });
      }

      await tx.insert(schema.heartbeats).values({
        screen_id: job.deviceId,
        status: job.status,
        storage_object_id: job.storageObjectId,
        created_at: new Date(job.receivedAt),
      });
    });
  } catch (error) {
    await discardUnreferencedTelemetryObject(job.storageObjectId, HEARTBEAT_BUCKET, job.objectKey, error);
    throw error;
  }
}

export async function processProofOfPlayTelemetry(job: ProofOfPlayTelemetryJob) {
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
    publish_id: job.publishId ?? null,
    playback_instance_id: job.playbackInstanceId,
    scene_id: job.sceneId ?? null,
    slot_id: job.slotId ?? null,
    item_id: job.itemId ?? null,
    page_number: job.pageNumber ?? null,
    start_time: job.startTime,
    end_time: job.endTime,
    duration: job.duration,
    completed: job.completed,
    received_at: job.receivedAt,
  });
  const upload = await putObject(PROOF_OF_PLAY_BUCKET, job.objectKey, payload, 'application/json');
  let storageObjectId: string | null = null;
  let inserted: Array<{ id: string }> = [];
  try {
    await db.transaction(async (tx) => {
      const [existingStorageObject] = await tx
        .select({ id: schema.storageObjects.id })
        .from(schema.storageObjects)
        .where(and(eq(schema.storageObjects.bucket, PROOF_OF_PLAY_BUCKET), eq(schema.storageObjects.object_key, job.objectKey)))
        .limit(1);

      storageObjectId = existingStorageObject?.id ?? null;
      if (existingStorageObject) {
        await tx
          .update(schema.storageObjects)
          .set({
            content_type: 'application/json',
            size: Buffer.byteLength(payload),
            sha256: upload.sha256,
          })
          .where(eq(schema.storageObjects.id, existingStorageObject.id));
      } else {
        const [storageObject] = await tx
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

      inserted = await tx
        .insert(schema.proofOfPlay)
        .values({
          screen_id: job.deviceId,
          media_id: job.mediaId,
          presentation_id: job.scheduleId,
          schedule_id: job.scheduleId,
          publish_id: job.publishId ?? null,
          scene_id: job.sceneId ?? null,
          slot_id: job.slotId ?? null,
          item_id: job.itemId ?? null,
          page_number: job.pageNumber ?? null,
          playback_instance_id: job.playbackInstanceId,
          started_at: new Date(job.startTime),
          ended_at: new Date(job.endTime),
          completed: job.completed,
          storage_object_id: storageObjectId,
          created_at: new Date(job.receivedAt),
          idempotency_key: job.idempotencyKey,
        })
        .returning({ id: schema.proofOfPlay.id });
    });
  } catch (error) {
    await discardUnreferencedTelemetryObject(storageObjectId, PROOF_OF_PLAY_BUCKET, job.objectKey, error);
    throw error;
  }

  if (!inserted.length || !getSocketServer()) {
    return;
  }

  const playbackState = await buildScreenPlaybackStateById(job.deviceId, { db });
  if (playbackState) {
    emitScreenStateUpdateGlobal(playbackState);
  }
}

export async function processScreenshotTelemetry(job: ScreenshotTelemetryJob) {
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
  try {
    await db.transaction(async (tx) => {
      const [existingStorageObject] = await tx
        .select({ id: schema.storageObjects.id })
        .from(schema.storageObjects)
        .where(eq(schema.storageObjects.id, job.storageObjectId))
        .limit(1);

      if (existingStorageObject) {
        await tx
          .update(schema.storageObjects)
          .set({
            bucket: SCREENSHOT_BUCKET,
            object_key: job.objectKey,
            content_type: contentType,
            size: imageBuffer.length,
            sha256: upload.sha256,
          })
          .where(eq(schema.storageObjects.id, job.storageObjectId));
      } else {
        await tx.insert(schema.storageObjects).values({
          id: job.storageObjectId,
          bucket: SCREENSHOT_BUCKET,
          object_key: job.objectKey,
          content_type: contentType,
          size: imageBuffer.length,
          sha256: upload.sha256,
        });
      }

      await tx.insert(schema.screenshots).values({
        screen_id: job.deviceId,
        storage_object_id: job.storageObjectId,
        created_at: new Date(job.timestamp),
      });
    });
  } catch (error) {
    await discardUnreferencedTelemetryObject(job.storageObjectId, SCREENSHOT_BUCKET, job.objectKey, error);
    throw error;
  }

  if (!getSocketServer()) {
    return;
  }

  let screenshotUrl: string | null = null;
  try {
    screenshotUrl = await getPresignedUrl(SCREENSHOT_BUCKET, job.objectKey, 3600);
  } catch (error) {
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
