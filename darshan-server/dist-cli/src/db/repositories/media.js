import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { getDatabase, schema } from '../index.js';
import { DEFAULT_MEDIA_SETTING_KEY, DEFAULT_MEDIA_TARGETS_SETTING_KEY, DEFAULT_MEDIA_VARIANTS_SETTING_KEY, } from '../../utils/default-media.js';
export class MediaRepository {
    async create(data) {
        const db = getDatabase();
        const result = await db.insert(schema.media).values(data).returning();
        return result[0];
    }
    async findById(id) {
        const db = getDatabase();
        const result = await db.select().from(schema.media).where(eq(schema.media.id, id));
        return result[0] || null;
    }
    async list(options) {
        const db = getDatabase();
        const page = options.page || 1;
        const limit = options.limit || 20;
        const offset = (page - 1) * limit;
        const conditions = [];
        if (options.type) {
            conditions.push(eq(schema.media.type, options.type));
        }
        if (options.status) {
            conditions.push(eq(schema.media.status, options.status));
        }
        if (options.created_by_ids) {
            if (options.created_by_ids.length === 0) {
                return { items: [], total: 0, page, limit };
            }
            conditions.push(inArray(schema.media.created_by, options.created_by_ids));
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        let query = db.select().from(schema.media);
        if (whereClause) {
            query = query.where(whereClause);
        }
        const [totalRow] = await db
            .select({ count: sql `count(*)` })
            .from(schema.media)
            .where(whereClause);
        const items = await query
            .orderBy(desc(schema.media.created_at))
            .limit(limit)
            .offset(offset);
        return {
            items,
            total: Number(totalRow?.count || 0),
            page,
            limit,
        };
    }
    async update(id, data) {
        const db = getDatabase();
        const result = await db
            .update(schema.media)
            .set({ ...data, updated_at: new Date() })
            .where(eq(schema.media.id, id))
            .returning();
        return result[0] || null;
    }
    async delete(id) {
        const db = getDatabase();
        await db.delete(schema.media).where(eq(schema.media.id, id));
    }
    async getUsageSummary(id) {
        const db = getDatabase();
        const [chatAttachment, chatBookmark, presentationItem, presentationSlotItem, screen, emergency, emergencyType, proofOfPlay, defaultMediaSetting, defaultMediaVariantsSetting, defaultMediaTargetsSetting,] = await Promise.all([
            db.select({ id: schema.chatAttachments.id }).from(schema.chatAttachments).where(eq(schema.chatAttachments.media_asset_id, id)).limit(1),
            db.select({ id: schema.chatBookmarks.id }).from(schema.chatBookmarks).where(eq(schema.chatBookmarks.media_asset_id, id)).limit(1),
            db.select({ id: schema.presentationItems.id }).from(schema.presentationItems).where(eq(schema.presentationItems.media_id, id)).limit(1),
            db.select({ id: schema.presentationSlotItems.id }).from(schema.presentationSlotItems).where(eq(schema.presentationSlotItems.media_id, id)).limit(1),
            db.select({ id: schema.screens.id }).from(schema.screens).where(eq(schema.screens.current_media_id, id)).limit(1),
            db.select({ id: schema.emergencies.id }).from(schema.emergencies).where(eq(schema.emergencies.media_id, id)).limit(1),
            db.select({ id: schema.emergencyTypes.id }).from(schema.emergencyTypes).where(eq(schema.emergencyTypes.media_id, id)).limit(1),
            db.select({ id: schema.proofOfPlay.id }).from(schema.proofOfPlay).where(eq(schema.proofOfPlay.media_id, id)).limit(1),
            db.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, DEFAULT_MEDIA_SETTING_KEY)).limit(1),
            db.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, DEFAULT_MEDIA_VARIANTS_SETTING_KEY)).limit(1),
            db.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, DEFAULT_MEDIA_TARGETS_SETTING_KEY)).limit(1),
        ]);
        const references = [];
        if (chatAttachment.length > 0) {
            references.push('chat_attachments');
        }
        if (chatBookmark.length > 0) {
            references.push('chat_bookmarks');
        }
        if (presentationItem.length > 0 || presentationSlotItem.length > 0) {
            references.push('presentations');
        }
        if (screen.length > 0) {
            references.push('screens');
        }
        if (emergency.length > 0 || emergencyType.length > 0) {
            references.push('emergencies');
        }
        const defaultMediaId = defaultMediaSetting[0]?.value;
        if ((typeof defaultMediaId === 'string' && defaultMediaId === id) ||
            (defaultMediaId &&
                typeof defaultMediaId === 'object' &&
                'media_id' in defaultMediaId &&
                defaultMediaId.media_id === id)) {
            references.push('settings');
        }
        const variantMediaMap = defaultMediaVariantsSetting[0]?.value;
        if (variantMediaMap &&
            typeof variantMediaMap === 'object' &&
            !Array.isArray(variantMediaMap) &&
            Object.values(variantMediaMap).some((value) => value === id)) {
            if (!references.includes('settings')) {
                references.push('settings');
            }
        }
        const targetAssignments = defaultMediaTargetsSetting[0]?.value;
        if (Array.isArray(targetAssignments) &&
            targetAssignments.some((value) => {
                if (!value || typeof value !== 'object')
                    return false;
                const candidate = value;
                return candidate.media_id === id;
            })) {
            if (!references.includes('settings')) {
                references.push('settings');
            }
        }
        if (proofOfPlay.length > 0) {
            references.push('proof_of_play');
        }
        return {
            inUse: references.length > 0,
            references,
            primaryReason: references[0] ?? null,
        };
    }
}
export function createMediaRepository() {
    return new MediaRepository();
}
