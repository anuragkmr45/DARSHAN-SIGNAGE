import PgBoss from 'pg-boss';
import ffmpeg from 'fluent-ffmpeg';
import { createHash, randomUUID } from 'crypto';
import { execFile as execFileCallback } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { getDatabase, schema, type DbExecutor } from '@/db';
import { config as appConfig } from '@/config';
import { abortMultipartUpload, deleteObject, getObject, putObject } from '@/s3';
import { createLogger } from '@/utils/logger';
import { createBackupRun, getLatestBackupRun, runFullBackup } from '@/utils/backup-runs';
import { getCachedSettings } from '@/utils/settings';
import { buildSourceFilename, isPdfDocument, requiresDocumentConversion } from '@/utils/media-processing';
import { inspectPdfPageCount, PdfInspectionError } from '@/utils/pdf-metadata';
import { captureWebpagePreview } from '@/utils/webpage-capture';
import {
  assertWebpageUrlAllowed,
  redactWebpageUrlForLogs,
  WebpageUrlPolicyError,
} from '@/utils/webpage-url-policy';
import { getLibreOfficeExecutable, getResolvedFfmpegPath } from '@/utils/runtime-dependencies';
import {
  buildLibreOfficeConversionArgs,
  getLibreOfficeOutputPath,
  LIBREOFFICE_CONVERSION_TIMEOUT_MS,
} from '@/utils/libreoffice-conversion';
import {
  commitReadyMediaIfProcessing,
  failMediaIfProcessing,
} from '@/jobs/media-processing-state';
import {
  type HeartbeatTelemetryJob,
  type ProofOfPlayTelemetryJob,
  type ScreenshotTelemetryJob,
  processHeartbeatTelemetry,
  processProofOfPlayTelemetry,
  processScreenshotTelemetry,
} from '@/jobs/device-telemetry';
import { observeJobProcessing, recordJobEnqueue } from '@/observability/metrics';
import {
  createPlaybackRefreshCommands,
  type PlaybackRefreshCommandBatch,
} from '@/services/playback-refresh-commands';
import { reconcileEmergencyTransitions } from '@/services/emergency-transition-outbox';
import { processLiveFallbackPreparation, scavengeLiveFallbackStaging } from '@/services/live-fallback-preparation';
import { prepareLiveHlsFallback } from '@/services/live-fallback-hls';

const logger = createLogger('jobs');

ffmpeg.setFfmpegPath(getResolvedFfmpegPath() || appConfig.FFMPEG_PATH);

const READY_BUCKET = 'media-ready';
const THUMBNAIL_BUCKET = 'media-thumbnails';
const ARCHIVE_BUCKET = 'archives';
const HLS_SEGMENT_CONTENT_TYPE = 'video/mp2t';
const THUMBNAIL_CONTENT_TYPE = 'image/jpeg';
const NDJSON_CONTENT_TYPE = 'application/x-ndjson';
const DOCUMENT_READY_CONTENT_TYPE = 'application/pdf';
const WEBPAGE_FALLBACK_CONTENT_TYPE = 'image/png';

const QUALITY_OPTIONS: Record<FFmpegTranscodeJob['quality'], string[]> = {
  low: ['-preset', 'veryfast', '-crf', '30', '-b:a', '96k'],
  medium: ['-preset', 'fast', '-crf', '24', '-b:a', '128k'],
  high: ['-preset', 'slower', '-crf', '20', '-b:a', '192k'],
};

const FORMAT_CONTENT_TYPE: Record<FFmpegTranscodeJob['targetFormat'], string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  hls: 'application/vnd.apple.mpegurl',
};

async function runTranscode(
  inputPath: string,
  outputPath: string,
  job: FFmpegTranscodeJob,
  segmentTemplate: string
) {
  const qualityFlags = QUALITY_OPTIONS[job.quality] ?? QUALITY_OPTIONS.medium;

  return new Promise<void>((resolve, reject) => {
    const command = ffmpeg(inputPath).outputOptions([...qualityFlags]);

    if (job.targetFormat === 'hls') {
      command.videoCodec('libx264').audioCodec('aac').format('hls');
      command.outputOptions([
        '-hls_time',
        '6',
        '-hls_list_size',
        '0',
        '-hls_playlist_type',
        'vod',
        '-hls_segment_filename',
        segmentTemplate,
      ]);
    } else if (job.targetFormat === 'webm') {
      command.videoCodec('libvpx-vp9').audioCodec('libopus').format('webm');
    } else {
      command.videoCodec('libx264').audioCodec('aac').format('mp4');
      command.outputOptions(['-movflags', 'faststart']);
    }

    command
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (error) => reject(error))
      .run();
  });
}

async function cleanupTempDir(dir: string | null) {
  if (!dir) return;
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (error) {
    logger.warn(error, 'Failed to clean up temp directory');
  }
}

async function runCommand(command: string, args: string[], timeout: number) {
  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFileCallback(command, args, { maxBuffer: 10 * 1024 * 1024, timeout, killSignal: 'SIGKILL' }, (error, stdout, stderr) => {
      if (error) {
        reject(
          Object.assign(error, {
            stdout,
            stderr,
          })
        );
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function upsertStorageObject(params: {
  bucket: string;
  objectKey: string;
  contentType?: string | null;
  size?: number | null;
  sha256?: string | null;
}) {
  const db = getDatabase();
  const [storageObject] = await db
    .insert(schema.storageObjects)
    .values({
      bucket: params.bucket,
      object_key: params.objectKey,
      content_type: params.contentType ?? null,
      size: params.size ?? null,
      sha256: params.sha256 ?? null,
    })
    .onConflictDoUpdate({
      target: [schema.storageObjects.bucket, schema.storageObjects.object_key],
      set: {
        content_type: params.contentType ?? null,
        size: params.size ?? null,
        sha256: params.sha256 ?? null,
      },
    })
    .returning();

  return storageObject;
}

export type WebpageProcessingStage =
  | 'media-load'
  | 'webpage-policy'
  | 'webpage-capture'
  | 'fallback-upload'
  | 'storage-object-upsert'
  | 'media-ready-update';

export class WebpageProcessingStageError extends Error {
  public readonly cause?: unknown;

  constructor(public readonly stage: WebpageProcessingStage, public readonly originalError: unknown) {
    const message = originalError instanceof Error ? originalError.message : String(originalError);
    super(message || `Webpage processing failed during ${stage}`);
    this.name = 'WebpageProcessingStageError';
    this.cause = originalError;
  }
}

async function runWebpageStage<T>(stage: WebpageProcessingStage, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof WebpageProcessingStageError) {
      throw error;
    }
    throw new WebpageProcessingStageError(stage, error);
  }
}

function getWebpageProcessingCause(error: unknown) {
  return error instanceof WebpageProcessingStageError ? error.originalError : error;
}

export function getWebpageProcessingStage(error: unknown): WebpageProcessingStage {
  if (error instanceof WebpageProcessingStageError) {
    return error.stage;
  }
  if (error instanceof WebpageUrlPolicyError) {
    return 'webpage-policy';
  }
  return 'webpage-capture';
}

function sanitizeWebpageErrorText(value: string, sourceUrl?: string) {
  const sourceOrigin = sourceUrl ? redactWebpageUrlForLogs(sourceUrl) : undefined;
  const sanitized = sourceUrl && sourceOrigin ? value.split(sourceUrl).join(sourceOrigin) : value;

  return sanitized.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (rawMatch) => {
    let match = rawMatch;
    let suffix = '';
    while (/[),.;\]]$/.test(match)) {
      suffix = `${match.at(-1)}${suffix}`;
      match = match.slice(0, -1);
    }
    return `${redactWebpageUrlForLogs(match)}${suffix}`;
  });
}

function getErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number' ? String(code) : undefined;
}

export function serializeWebpageProcessingError(error: unknown, sourceUrl?: string) {
  const cause = getWebpageProcessingCause(error);
  const name = cause instanceof Error ? cause.name : typeof cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  const stack = cause instanceof Error ? cause.stack : undefined;
  const code = getErrorCode(cause);

  return {
    name,
    message: sanitizeWebpageErrorText(message, sourceUrl),
    ...(code ? { code } : {}),
    ...(stack ? { stack: sanitizeWebpageErrorText(stack, sourceUrl) } : {}),
  };
}

