import { eq, inArray } from 'drizzle-orm';
import { getDatabase, schema } from '../db/index.js';
import { resolveMediaAccess } from './media-access.js';
import { serializeMediaRecord } from './media.js';
export function buildResolvedMediaRepresentation(media, options = {}) {
    const isWebpage = media.type === 'WEBPAGE';
    return {
        id: media.id,
        name: media.name || media.filename || 'Untitled media',
        type: media.type ?? 'UNKNOWN',
        playback_url: isWebpage ? media.source_url ?? null : media.media_url ?? null,
        preview_url: isWebpage ? media.fallback_media_url ?? null : media.media_url ?? null,
        content_type: media.content_type ?? null,
        source_content_type: media.source_content_type ?? null,
        status: media.status ?? null,
        ...(options.includeSourceUrl ? { source_url: media.source_url ?? null } : {}),
    };
}
export function buildResolvedMediaAssets(mediaMap, options = {}) {
    const assets = {};
    for (const [id, media] of mediaMap.entries()) {
        assets[id] = buildResolvedMediaRepresentation(media, options);
    }
    return assets;
}
export async function buildResolvedMediaMap(mediaIds, db = getDatabase(), audience = 'cms') {
    const uniqueIds = Array.from(new Set(mediaIds.filter(Boolean)));
    if (uniqueIds.length === 0) {
        return new Map();
    }
    const mediaRows = await db.select().from(schema.media).where(inArray(schema.media.id, uniqueIds));
    const readyObjectIds = Array.from(new Set(mediaRows.map((media) => media.ready_object_id).filter((id) => Boolean(id))));
    const readyObjects = readyObjectIds.length
        ? await db.select().from(schema.storageObjects).where(inArray(schema.storageObjects.id, readyObjectIds))
        : [];
    const readyObjectMap = new Map(readyObjects.map((storageObject) => [storageObject.id, storageObject]));
    const resolvedEntries = await Promise.all(mediaRows.map(async (media) => {
        const access = await resolveMediaAccess(media, db, { audience, readyObjectMap });
        return [
            media.id,
            serializeMediaRecord(media, access.media_url, {
                content_type: access.content_type,
                source_content_type: access.source_content_type,
                size: access.size,
            }),
        ];
    }));
    return new Map(resolvedEntries);
}
function hydratePresentationEntry(entry, mediaMap) {
    if (!entry || typeof entry !== 'object') {
        return entry;
    }
    const mediaId = typeof entry.media_id === 'string' ? entry.media_id : undefined;
    const resolvedMedia = mediaId ? mediaMap.get(mediaId) : undefined;
    if (!resolvedMedia) {
        return entry;
    }
    return {
        ...entry,
        media: {
            ...(entry.media && typeof entry.media === 'object' ? entry.media : {}),
            ...resolvedMedia,
            url: resolvedMedia.type === 'WEBPAGE'
                ? resolvedMedia.source_url ?? null
                : resolvedMedia.media_url ?? null,
            fallback_url: resolvedMedia.fallback_media_url ?? null,
            media_type: resolvedMedia.type,
        },
    };
}
export function attachResolvedMediaToScheduleSnapshot(snapshot, mediaMap) {
    if (!snapshot || typeof snapshot !== 'object') {
        return snapshot;
    }
    const schedule = snapshot.schedule;
    if (!schedule || typeof schedule !== 'object' || !Array.isArray(schedule.items)) {
        return snapshot;
    }
    return {
        ...snapshot,
        schedule: {
            ...schedule,
            items: schedule.items.map((item) => {
                if (!item || typeof item !== 'object' || !item.presentation || typeof item.presentation !== 'object') {
                    return item;
                }
                return {
                    ...item,
                    presentation: {
                        ...item.presentation,
                        items: Array.isArray(item.presentation.items)
                            ? item.presentation.items.map((entry) => hydratePresentationEntry(entry, mediaMap))
                            : item.presentation.items,
                        slots: Array.isArray(item.presentation.slots)
                            ? item.presentation.slots.map((entry) => hydratePresentationEntry(entry, mediaMap))
                            : item.presentation.slots,
                    },
                };
            }),
        },
    };
}
export async function buildResolvedMediaUrls(mediaIds, db = getDatabase(), audience = 'cms') {
    const mediaMap = await buildResolvedMediaMap(mediaIds, db, audience);
    const result = {};
    for (const [mediaId, media] of mediaMap.entries()) {
        const url = media.type === 'WEBPAGE' ? media.source_url : media.media_url;
        if (typeof url === 'string' && url.length > 0) {
            result[mediaId] = url;
        }
    }
    return result;
}
export async function buildResolvedMediaRecord(mediaId, db = getDatabase(), audience = 'cms') {
    if (!mediaId)
        return null;
    const [media] = await db.select().from(schema.media).where(eq(schema.media.id, mediaId)).limit(1);
    if (!media)
        return null;
    const access = await resolveMediaAccess(media, db, { audience });
    const serialized = serializeMediaRecord(media, access.media_url, {
        content_type: access.content_type,
        source_content_type: access.source_content_type,
        size: access.size,
    });
    const representation = buildResolvedMediaRepresentation(serialized, { includeSourceUrl: audience === 'cms' });
    return {
        ...serialized,
        ...representation,
        url: representation.playback_url,
        fallback_url: representation.preview_url,
        media_type: serialized.type,
    };
}
