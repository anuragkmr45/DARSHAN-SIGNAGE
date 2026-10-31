import { createHash } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getDatabase, schema } from '@/db';
import { createLogger } from '@/utils/logger';
import { getPresignedUrl, putObject } from '@/s3';
import { buildScreenPlaybackStateById } from '@/screens/playback';
import { emitScreenPreviewUpdateGlobal, emitScreenStateUpdateGlobal } from '@/realtime/screens-namespace';
import { getSocketServer } from '@/realtime/socket-server';
import { runWithWorkerAdmission } from '@/maintenance/worker-admission';
import { recordDisplayProfile } from '@/services/screen-display-state-service';
import { queueScreenStateRefresh } from '@/services/screen-state-refresh';
import type { DisplayProfileV1 } from '@/utils/display-profile';
import {
  persistDeviceIdentitySessionObservation,
  type DeviceIdentitySessionObservation,
} from '@/services/device-identity-session-service';

const logger = createLogger('device-telemetry-jobs');

export const HEARTBEAT_BUCKET = 'logs-heartbeats';
export const PROOF_OF_PLAY_BUCKET = 'logs-proof-of-play';
export const SCREENSHOT_BUCKET = 'device-screenshots';

export interface HeartbeatTelemetryJob {
  deviceId: string;
  status: 'ONLINE' | 'OFFLINE' | 'ERROR';
  payload: Record<string, unknown>;
  receivedAt: string;
  objectKey: string;
  storageObjectId: string;
  screenObservation?: {
    status: 'ACTIVE' | 'OFFLINE' | 'INACTIVE';
    currentScheduleId: string | null;
    currentMediaId: string | null;
    currentSceneId: string | null;
    activeSlots: unknown[];
  };
  displayProfile?: DisplayProfileV1;
  identityObservation?: DeviceIdentitySessionObservation;
}

export interface ProofOfPlayTelemetryJob {
  deviceId: string;
  mediaId: string;
  scheduleId: string;
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

export function buildHeartbeatObjectKey(
  deviceId: string,
  receivedAt: string,
  storageObjectId: string,
  payload: Record<string, unknown>
) {
  const stamp = Date.parse(receivedAt) || Date.now();
  return `heartbeats/${deviceId}/${stamp}-${storageObjectId}-${hashSuffix(JSON.stringify(payload))}.json`;
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

async function persistHeartbeatTelemetry(job: HeartbeatTelemetryJob) {
  const db = getDatabase();
  const existing = await db
    .select({ id: schema.heartbeats.id })
    .from(schema.heartbeats)
    .where(eq(schema.heartbeats.storage_object_id, job.storageObjectId))
    .limit(1);

  if (existing.length > 0) {
    queueScreenStateRefresh(job.deviceId);
    return;
  }

  const payload = JSON.stringify({
    ...job.payload,
    received_at: job.receivedAt,
  });
  const upload = await putObject(HEARTBEAT_BUCKET, job.objectKey, payload, 'application/json');
  const receivedAt = new Date(job.receivedAt);
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

    const inserted = await tx
      .insert(schema.heartbeats)
      .values({
        screen_id: job.deviceId,
        status: job.status,
        storage_object_id: job.storageObjectId,
        created_at: receivedAt,
      })
      .onConflictDoNothing({ target: schema.heartbeats.storage_object_id })
      .returning({ id: schema.heartbeats.id });
    if (!inserted.length) return;

    if (job.identityObservation) {
      await persistDeviceIdentitySessionObservation(job.identityObservation, tx);
    }
    if (job.displayProfile) {
      const displayWrite = await recordDisplayProfile(job.deviceId, job.displayProfile, tx);
      if (!displayWrite.applied) {
        logger.debug({ deviceId: job.deviceId, reason: displayWrite.reason }, 'Ignored stale display profile observation');
      }
    }

    if (job.screenObservation) {
      await tx
        .update(schema.screens)
        .set({
          status: job.screenObservation.status,
          // Drizzle 0.29 serializes Date values for timestamptz via
          // toUTCString(), which drops milliseconds. Preserve the accepted
          // event instant so same-second out-of-order delivery cannot regress
          // device state.
          last_heartbeat_at: sql`${job.receivedAt}::timestamptz`,
          current_schedule_id: job.screenObservation.currentScheduleId,
          current_media_id: job.screenObservation.currentMediaId,
          current_scene_id: job.screenObservation.currentSceneId,
          active_slots: job.screenObservation.activeSlots,
          updated_at: sql`GREATEST(${schema.screens.updated_at}, ${receivedAt})`,
        })
        .where(and(
          eq(schema.screens.id, job.deviceId),
          sql`(${schema.screens.last_heartbeat_at} IS NULL OR ${schema.screens.last_heartbeat_at} <= ${job.receivedAt}::timestamptz)`
        ));
    }
  });
  queueScreenStateRefresh(job.deviceId);
}

export async function processHeartbeatTelemetry(job: HeartbeatTelemetryJob) {
  return runWithWorkerAdmission('telemetry:heartbeat', () => persistHeartbeatTelemetry(job));
}

async function persistProofOfPlayTelemetry(job: ProofOfPlayTelemetryJob) {
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
    page_number: job.pageNumber ?? null,
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
  } else {
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
      page_number: job.pageNumber ?? null,
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

export async function processProofOfPlayTelemetry(job: ProofOfPlayTelemetryJob) {
  return runWithWorkerAdmission('telemetry:proof-of-play', () => persistProofOfPlayTelemetry(job));
}

async function persistScreenshotTelemetry(job: ScreenshotTelemetryJob) {
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
  } else {
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

export async function processScreenshotTelemetry(job: ScreenshotTelemetryJob) {
  return runWithWorkerAdmission('telemetry:screenshot', () => persistScreenshotTelemetry(job));
}