function getWebpageFailureReason(error: unknown) {
  const stage = getWebpageProcessingStage(error);
  if (stage === 'media-load') {
    return 'WEBPAGE_MEDIA_LOAD_FAILED';
  }
  if (stage === 'fallback-upload') {
    return 'WEBPAGE_FALLBACK_UPLOAD_FAILED';
  }
  if (stage === 'storage-object-upsert') {
    return 'WEBPAGE_STORAGE_OBJECT_UPSERT_FAILED';
  }
  if (stage === 'media-ready-update') {
    return 'WEBPAGE_MEDIA_READY_UPDATE_FAILED';
  }

  const cause = getWebpageProcessingCause(error);
  if (cause instanceof WebpageUrlPolicyError) {
    return cause.code;
  }
  if (cause instanceof Error && cause.name === 'AbortError') {
    return 'WEBPAGE_REQUEST_TIMEOUT';
  }

  if (cause instanceof Error && cause.name === 'TimeoutError') {
    return 'WEBPAGE_REQUEST_TIMEOUT';
  }

  const message = cause instanceof Error ? cause.message : String(cause);
  const statusMatch = message.match(/status\s+(\d{3})/i);
  if (statusMatch) {
    return `WEBPAGE_HTTP_${statusMatch[1]}`;
  }

  if (message.toLowerCase().includes('did not return html')) {
    return 'WEBPAGE_NON_HTML_CONTENT';
  }

  if (message.toLowerCase().includes('response exceeded')) {
    return 'WEBPAGE_RESPONSE_TOO_LARGE';
  }

  if (message.toLowerCase().includes('fetch failed')) {
    return 'WEBPAGE_UNREACHABLE';
  }

  if (message.toLowerCase().includes('timeout')) {
    return 'WEBPAGE_REQUEST_TIMEOUT';
  }

  if (message.toLowerCase().includes('net::')) {
    return 'WEBPAGE_UNREACHABLE';
  }

  return 'WEBPAGE_CAPTURE_FAILED';
}

async function verifyWebpageSource(
  sourceUrl: string,
  dependencies: {
    assertUrlAllowed?: typeof assertWebpageUrlAllowed;
    capturePreview?: typeof captureWebpagePreview;
  } = {}
) {
  const assertUrlAllowed = dependencies.assertUrlAllowed ?? assertWebpageUrlAllowed;
  const capturePreview = dependencies.capturePreview ?? captureWebpagePreview;
  await runWebpageStage('webpage-policy', () => assertUrlAllowed(sourceUrl, 'navigation'));
  const capture = await runWebpageStage('webpage-capture', () => capturePreview(sourceUrl));
  return {
    finalUrl: capture.finalUrl,
    contentType: capture.contentType,
    title: capture.title,
    screenshot: capture.screenshot,
  };
}

type WebpageJobLogger = Pick<typeof logger, 'warn' | 'error'>;

export async function processWebpageVerifyCaptureJob(
  job: WebpageVerifyCaptureJob,
  dependencies: {
    db?: ReturnType<typeof getDatabase>;
    logger?: WebpageJobLogger;
    verifySource?: typeof verifyWebpageSource;
    putObject?: typeof putObject;
    deleteObject?: typeof deleteObject;
    upsertStorageObject?: typeof upsertStorageObject;
    now?: () => Date;
  } = {}
) {
  const db = dependencies.db ?? getDatabase();
  const jobLogger = dependencies.logger ?? logger;
  const now = dependencies.now ?? (() => new Date());
  const verifySource = dependencies.verifySource ?? verifyWebpageSource;
  const putReadyObject = dependencies.putObject ?? putObject;
  const deleteReadyObject = dependencies.deleteObject ?? deleteObject;
  const upsertReadyStorageObject = dependencies.upsertStorageObject ?? upsertStorageObject;
  const { mediaId, sourceUrl } = job;
  const mode = job.mode ?? 'INITIAL';

  try {
    const [media] = await runWebpageStage('media-load', async () =>
      db.select().from(schema.media).where(eq(schema.media.id, mediaId))
    );
    if (!media || media.deleted_at) {
      jobLogger.warn({ mediaId }, 'Media not found for webpage verification');
      return;
    }
    const expectedStatus = mode === 'REFRESH' ? 'READY' : 'PROCESSING';
    if (media.status !== expectedStatus) {
      jobLogger.warn({ mediaId, status: media.status }, 'Skipping stale webpage verification job');
      return;
    }
    if (job.refreshToken && media.webpage_preview_refresh_token !== job.refreshToken) {
      jobLogger.warn({ mediaId }, 'Skipping superseded webpage preview job');
      return;
    }

    const verification = await verifySource(sourceUrl);
    const previewBuffer = verification.screenshot;
    const contentHash = createHash('sha256').update(previewBuffer).digest('hex');
    const fallbackKey = `${mediaId}/webpage-previews/${contentHash}.png`;
    const upload = await runWebpageStage('fallback-upload', () =>
      putReadyObject(
        READY_BUCKET,
        fallbackKey,
        previewBuffer,
        WEBPAGE_FALLBACK_CONTENT_TYPE
      )
    );
    const readyObject = await runWebpageStage('storage-object-upsert', () =>
      upsertReadyStorageObject({
        bucket: READY_BUCKET,
        objectKey: fallbackKey,
        contentType: WEBPAGE_FALLBACK_CONTENT_TYPE,
        size: previewBuffer.length,
        sha256: upload.sha256,
      })
    );

    let committed = false;
    await runWebpageStage('media-ready-update', async () => {
      const completedAt = now();
      if (mode === 'REFRESH') {
        const [updated] = await db
          .update(schema.media)
          .set({
            ready_object_id: readyObject.id,
            webpage_preview_captured_at: completedAt,
            webpage_preview_attempted_at: completedAt,
            webpage_preview_refresh_token: null,
            webpage_preview_last_error: null,
            status_reason: null,
            updated_at: completedAt,
          })
          .where(
            and(
              eq(schema.media.id, mediaId),
              eq(schema.media.status, 'READY'),
              isNull(schema.media.deleted_at),
              job.refreshToken
                ? eq(schema.media.webpage_preview_refresh_token, job.refreshToken)
                : undefined
            )
          )
          .returning({ id: schema.media.id });
        committed = Boolean(updated);
      } else {
        const result = await commitReadyMediaIfProcessing({
          mediaId,
          readyObjectId: readyObject.id,
          expectedWebpagePreviewRefreshToken: job.refreshToken,
          values: {
            webpage_preview_captured_at: completedAt,
            webpage_preview_attempted_at: completedAt,
            webpage_preview_refresh_token: null,
            webpage_preview_last_error: null,
            updated_at: completedAt,
          },
          executor: db,
        });
        committed = result !== 'STALE';
      }

      if (!committed) {
        jobLogger.warn({ mediaId }, 'Discarded webpage result after media authority changed');
        const [current] = await db
          .select({ readyObjectId: schema.media.ready_object_id })
          .from(schema.media)
          .where(eq(schema.media.id, mediaId));
        if (current?.readyObjectId !== readyObject.id) {
          await deleteReadyObject(READY_BUCKET, fallbackKey).catch((cleanupError) => {
            jobLogger.warn({ cleanupError, mediaId, objectKey: fallbackKey }, 'Stale webpage preview cleanup will be retried');
          });
        }
      }
    });

    if (committed && mode === 'REFRESH') {
      await queueWebpagePreviewPlaybackRefresh({
        mediaId,
        readyObjectId: readyObject.id,
        createdBy: media.created_by,
        db,
      }).catch((refreshError) => {
        jobLogger.warn({ refreshError, mediaId }, 'Failed to queue player refresh after preview update');
      });
    }
  } catch (error) {
    const stage = getWebpageProcessingStage(error);
    jobLogger.error(
      {
        stage,
        error: serializeWebpageProcessingError(error, sourceUrl),
        mediaId,
        sourceOrigin: redactWebpageUrlForLogs(sourceUrl),
      },
      'Webpage verification/capture failed'
    );
    const failureReason = getWebpageFailureReason(error);
    if (mode === 'REFRESH') {
      await db
        .update(schema.media)
        .set({
          webpage_preview_refresh_token: null,
          webpage_preview_last_error: failureReason,
          webpage_preview_attempted_at: now(),
        })
        .where(
          and(
            eq(schema.media.id, mediaId),
            eq(schema.media.status, 'READY'),
            isNull(schema.media.deleted_at),
            job.refreshToken
              ? eq(schema.media.webpage_preview_refresh_token, job.refreshToken)
              : undefined
          )
        );
    } else {
      if (job.refreshToken) {
        await db
          .update(schema.media)
          .set({
            webpage_preview_refresh_token: null,
            webpage_preview_last_error: failureReason,
            webpage_preview_attempted_at: now(),
          })
          .where(
            and(
              eq(schema.media.id, mediaId),
              isNull(schema.media.deleted_at),
              eq(schema.media.webpage_preview_refresh_token, job.refreshToken)
            )
          );
      }
      await failMediaIfProcessing({ mediaId, statusReason: failureReason, executor: db });
    }
  }
}

