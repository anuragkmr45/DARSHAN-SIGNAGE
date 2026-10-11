import { eq } from 'drizzle-orm';
import { getDatabase, schema } from '../db/index.js';
import { getPresignedUrl, headObject } from '../s3/index.js';
import { buildContentDisposition } from './object-key.js';
import { createLogger } from './logger.js';
const logger = createLogger('media-access');
const isObjectMissingError = (error) => {
    if (!error || typeof error !== 'object')
        return false;
    const candidate = error;
    return (candidate.name === 'NotFound' ||
        candidate.Code === 'NotFound' ||
        candidate.code === 'NotFound' ||
        candidate.code === 'NoSuchKey' ||
        candidate.$metadata?.httpStatusCode === 404);
};
const normalizeHeadSize = (value) => {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'bigint')
        return Number(value);
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
};
async function getReadyStorageObject(media, options, db = getDatabase()) {
    if (!media.ready_object_id) {
        return null;
    }
    const cached = options.readyObjectMap?.get(media.ready_object_id);
    if (cached) {
        return cached;
    }
    const [storageObject] = await db
        .select()
        .from(schema.storageObjects)
        .where(eq(schema.storageObjects.id, media.ready_object_id));
    return storageObject ?? null;
}
export async function resolveMediaAccess(media, db = getDatabase(), options = {}) {
    const filename = media.original_filename ?? media.name ?? 'file';
    const contentDisposition = buildContentDisposition(filename, 'inline');
    let bucket = null;
    let objectKey = null;
    let resolvedContentType = null;
    let resolvedSize = null;
    if (media.ready_object_id) {
        const readyObject = await getReadyStorageObject(media, options, db);
        if (!readyObject) {
            return {
                media_url: null,
                is_object_missing: true,
                content_type: null,
                source_content_type: media.source_content_type ?? null,
                size: null,
            };
        }
        bucket = readyObject.bucket;
        objectKey = readyObject.object_key;
        resolvedContentType = readyObject.content_type ?? null;
        resolvedSize = readyObject.size ?? null;
    }
    else if (media.source_bucket && media.source_object_key) {
        bucket = media.source_bucket;
        objectKey = media.source_object_key;
        resolvedContentType = media.source_content_type ?? null;
        resolvedSize = media.source_size ?? null;
    }
    if (!bucket || !objectKey) {
        return {
            media_url: null,
            is_object_missing: media.status === 'READY',
            content_type: media.ready_object_id ? resolvedContentType : media.source_content_type ?? null,
            source_content_type: media.source_content_type ?? null,
            size: resolvedSize,
        };
    }
    try {
        const head = await headObject(bucket, objectKey);
        resolvedContentType =
            resolvedContentType ??
                (typeof head?.ContentType === 'string' ? head.ContentType : null) ??
                media.source_content_type ??
                null;
        resolvedSize = resolvedSize ?? normalizeHeadSize(head?.ContentLength) ?? null;
    }
    catch (error) {
        if (isObjectMissingError(error)) {
            return {
                media_url: null,
                is_object_missing: true,
                content_type: resolvedContentType,
                source_content_type: media.source_content_type ?? null,
                size: resolvedSize,
            };
        }
        logger.warn(error, 'Failed to verify media object before generating media URL');
        return {
            media_url: null,
            is_object_missing: false,
            content_type: resolvedContentType,
            source_content_type: media.source_content_type ?? null,
            size: resolvedSize,
        };
    }
    try {
        const mediaUrl = await getPresignedUrl(bucket, objectKey, {
            expiresIn: 3600,
            responseContentDisposition: contentDisposition,
            responseContentType: resolvedContentType ?? undefined,
            audience: options.audience ?? 'cms',
        });
        return {
            media_url: mediaUrl,
            is_object_missing: false,
            content_type: resolvedContentType,
            source_content_type: media.source_content_type ?? null,
            size: resolvedSize,
        };
    }
    catch (error) {
        logger.warn(error, 'Failed to generate media URL');
        return {
            media_url: null,
            is_object_missing: false,
            content_type: resolvedContentType,
            source_content_type: media.source_content_type ?? null,
            size: resolvedSize,
        };
    }
}