async function queueWebpagePreviewPlaybackRefresh(input: {
  mediaId: string;
  readyObjectId: string;
  createdBy: string;
  db?: DbExecutor;
}) {
  const db = input.db ?? getDatabase();
  const screens = await db.select({ id: schema.screens.id }).from(schema.screens);
  if (screens.length === 0) return;

  await queuePlaybackRefreshDispatch(
    {
      reason: 'DEFAULT_MEDIA',
      screenIds: screens.map((screen) => screen.id),
      createdBy: input.createdBy,
      defaultMediaVersion: `${input.mediaId}:${input.readyObjectId}`,
    },
    {
      singletonKey: 'webpage-preview-refresh',
      singletonSeconds: 60,
    }
  );
}

export type WebpagePreviewRefreshRequestResult = {
  mediaId: string;
  refreshStatus: 'QUEUED' | 'ALREADY_QUEUED';
  requestedAt: Date;
  refreshToken: string;
};

export async function requestWebpagePreviewRefresh(input: {
  mediaId: string;
  executor?: DbExecutor;
  requestedAt?: Date;
}): Promise<WebpagePreviewRefreshRequestResult> {
  const db = input.executor ?? getDatabase();
  const requestedAt = input.requestedAt ?? new Date();
  const [media] = await db.select().from(schema.media).where(eq(schema.media.id, input.mediaId));
  if (!media || media.deleted_at || media.type !== 'WEBPAGE' || !media.source_url) {
    throw new Error('WEBPAGE_MEDIA_NOT_FOUND');
  }
  if (media.status !== 'READY' && media.status !== 'FAILED') {
    if (media.webpage_preview_refresh_token) {
      return {
        mediaId: media.id,
        refreshStatus: 'ALREADY_QUEUED',
        requestedAt: media.webpage_preview_attempted_at ?? requestedAt,
        refreshToken: media.webpage_preview_refresh_token,
      };
    }
    throw new Error('WEBPAGE_PREVIEW_REFRESH_NOT_AVAILABLE');
  }
  if (media.webpage_preview_refresh_token) {
    return {
      mediaId: media.id,
      refreshStatus: 'ALREADY_QUEUED',
      requestedAt: media.webpage_preview_attempted_at ?? requestedAt,
      refreshToken: media.webpage_preview_refresh_token,
    };
  }

  const refreshToken = randomUUID();
  const mode: WebpageVerifyCaptureJob['mode'] = media.status === 'READY' ? 'REFRESH' : 'INITIAL';
  const [claimed] = await db
    .update(schema.media)
    .set({
      status: mode === 'INITIAL' ? 'PROCESSING' : 'READY',
      status_reason: mode === 'INITIAL' ? null : media.status_reason,
      webpage_preview_attempted_at: requestedAt,
      webpage_preview_refresh_token: refreshToken,
      webpage_preview_last_error: null,
      updated_at: mode === 'INITIAL' ? requestedAt : media.updated_at,
    })
    .where(
      and(
        eq(schema.media.id, media.id),
        eq(schema.media.status, media.status),
        isNull(schema.media.deleted_at),
        isNull(schema.media.webpage_preview_refresh_token)
      )
    )
    .returning({ id: schema.media.id });

  if (!claimed) {
    const [current] = await db
      .select({
        token: schema.media.webpage_preview_refresh_token,
        attemptedAt: schema.media.webpage_preview_attempted_at,
        deletedAt: schema.media.deleted_at,
      })
      .from(schema.media)
      .where(eq(schema.media.id, media.id));
    if (!current?.deletedAt && current?.token) {
      return {
        mediaId: media.id,
        refreshStatus: 'ALREADY_QUEUED',
        requestedAt: current.attemptedAt ?? requestedAt,
        refreshToken: current.token,
      };
    }
    throw new Error('WEBPAGE_PREVIEW_REFRESH_CONFLICT');
  }

  try {
    await queueWebpageVerifyCapture({
      mediaId: media.id,
      sourceUrl: media.source_url,
      mode,
      refreshToken,
    });
  } catch (error) {
    await db
      .update(schema.media)
      .set({
        status: media.status,
        status_reason: media.status_reason,
        webpage_preview_refresh_token: null,
        webpage_preview_last_error: 'WEBPAGE_CAPTURE_QUEUE_FAILED',
      })
      .where(
        and(
          eq(schema.media.id, media.id),
          isNull(schema.media.deleted_at),
          eq(schema.media.webpage_preview_refresh_token, refreshToken)
        )
      );
    throw error;
  }

  return { mediaId: media.id, refreshStatus: 'QUEUED', requestedAt, refreshToken };
}

export async function processWebpageRefreshDueJob(
  _job: WebpageRefreshDueJob,
  dependencies: {
    db?: DbExecutor;
    now?: () => Date;
    requestRefresh?: typeof requestWebpagePreviewRefresh;
  } = {}
) {
  const db = dependencies.db ?? getDatabase();
  const now = dependencies.now?.() ?? new Date();
  const cutoff = new Date(
    now.getTime() - appConfig.WEBPAGE_PREVIEW_REFRESH_INTERVAL_HOURS * 60 * 60 * 1000
  );
  const due = await db
    .select({ id: schema.media.id })
    .from(schema.media)
    .where(
      and(
        eq(schema.media.type, 'WEBPAGE'),
        eq(schema.media.status, 'READY'),
        isNull(schema.media.deleted_at),
        isNull(schema.media.webpage_preview_refresh_token),
        or(
          isNull(schema.media.webpage_preview_attempted_at),
          lte(schema.media.webpage_preview_attempted_at, cutoff)
        )
      )
    )
    .limit(appConfig.WEBPAGE_PREVIEW_REFRESH_BATCH_SIZE);

  let queued = 0;
  const requestRefresh = dependencies.requestRefresh ?? requestWebpagePreviewRefresh;
  for (const row of due) {
    try {
      const result = await requestRefresh({
        mediaId: row.id,
        executor: db,
        requestedAt: now,
      });
      if (result.refreshStatus === 'QUEUED') queued += 1;
    } catch (error) {
      logger.warn({ error, mediaId: row.id }, 'Failed to queue due webpage preview refresh');
    }
  }
  return { due: due.length, queued };
}

async function convertDocumentWithLibreOffice(inputPath: string, outputDir: string) {
  const libreOfficeExecutable = getLibreOfficeExecutable();
  if (!libreOfficeExecutable) {
    throw new Error('LibreOffice/soffice is not available');
  }

  const profileDir = join(outputDir, 'libreoffice-profile');
  await fs.mkdir(profileDir, { mode: 0o700 });
  await runCommand(
    libreOfficeExecutable,
    buildLibreOfficeConversionArgs(inputPath, outputDir, profileDir),
    LIBREOFFICE_CONVERSION_TIMEOUT_MS
  );

  const outputPath = getLibreOfficeOutputPath(inputPath, outputDir);
  try {
    const output = await fs.stat(outputPath);
    if (!output.isFile() || output.size === 0) throw new Error('empty output');
  } catch {
    throw new Error('LibreOffice did not produce a PDF output');
  }

  return outputPath;
}

async function convertDocumentToPdf(inputPath: string, outputDir: string) {
  return convertDocumentWithLibreOffice(inputPath, outputDir);
}

let boss: PgBoss | null = null;

type PgBossError = Error & {
  code?: string;
};

const RECURRING_QUEUE_NAMES = ['cleanup', 'archive', 'chat:media-cleanup', 'backup', 'backup:check', 'emergency:reconcile', 'webpage:refresh-due', 'live:fallback-reconcile'] as const;
const WORK_QUEUE_NAMES = [
  'live:fallback-prepare',
  'live:fallback-reconcile',
  'playback:refresh-dispatch',
  'telemetry:heartbeat',
  'telemetry:proof-of-play',
  'telemetry:screenshot',
  'ffmpeg:transcode',
  'ffmpeg:thumbnail',
  'document:convert',
  'webpage:verify-capture',
  'webpage:refresh-due',
  'archive',
  'cleanup',
  'chat:media-cleanup',
  'backup',
  'backup:check',
  'emergency:reconcile',
] as const;

function getPgBossSchemaSql() {
  return `"${appConfig.PG_BOSS_SCHEMA.replace(/"/g, '""')}"`;
}

function getPgBossPartitionName(queueName: string) {
  return `j${createHash('sha224').update(queueName).digest('hex')}`;
}

async function queuePartitionExists(queueName: string) {
  const db = getDatabase();
  const partitionName = getPgBossPartitionName(queueName);
  const result = await db.execute(sql.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_tables
      WHERE schemaname = '${appConfig.PG_BOSS_SCHEMA.replace(/'/g, "''")}'
        AND tablename = '${partitionName}'
    ) AS exists
  `));

  return Boolean((result as { rows?: Array<{ exists?: boolean }> }).rows?.[0]?.exists);
}

async function repairQueueMetadata(queueName: string) {
  const db = getDatabase();
  const schemaSql = getPgBossSchemaSql();
  const partitionName = getPgBossPartitionName(queueName);

  await db.execute(sql.raw(`
    INSERT INTO ${schemaSql}.queue (
      name,
      policy,
      partition_name
    )
    VALUES (
      '${queueName.replace(/'/g, "''")}',
      'standard',
      '${partitionName}'
    )
    ON CONFLICT (name) DO NOTHING
  `));
}

async function ensureQueueExists(jobs: PgBoss, queueName: string) {
  try {
    await jobs.createQueue(queueName);
    return;
  } catch (error) {
    const pgBossError = error as PgBossError;
    const partitionAlreadyExists = pgBossError.code === '42P07' && await queuePartitionExists(queueName);

    if (!partitionAlreadyExists) {
      logger.error({ err: error, queueName }, 'Failed to create pg-boss queue');
      throw error;
    }

    logger.warn({ queueName }, 'Detected orphaned pg-boss queue metadata. Repairing queue row.');
    await repairQueueMetadata(queueName);

    const queue = await jobs.getQueue(queueName);
    if (!queue) {
      throw new Error(`Failed to repair pg-boss queue metadata for ${queueName}`);
    }

    logger.info({ queueName }, 'Repaired orphaned pg-boss queue metadata');
  }
}

export async function initializeJobs(): Promise<PgBoss> {
  if (boss) {
    return boss;
  }

  boss = new PgBoss({
    connectionString: appConfig.DATABASE_URL,
    schema: appConfig.PG_BOSS_SCHEMA,
    archiveCompletedAfterSeconds: 60 * 60 * 24 * 7, // 7 days
    deleteAfterDays: 30, // 30 days
  });

  boss.on('error', (error) => {
    logger.error(error, 'pg-boss error');
  });

  await boss.start();
  logger.info('pg-boss initialized');

  return boss;
}

export function getJobs(): PgBoss {
  if (!boss) {
    throw new Error('Jobs not initialized. Call initializeJobs() first.');
  }
  return boss;
}

export function isJobsInitialized() {
  return boss !== null;
}

export async function stopJobs(): Promise<void> {
  if (boss) {
    await boss.stop();
    boss = null;
    logger.info('pg-boss stopped');
  }
}

// Job types
export interface FFmpegTranscodeJob {
  mediaId: string;
  sourceObjectId: string;
  targetFormat: 'mp4' | 'webm' | 'hls';
  quality: 'low' | 'medium' | 'high';
}

export interface FFmpegThumbnailJob {
  mediaId: string;
  sourceObjectId: string;
  timestamp?: number; // seconds
}

export interface DocumentConvertJob {
  mediaId: string;
  sourceObjectId: string;
}

export interface WebpageVerifyCaptureJob {
  mediaId: string;
  sourceUrl: string;
  mode?: 'INITIAL' | 'REFRESH';
  refreshToken?: string;
}

export interface WebpageRefreshDueJob {
  trigger: 'scheduled-scan';
}

export interface ArchiveJob {
  type: 'logs' | 'media' | 'full';
  startDate: string;
  endDate: string;
}

export interface CleanupJob {
  type: 'expired_sessions' | 'old_logs' | 'orphaned_objects' | 'chat_orphaned_media';
  mediaAssetIds?: string[];
  conversationId?: string;
  messageId?: string;
}

export interface ChatMediaCleanupJob {
  conversationId: string;
  mediaAssetIds: string[];
  source?: 'message-delete' | 'conversation-delete' | 'fallback-reconcile';
  messageId?: string;
}

export interface BackupJob {
  runId: string;
}

export interface BackupCheckJob {
  trigger: 'scheduled-check';
}

export interface PlaybackRefreshDispatchJob extends PlaybackRefreshCommandBatch {}

export interface EmergencyReconcileJob {
  transitionId?: string;
}

export interface LiveFallbackPreparationJob { preparationId: string; retryFailed?: boolean }

export async function queueLiveFallbackPreparation(job: LiveFallbackPreparationJob) {
  const jobs = getJobs(), queue = 'live:fallback-prepare';
  try {
    await ensureQueueExists(jobs, queue);
    // Null means an identical dispatch is already queued in this slot. The
    // durable preparation claim remains the cross-worker concurrency guard.
    const id = await jobs.send(queue, job, { singletonKey: job.preparationId, singletonSeconds: 30,
      retryLimit: 3, retryDelay: 30, expireInSeconds: 60 * 60 });
    recordJobEnqueue(queue, 'success');
    return id;
  } catch (error) { recordJobEnqueue(queue, 'error'); throw error; }
}

export async function reconcileLiveFallbackPreparations() {
  const db = getDatabase();
  const staging = await scavengeLiveFallbackStaging();
  const rows = await db.select({ id: schema.liveFallbackPreparations.id }).from(schema.liveFallbackPreparations)
    .where(or(eq(schema.liveFallbackPreparations.state, 'PENDING'), and(
      eq(schema.liveFallbackPreparations.state, 'PROCESSING'),
      lte(schema.liveFallbackPreparations.lease_expires_at, new Date())
    ))).orderBy(schema.liveFallbackPreparations.updated_at).limit(20);
  for (const row of rows) await queueLiveFallbackPreparation({ preparationId: row.id });
  return { dispatched: rows.length, staging };
}

export async function queuePlaybackRefreshDispatch(job: PlaybackRefreshDispatchJob, options?: any) {
  return sendJob('playback:refresh-dispatch', job, {
    retryLimit: 3,
    retryDelay: 15,
    ...options,
  });
}

export async function queueEmergencyTransitionReconcile(job: EmergencyReconcileJob = {}, options?: any) {
  return sendJob('emergency:reconcile', job, {
    retryLimit: 5,
    retryDelay: 15,
    ...options,
  });
}

export async function queueHeartbeatTelemetry(job: HeartbeatTelemetryJob, options?: any) {
  return sendJob('telemetry:heartbeat', job, {
    retryLimit: 5,
    retryDelay: 15,
    ...options,
  });
}

export async function queueProofOfPlayTelemetry(job: ProofOfPlayTelemetryJob, options?: any) {
  return sendJob('telemetry:proof-of-play', job, {
    retryLimit: 5,
    retryDelay: 15,
    singletonKey: job.idempotencyKey,
    singletonSeconds: 60 * 60,
    ...options,
  });
}

export async function queueScreenshotTelemetry(job: ScreenshotTelemetryJob, options?: any) {
  return sendJob('telemetry:screenshot', job, {
    retryLimit: 5,
    retryDelay: 30,
    ...options,
  });
}

// Job queue functions
async function sendJob<TPayload extends object>(
  queueName: string,
  payload: TPayload,
  options?: Record<string, unknown>
) {
  const jobs = getJobs();
  try {
    await ensureQueueExists(jobs, queueName);
    const jobId = options
      ? await jobs.send(queueName, payload, options as any)
      : await jobs.send(queueName, payload);

    if (!jobId) {
      throw new Error(`pg-boss did not return a job id for ${queueName}`);
    }

    recordJobEnqueue(queueName, 'success');
    return jobId;
  } catch (error) {
    recordJobEnqueue(queueName, 'error');
    throw error;
  }
}

export async function queueFFmpegTranscode(job: FFmpegTranscodeJob, options?: any) {
  return sendJob('ffmpeg:transcode', job, {
    retryLimit: 3,
    retryDelay: 60,
    ...options,
  });
}

export async function queueFFmpegThumbnail(job: FFmpegThumbnailJob, options?: any) {
  return sendJob('ffmpeg:thumbnail', job, {
    retryLimit: 3,
    retryDelay: 60,
    ...options,
  });
}

export async function queueDocumentConvert(job: DocumentConvertJob, options?: any) {
  return sendJob('document:convert', job, {
    retryLimit: 2,
    retryDelay: 30,
    ...options,
  });
}

export async function queueWebpageVerifyCapture(job: WebpageVerifyCaptureJob, options?: any) {
  return sendJob('webpage:verify-capture', job, {
    retryLimit: 2,
    retryDelay: 30,
    ...options,
  });
}

export async function queueWebpageRefreshDue(job: WebpageRefreshDueJob, options?: any) {
  return sendJob('webpage:refresh-due', job, {
    retryLimit: 1,
    retryDelay: 60,
    ...options,
  });
}

export async function queueArchive(job: ArchiveJob, options?: any) {
  return sendJob('archive', job, {
    retryLimit: 2,
    retryDelay: 300,
    ...options,
  });
}

export async function queueCleanup(job: CleanupJob, options?: any) {
  return sendJob('cleanup', job, {
    retryLimit: 1,
    ...options,
  });
}

export async function queueBackup(job: BackupJob, options?: any) {
  return sendJob('backup', job, {
    retryLimit: 1,
    retryDelay: 60,
    ...options,
  });
}

export async function queueChatMediaCleanup(job: ChatMediaCleanupJob, options?: any) {
  return sendJob('chat:media-cleanup', job, {
    retryLimit: 3,
    retryDelay: 60,
    ...options,
  });
}

export async function cleanupChatMediaAssets(input: {
  mediaAssetIds: string[];
  conversationId?: string;
  source?: 'message-delete' | 'conversation-delete' | 'fallback-reconcile';
  messageId?: string;
}) {
  // Old queued cleanup jobs are safe to replay after the retention upgrade.
  logger.info({ conversationId: input.conversationId, mediaCount: input.mediaAssetIds.length }, 'Retaining chat media from legacy cleanup job');
}

export async function cleanupDeletedUserUploads(options: {
  now?: () => Date;
  limit?: number;
} = {}) {
  const db = getDatabase();
  const runAt = options.now?.() ?? new Date();
  const terminalCutoff = runAt.getTime() - 2 * 60 * 60 * 1000;
  const limit = options.limit ?? 100;
  const result = {
    upload_sessions_cleaned: 0,
    upload_sessions_pending: 0,
    legacy_media_cleaned: 0,
    legacy_media_pending: 0,
  };

  const deletedUserUploads = await db
    .select()
    .from(schema.mediaUploadSessions)
    .where(
      and(
        eq(schema.mediaUploadSessions.state, 'ABORTED'),
        inArray(schema.mediaUploadSessions.failure_reason, [
          'USER_DELETED_CLEANUP_PENDING',
          'USER_DELETED_UPLOAD_ABORTED',
        ])
      )
    )
    .limit(limit);

  for (const upload of deletedUserUploads) {
    try {
      if (upload.strategy === 'multipart' && upload.multipart_upload_id) {
        await abortMultipartUpload(
          upload.staging_bucket,
          upload.staging_object_key,
          upload.multipart_upload_id
        ).catch(() => undefined);
      }
      await deleteObject(upload.staging_bucket, upload.staging_object_key);
      await deleteObject(upload.canonical_bucket, upload.canonical_object_key);
      await db.transaction(async (tx) => {
        if (upload.aborted_at && upload.aborted_at.getTime() <= terminalCutoff) {
          await tx
            .update(schema.mediaUploadSessions)
            .set({ failure_reason: 'USER_DELETED_UPLOAD_ABORTED_FINAL', updated_at: runAt })
            .where(eq(schema.mediaUploadSessions.id, upload.id));
        }
        await tx
          .update(schema.media)
          .set({ status: 'FAILED', status_reason: 'USER_DELETED_UPLOAD_ABORTED', updated_at: runAt })
          .where(eq(schema.media.id, upload.media_id));
      });
      result.upload_sessions_cleaned += 1;
    } catch (error) {
      result.upload_sessions_pending += 1;
      logger.warn({ error, uploadSessionId: upload.id }, 'Failed to retry deleted-user upload cleanup');
    }
  }

  // Completed media is retained even if an older release tagged it for cleanup.
  // Aborted staging uploads above are never-accepted temporary objects.
  return result;
}

export async function cleanupOrphanedStorageObjects(options: {
  storageObjectIds?: string[];
  now?: () => Date;
  minimumAgeMs?: number;
  limit?: number;
} = {}) {
  const db = getDatabase();
  const minimumAgeMs = options.minimumAgeMs ?? 2 * 60 * 60 * 1000;
  const cutoff = new Date((options.now?.() ?? new Date()).getTime() - minimumAgeMs);
  const limit = options.limit ?? 500;
  const orphansResult = await db.execute(
    sql`
      SELECT id, bucket, object_key
      FROM storage_objects so
      WHERE so.created_at <= ${cutoff}
        -- Content-addressed approved fallbacks are retained even after their
        -- source library entry changes or disappears. Excluding the namespace
        -- also fences the query-to-object-delete race with a retrying preparer;
        -- JSON-only manifest references are insufficient for orphan discovery.
        AND so.object_key NOT LIKE 'live-fallbacks/v1/sha256/%'
        AND NOT EXISTS (SELECT 1 FROM live_fallback_preparation_assets lfpa WHERE lfpa.storage_object_id = so.id)
        AND NOT EXISTS (SELECT 1 FROM live_occurrence_assets loa WHERE loa.storage_object_id = so.id)
        AND NOT EXISTS (SELECT 1 FROM media m WHERE m.source_object_id = so.id OR m.ready_object_id = so.id OR m.thumbnail_object_id = so.id)
        AND NOT EXISTS (SELECT 1 FROM schedule_snapshots ss WHERE ss.storage_object_id = so.id)
        AND NOT EXISTS (SELECT 1 FROM heartbeats h WHERE h.storage_object_id = so.id)
        AND NOT EXISTS (SELECT 1 FROM proof_of_play pop WHERE pop.storage_object_id = so.id)
        AND NOT EXISTS (SELECT 1 FROM screenshots s WHERE s.storage_object_id = so.id)
        AND NOT EXISTS (SELECT 1 FROM request_attachments ra WHERE ra.storage_object_id = so.id)
        AND NOT EXISTS (SELECT 1 FROM audit_logs al WHERE al.storage_object_id = so.id)
        AND NOT EXISTS (SELECT 1 FROM system_logs sl WHERE sl.storage_object_id = so.id)
        AND NOT EXISTS (SELECT 1 FROM login_attempts la WHERE la.storage_object_id = so.id)
        AND NOT EXISTS (SELECT 1 FROM log_archives lga WHERE lga.storage_object_id = so.id)
      ORDER BY so.created_at ASC
      LIMIT ${limit}
    `
  );
  const requestedIds = options.storageObjectIds?.length
    ? new Set(options.storageObjectIds)
    : null;
  const orphans = ((orphansResult as { rows?: any[] }).rows ?? []).filter(
    (orphan) => !requestedIds || requestedIds.has(orphan.id)
  );
  const cleanedIds: string[] = [];
  let pending = 0;

  for (const orphan of orphans) {
    const { id, bucket, object_key: objectKey } = orphan as any;
    try {
      await deleteObject(bucket, objectKey);
      cleanedIds.push(id);
    } catch (error) {
      pending += 1;
      logger.warn(error, `Failed to delete object ${bucket}/${objectKey}`);
    }
  }

  if (cleanedIds.length) {
    await db.delete(schema.storageObjects).where(inArray(schema.storageObjects.id, cleanedIds));
    logger.info(`Removed ${cleanedIds.length} orphaned storage objects`);
  } else if (!orphans.length) {
    logger.info('No orphaned storage objects found');
  }

  return { cleaned: cleanedIds.length, pending };
}

// Job handlers registration
export async function registerJobHandlers() {
  const jobs = getJobs();

  for (const queueName of WORK_QUEUE_NAMES) {
    await ensureQueueExists(jobs, queueName);
  }

  const registerObservedWorker = async <TPayload extends object>(
    queueName: string,
    handler: (jobBatch: Array<{ data: TPayload }>) => Promise<void>
  ) => {
    await jobs.work<TPayload>(queueName, async (jobBatch) => {
      const batch = Array.isArray(jobBatch) ? jobBatch : [jobBatch];
      await observeJobProcessing(queueName, async () => {
        await handler(batch);
      });
    });
  };

  // One claim at a time per process. Other workers coordinate through the
  // durable UUID lease and cannot finalize a replaced claim.
  await jobs.work<LiveFallbackPreparationJob>('live:fallback-prepare', { batchSize: 1 }, async batch => {
    await observeJobProcessing('live:fallback-prepare', async () => {
      for (const job of batch) await processLiveFallbackPreparation(job.data.preparationId, { retryFailed: job.data.retryFailed }, { prepareHls: prepareLiveHlsFallback });
    });
  });
  await registerObservedWorker('live:fallback-reconcile', async () => { await reconcileLiveFallbackPreparations(); });

  await registerObservedWorker<HeartbeatTelemetryJob>('telemetry:heartbeat', async (batch) => {
    for (const job of batch) {
      await processHeartbeatTelemetry(job.data);
    }
  });

  await registerObservedWorker<PlaybackRefreshDispatchJob>('playback:refresh-dispatch', async (batch) => {
    for (const job of batch) {
      await createPlaybackRefreshCommands(job.data);
    }
  });

  await registerObservedWorker<EmergencyReconcileJob>('emergency:reconcile', async (batch) => {
    for (const job of batch) {
      await reconcileEmergencyTransitions({ transitionId: job.data.transitionId, maxRows: 25 });
    }
  });

  await registerObservedWorker<ProofOfPlayTelemetryJob>('telemetry:proof-of-play', async (batch) => {
    for (const job of batch) {
      await processProofOfPlayTelemetry(job.data);
    }
  });

  await registerObservedWorker<ScreenshotTelemetryJob>('telemetry:screenshot', async (batch) => {
    for (const job of batch) {
      await processScreenshotTelemetry(job.data);
    }
  });

  // FFmpeg transcode handler
  await registerObservedWorker<FFmpegTranscodeJob>('ffmpeg:transcode', async (batch) => {
    const db = getDatabase();

    for (const job of batch) {
      const { mediaId, sourceObjectId, targetFormat, quality } = job.data;
      let tempDir: string | null = null;

      logger.info(`Processing transcode job: ${mediaId}`);

      try {
        const [media] = await db.select().from(schema.media).where(eq(schema.media.id, mediaId));
        if (!media || media.deleted_at) {
          logger.warn(`Media not found for transcode job: ${mediaId}`);
          continue;
        }
        if (media.status !== 'PROCESSING') {
          logger.warn({ mediaId, status: media.status }, 'Skipping stale transcode job');
          continue;
        }

        const [sourceObject] =
          sourceObjectId && !media.source_bucket
            ? await db
                .select()
                .from(schema.storageObjects)
                .where(eq(schema.storageObjects.id, sourceObjectId))
            : [];

        const sourceBucket = media.source_bucket ?? sourceObject?.bucket;
        const sourceKey = media.source_object_key ?? sourceObject?.object_key;

        if (!sourceBucket || !sourceKey) {
          logger.warn(`Missing source object info for media ${mediaId}`);
          await failMediaIfProcessing({
            mediaId,
            statusReason: 'VIDEO_SOURCE_MISSING',
            executor: db,
          });
          continue;
        }

        const sourceBuffer = await getObject(sourceBucket, sourceKey);
        tempDir = await fs.mkdtemp(join(tmpdir(), 'ffmpeg-'));
        const workDir = tempDir;
        const inputPath = join(workDir, 'input');
        await fs.writeFile(inputPath, sourceBuffer);

        const outputExt = targetFormat === 'hls' ? 'm3u8' : targetFormat;
        const outputPath = join(workDir, `output.${outputExt}`);
        const segmentTemplate = join(workDir, 'segment_%03d.ts');

        await runTranscode(inputPath, outputPath, { mediaId, sourceObjectId, targetFormat, quality }, segmentTemplate);

        if (targetFormat === 'hls') {
          const playlistBuffer = await fs.readFile(outputPath);
          const playlistKey = `${mediaId}/hls/playlist.m3u8`;
          const playlistUpload = await putObject(
            READY_BUCKET,
            playlistKey,
            playlistBuffer,
            FORMAT_CONTENT_TYPE.hls
          );

          const readyObject = await upsertStorageObject({
            bucket: READY_BUCKET,
            objectKey: playlistKey,
            contentType: FORMAT_CONTENT_TYPE.hls,
            size: playlistBuffer.length,
            sha256: playlistUpload.sha256,
          });

          const files = await fs.readdir(workDir);
          const segments = files.filter((file) => file.startsWith('segment_') && file.endsWith('.ts'));

          const segmentObjects = await Promise.all(
            segments.map(async (file) => {
              const buffer = await fs.readFile(join(workDir, file));
              const key = `${mediaId}/hls/${file}`;
              const upload = await putObject(READY_BUCKET, key, buffer, HLS_SEGMENT_CONTENT_TYPE);
              return {
                bucket: READY_BUCKET,
                objectKey: key,
                contentType: HLS_SEGMENT_CONTENT_TYPE,
                size: buffer.length,
                sha256: upload.sha256,
              };
            })
          );

          const producedObjects = [
            {
              bucket: READY_BUCKET,
              objectKey: playlistKey,
              contentType: FORMAT_CONTENT_TYPE.hls,
              size: playlistBuffer.length,
              sha256: playlistUpload.sha256,
            },
            ...segmentObjects,
          ];
          const result = await commitReadyMediaIfProcessing({
            mediaId,
            readyObjectId: readyObject.id,
            executor: db,
            compensateStaleResult: async () => {
              for (const produced of producedObjects) {
                try {
                  await deleteObject(produced.bucket, produced.objectKey);
                } catch (cleanupError) {
                  await upsertStorageObject(produced).catch((trackingError) => {
                    logger.error(
                      { cleanupError, trackingError, mediaId, objectKey: produced.objectKey },
                      'Failed to track stale transcode object for retry'
                    );
                  });
                  logger.warn(
                    { cleanupError, mediaId, objectKey: produced.objectKey },
                    'Stale transcode object cleanup will be retried'
                  );
                }
              }
            },
          });
          if (result === 'STALE') {
            logger.warn({ mediaId }, 'Discarded HLS transcode after media authority changed');
          }
        } else {
          const outputBuffer = await fs.readFile(outputPath);
          const readyKey = `${mediaId}/ready.${outputExt}`;
          const upload = await putObject(
            READY_BUCKET,
            readyKey,
            outputBuffer,
            FORMAT_CONTENT_TYPE[targetFormat] ?? 'application/octet-stream'
          );

          const readyObject = await upsertStorageObject({
            bucket: READY_BUCKET,
            objectKey: readyKey,
            contentType: FORMAT_CONTENT_TYPE[targetFormat],
            size: outputBuffer.length,
            sha256: upload.sha256,
          });

          const result = await commitReadyMediaIfProcessing({
            mediaId,
            readyObjectId: readyObject.id,
            executor: db,
            compensateStaleResult: async () => {
              await deleteObject(READY_BUCKET, readyKey);
            },
          });
          if (result === 'STALE') {
            logger.warn({ mediaId }, 'Discarded video transcode after media authority changed');
          }
        }
      } catch (error) {
        logger.error(error, `Transcode failed for media ${mediaId}`);
        try {
          await failMediaIfProcessing({
            mediaId,
            statusReason: 'VIDEO_TRANSCODE_FAILED',
            executor: db,
          });
        } catch (updateError) {
          logger.error(updateError, `Failed to mark media ${mediaId} as failed`);
        }
      } finally {
        await cleanupTempDir(tempDir);
      }
    }
  });

  // FFmpeg thumbnail handler
  await registerObservedWorker<FFmpegThumbnailJob>('ffmpeg:thumbnail', async (batch) => {
    const db = getDatabase();

    for (const job of batch) {
      const { mediaId, sourceObjectId, timestamp } = job.data;
      let tempDir: string | null = null;

      logger.info(`Processing thumbnail job: ${mediaId}`);

      try {
        const [media] = await db.select().from(schema.media).where(eq(schema.media.id, mediaId));
        if (!media || media.deleted_at) {
          logger.warn(`Media not found for thumbnail job: ${mediaId}`);
          continue;
        }
        if (media.status !== 'PROCESSING' && media.status !== 'READY') {
          logger.warn({ mediaId, status: media.status }, 'Skipping stale thumbnail job');
          continue;
        }

        const [sourceObject] =
          sourceObjectId && !media.source_bucket
            ? await db
                .select()
                .from(schema.storageObjects)
                .where(eq(schema.storageObjects.id, sourceObjectId))
            : [];

        const sourceBucket = media.source_bucket ?? sourceObject?.bucket;
        const sourceKey = media.source_object_key ?? sourceObject?.object_key;

        if (!sourceBucket || !sourceKey) {
          logger.warn(`Missing source object info for media ${mediaId}`);
          continue;
        }

        const sourceBuffer = await getObject(sourceBucket, sourceKey);
        tempDir = await fs.mkdtemp(join(tmpdir(), 'thumb-'));
        const inputPath = join(tempDir, 'input');
        await fs.writeFile(inputPath, sourceBuffer);

        const outputPath = join(tempDir, 'thumbnail.jpg');
        const seekTime = Math.max(0, timestamp ?? 1);

        await new Promise<void>((resolve, reject) => {
          ffmpeg(inputPath)
            .seekInput(seekTime)
            .frames(1)
            .outputOptions(['-q:v', '2'])
            .output(outputPath)
            .on('end', () => resolve())
            .on('error', (error) => reject(error))
            .run();
        });

        const thumbnailBuffer = await fs.readFile(outputPath);
        const thumbnailKey = `${mediaId}/thumbnail.jpg`;
        const upload = await putObject(THUMBNAIL_BUCKET, thumbnailKey, thumbnailBuffer, THUMBNAIL_CONTENT_TYPE);

        const thumbnailObject = await upsertStorageObject({
          bucket: THUMBNAIL_BUCKET,
          objectKey: thumbnailKey,
          contentType: THUMBNAIL_CONTENT_TYPE,
          size: thumbnailBuffer.length,
          sha256: upload.sha256,
        });

        const [updated] = await db
          .update(schema.media)
          .set({ thumbnail_object_id: thumbnailObject.id, updated_at: new Date() })
          .where(
            and(
              eq(schema.media.id, mediaId),
              inArray(schema.media.status, ['PROCESSING', 'READY']),
              isNull(schema.media.deleted_at)
            )
          )
          .returning({ id: schema.media.id });
        if (!updated) {
          await deleteObject(THUMBNAIL_BUCKET, thumbnailKey).catch((cleanupError) => {
            logger.warn(
              { cleanupError, mediaId, objectKey: thumbnailKey },
              'Stale thumbnail cleanup will be retried'
            );
          });
        }
      } catch (error) {
        logger.error(error, `Thumbnail generation failed for media ${mediaId}`);
      } finally {
        await cleanupTempDir(tempDir);
      }
    }
  });

  await registerObservedWorker<DocumentConvertJob>('document:convert', async (batch) => {
    const db = getDatabase();

    for (const job of batch) {
      const { mediaId, sourceObjectId } = job.data;
      let tempDir: string | null = null;

      try {
        const [media] = await db.select().from(schema.media).where(eq(schema.media.id, mediaId));
        if (!media || media.deleted_at) {
          logger.warn({ mediaId }, 'Media not found for document conversion');
          continue;
        }
        if (media.status !== 'PROCESSING') {
          logger.warn({ mediaId, status: media.status }, 'Skipping stale document conversion job');
          continue;
        }

        const [sourceObject] =
          sourceObjectId && !media.source_bucket
            ? await db
                .select()
                .from(schema.storageObjects)
                .where(eq(schema.storageObjects.id, sourceObjectId))
            : [];

        const sourceBucket = media.source_bucket ?? sourceObject?.bucket;
        const sourceKey = media.source_object_key ?? sourceObject?.object_key;

        if (!sourceBucket || !sourceKey) {
          await failMediaIfProcessing({
            mediaId,
            statusReason: 'DOCUMENT_SOURCE_MISSING',
            executor: db,
          });
          continue;
        }

        const sourceBuffer = await getObject(sourceBucket, sourceKey);
        tempDir = await fs.mkdtemp(join(tmpdir(), 'doc-convert-'));
        const sourceFilename = buildSourceFilename({
          fallbackName: media.name,
          sourceObjectKey: sourceKey,
          sourceContentType: media.source_content_type,
        });
        const inputPath = join(tempDir, sourceFilename);
        await fs.writeFile(inputPath, sourceBuffer);

        const nativePdf = isPdfDocument({
          sourceContentType: media.source_content_type,
          filename: media.name,
          objectKey: sourceKey,
        });
        const shouldConvert = requiresDocumentConversion({
          type: media.type,
          sourceContentType: media.source_content_type,
          filename: media.name,
          objectKey: sourceKey,
        });
        if (!nativePdf && !shouldConvert) {
          throw new PdfInspectionError('DOCUMENT_PDF_INVALID', 'Unsupported document format');
        }

        const outputBuffer = nativePdf
          ? sourceBuffer
          : await fs.readFile(await convertDocumentToPdf(inputPath, tempDir));
        const pageCount = await inspectPdfPageCount(outputBuffer);

        let readyObjectId: string | null = media.ready_object_id ?? null;
        let producedReadyKey: string | null = null;
        if (!nativePdf) {
          const readyKey = `${mediaId}/ready.pdf`;
          const upload = await putObject(READY_BUCKET, readyKey, outputBuffer, DOCUMENT_READY_CONTENT_TYPE);
          const readyObject = await upsertStorageObject({
            bucket: READY_BUCKET,
            objectKey: readyKey,
            contentType: DOCUMENT_READY_CONTENT_TYPE,
            size: outputBuffer.length,
            sha256: upload.sha256,
          });
          readyObjectId = readyObject.id;
          producedReadyKey = readyKey;
        }

        const commitResult = await commitReadyMediaIfProcessing({
          mediaId,
          readyObjectId,
          values: {
            page_count: pageCount,
          },
          executor: db,
          compensateStaleResult: producedReadyKey
            ? async () => {
                await deleteObject(READY_BUCKET, producedReadyKey!);
              }
            : undefined,
        });
        if (commitResult === 'STALE') {
          logger.warn({ mediaId }, 'Discarded document conversion after media authority changed');
        }
      } catch (error) {
        logger.error({ error, mediaId }, 'Document conversion failed');
        const statusReason = error instanceof PdfInspectionError ? error.code : 'DOCUMENT_CONVERSION_FAILED';
        await failMediaIfProcessing({ mediaId, statusReason, executor: db });
      } finally {
        await cleanupTempDir(tempDir);
      }
    }
  });

  await registerObservedWorker<WebpageVerifyCaptureJob>('webpage:verify-capture', async (batch) => {
    for (const job of batch) {
      await processWebpageVerifyCaptureJob(job.data);
    }
  });

  await registerObservedWorker<WebpageRefreshDueJob>('webpage:refresh-due', async (batch) => {
    for (const job of batch) {
      await processWebpageRefreshDueJob(job.data);
    }
  });

  // Archive handler
  await registerObservedWorker<ArchiveJob>('archive', async (batch) => {
    const db = getDatabase();
    const sources = [
      { logType: 'audit', table: schema.auditLogs },
      { logType: 'system', table: schema.systemLogs },
      { logType: 'auth', table: schema.loginAttempts },
      { logType: 'heartbeats', table: schema.heartbeats },
      { logType: 'pop', table: schema.proofOfPlay },
    ];

    for (const job of batch) {
      logger.info(`Processing archive job: ${job.data.type}`);

      if (job.data.type !== 'logs') {
        logger.warn(`Archive type not implemented: ${job.data.type}`);
        continue;
      }

      const windowStart = job.data.startDate ? new Date(job.data.startDate) : new Date(0);
      const windowEnd = job.data.endDate ? new Date(job.data.endDate) : new Date();

      if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime())) {
        logger.warn(`Invalid archive window: ${job.data.startDate} - ${job.data.endDate}`);
        continue;
      }

      for (const source of sources) {
        try {
          const rows = await db
            .select()
            .from(source.table)
            .where(and(gte(source.table.created_at, windowStart), lte(source.table.created_at, windowEnd)));

          if (!rows.length) {
            continue;
          }

          const payload = rows.map((row) => JSON.stringify(row)).join('\n');
          const objectKey = `logs/${source.logType}/${windowStart.toISOString()}_${windowEnd.toISOString()}.ndjson`;
          const upload = await putObject(ARCHIVE_BUCKET, objectKey, payload, NDJSON_CONTENT_TYPE);

          const [storageObject] = await db
            .insert(schema.storageObjects)
            .values({
              bucket: ARCHIVE_BUCKET,
              object_key: objectKey,
              content_type: NDJSON_CONTENT_TYPE,
              size: Buffer.byteLength(payload),
              sha256: upload.sha256,
            })
            .returning();

          await db.insert(schema.logArchives).values({
            log_type: source.logType,
            window_start: windowStart,
            window_end: windowEnd,
            record_count: rows.length,
            storage_object_id: storageObject.id,
          });
        } catch (error) {
          logger.error(error, `Failed to archive ${source.logType} logs`);
        }
      }
    }
  });

  // Cleanup handler
  await registerObservedWorker<CleanupJob>('cleanup', async (batch) => {
    const db = getDatabase();

    for (const job of batch) {
      const type = job.data.type;
      logger.info(`Processing cleanup job: ${type}`);

      try {
        switch (type) {
          case 'expired_sessions': {
            const deleted = await db
              .delete(schema.sessions)
              .where(lte(schema.sessions.expires_at, new Date()))
              .returning({ id: schema.sessions.id });
            logger.info(`Deleted ${deleted.length} expired sessions`);

            const expiredUploads = await db
              .select()
              .from(schema.mediaUploadSessions)
              .where(
                and(
                  lte(schema.mediaUploadSessions.expires_at, new Date()),
                  inArray(schema.mediaUploadSessions.state, ['INITIALIZING', 'ACTIVE', 'FINALIZING'])
                )
              )
              .limit(100);

            for (const upload of expiredUploads) {
              try {
                if (upload.strategy === 'multipart' && upload.multipart_upload_id) {
                  await abortMultipartUpload(upload.staging_bucket, upload.staging_object_key, upload.multipart_upload_id);
                }
                await deleteObject(upload.staging_bucket, upload.staging_object_key).catch(() => undefined);
                await db.transaction(async (tx) => {
                  await tx
                    .update(schema.mediaUploadSessions)
                    .set({ state: 'EXPIRED', failure_reason: 'UPLOAD_SESSION_EXPIRED', updated_at: new Date() })
                    .where(eq(schema.mediaUploadSessions.id, upload.id));
                  await tx
                    .update(schema.media)
                    .set({ status: 'FAILED', status_reason: 'UPLOAD_SESSION_EXPIRED', updated_at: new Date() })
                    .where(and(eq(schema.media.id, upload.media_id), isNull(schema.media.deleted_at)));
                });
              } catch (error) {
                logger.warn({ error, uploadSessionId: upload.id }, 'Failed to clean up expired media upload session');
              }
            }
            logger.info(`Cleaned up ${expiredUploads.length} expired media upload sessions`);

            await cleanupDeletedUserUploads();
            await cleanupOrphanedStorageObjects();
            break;
          }
          case 'old_logs': {
            const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const sources = [
              { logType: 'audit', table: schema.auditLogs },
              { logType: 'system', table: schema.systemLogs },
              { logType: 'auth', table: schema.loginAttempts },
              { logType: 'heartbeats', table: schema.heartbeats },
              { logType: 'pop', table: schema.proofOfPlay },
            ];

            for (const source of sources) {
              const rows = await db
                .select()
                .from(source.table)
                .where(lte(source.table.created_at, cutoff));

              if (!rows.length) continue;

              const timestamps = rows
                .map((row: any) => new Date(row.created_at).getTime())
                .filter((value) => Number.isFinite(value));
              if (!timestamps.length) continue;

              const payload = rows.map((row) => JSON.stringify(row)).join('\n');
              const objectKey = `logs/${source.logType}/cleanup_${cutoff.toISOString()}_${Date.now()}.ndjson`;
              const upload = await putObject(ARCHIVE_BUCKET, objectKey, payload, NDJSON_CONTENT_TYPE);

              const windowStart = new Date(Math.min(...timestamps));
              const windowEnd = new Date(Math.max(...timestamps));

              const [storageObject] = await db
                .insert(schema.storageObjects)
                .values({
                  bucket: ARCHIVE_BUCKET,
                  object_key: objectKey,
                  content_type: NDJSON_CONTENT_TYPE,
                  size: Buffer.byteLength(payload),
                  sha256: upload.sha256,
                })
                .returning();

              await db.insert(schema.logArchives).values({
                log_type: source.logType,
                window_start: windowStart,
                window_end: windowEnd,
                record_count: rows.length,
                storage_object_id: storageObject.id,
              });

              await db.delete(source.table).where(lte(source.table.created_at, cutoff));
            }
            break;
          }
          case 'orphaned_objects': {
            await cleanupOrphanedStorageObjects();
            break;
          }
          case 'chat_orphaned_media': {
            const mediaAssetIds = Array.from(new Set(job.data.mediaAssetIds || []));
            if (!mediaAssetIds.length) {
              logger.info('No chat media ids provided for fallback cleanup');
              break;
            }

            await cleanupChatMediaAssets({
              mediaAssetIds,
              conversationId: job.data.conversationId,
              messageId: job.data.messageId,
              source: 'fallback-reconcile',
            });
            break;
          }
          default:
            logger.warn(`Unknown cleanup type: ${type}`);
        }
      } catch (error) {
        logger.error(error, `Cleanup failed for type ${type}`);
      }
    }
  });

  await registerObservedWorker<ChatMediaCleanupJob>('chat:media-cleanup', async (batch) => {
    for (const job of batch) {
      await cleanupChatMediaAssets({
        mediaAssetIds: job.data.mediaAssetIds,
        conversationId: job.data.conversationId,
        source: job.data.source,
        messageId: job.data.messageId,
      });
    }
  });

  if (appConfig.BACKUP_MODE !== 'EXTERNAL_SIDECAR') {
    await registerObservedWorker<BackupJob>('backup', async (batch) => {
      for (const job of batch) {
        logger.info({ runId: job.data.runId }, 'Processing backup job');
        await runFullBackup(job.data.runId);
      }
    });

    await registerObservedWorker<BackupCheckJob>('backup:check', async () => {
      const backupsSettings = getCachedSettings('org.backups');
      if (!backupsSettings.automatic_enabled) {
        return;
      }

      const latestRun = await getLatestBackupRun();
      const now = Date.now();
      const latestFinishedAt =
        latestRun?.completed_at ?? latestRun?.started_at ?? latestRun?.created_at ?? null;
      const latestTimestamp = latestFinishedAt ? new Date(latestFinishedAt).getTime() : 0;
      const intervalMs = backupsSettings.interval_hours * 60 * 60 * 1000;

      if (latestRun && ['PENDING', 'RUNNING'].includes(latestRun.status)) {
        return;
      }

      if (latestTimestamp && now - latestTimestamp < intervalMs) {
        return;
      }

      const run = await createBackupRun('AUTOMATIC');
      await queueBackup({ runId: run.id });
    });
  }

  logger.info('Job handlers registered');
}

// Scheduled jobs
// export async function scheduleRecurringJobs() {
//   const jobs = getJobs();

//   try {
//     // pg-boss requires queues to exist in the database before scheduling
//     // We need to create the queues first by sending a job to each queue
//     // This will create the queue entry in pgboss.queue table

//     // Create cleanup queue by sending a job (will be processed immediately or soon)
//     const cleanupJobId = await jobs.send('cleanup', { type: 'expired_sessions' });
//     logger.info(`Created cleanup queue with initial job: ${cleanupJobId}`);

//     // Create archive queue by sending a job
//     const archiveJobId = await jobs.send('archive', { type: 'logs', startDate: '', endDate: '' });
//     logger.info(`Created archive queue with initial job: ${archiveJobId}`);

//     // Wait a bit for pg-boss to process and create queue entries
//     await new Promise(resolve => setTimeout(resolve, 1000));

//     // Now schedule recurring jobs (queues should exist now)
//     // Daily cleanup at 2 AM
//     await jobs.unschedule('cleanup').catch(() => {}); // Remove any existing schedule
//     await jobs.schedule('cleanup', '0 2 * * *', { type: 'expired_sessions' });

//     // Weekly archive at 3 AM on Sunday
//     await jobs.unschedule('archive').catch(() => {}); // Remove any existing schedule
//     await jobs.schedule('archive', '0 3 * * 0', { type: 'logs', startDate: '', endDate: '' });

//     logger.info('Recurring jobs scheduled successfully');
//   } catch (error) {
//     logger.error(error, 'Failed to schedule recurring jobs');
//     // Don't throw - allow server to start even if scheduling fails
//     logger.warn('Server will continue without scheduled jobs');
//   }
// }
export async function scheduleRecurringJobs() {
  const jobs = getJobs();

  try {
    for (const queueName of RECURRING_QUEUE_NAMES) {
      await ensureQueueExists(jobs, queueName);
    }

    // Clean any prior schedules
    await jobs.unschedule('cleanup').catch(() => { });
    await jobs.unschedule('archive').catch(() => { });
    await jobs.unschedule('backup:check').catch(() => { });
    await jobs.unschedule('emergency:reconcile').catch(() => { });
    await jobs.unschedule('webpage:refresh-due').catch(() => { });
    await jobs.unschedule('live:fallback-reconcile').catch(() => { });

    // Now schedule safely (queues exist)
    await jobs.schedule('cleanup', '15 * * * *', { type: 'expired_sessions' });      // hourly upload/session expiry cleanup
    await jobs.schedule('archive', '0 3 * * 0', { type: 'logs', startDate: '', endDate: '' }); // Sun 3 AM
    if (appConfig.BACKUP_MODE !== 'EXTERNAL_SIDECAR') {
      await jobs.schedule('backup:check', '0 * * * *', { trigger: 'scheduled-check' }); // hourly
    }
    await jobs.schedule('emergency:reconcile', '* * * * *', {}); // every minute
    await jobs.schedule('webpage:refresh-due', '20 * * * *', { trigger: 'scheduled-scan' }); // hourly
    await jobs.schedule('live:fallback-reconcile', '* * * * *', {}); // durable dispatch/recovery every minute

    logger.info('Recurring jobs scheduled successfully');
  } catch (error) {
    logger.error(error, 'Failed to schedule recurring jobs');
    if (appConfig.NODE_ENV === 'production') {
      throw error;
    }
    logger.warn('Server will continue without scheduled jobs');
  }
}
