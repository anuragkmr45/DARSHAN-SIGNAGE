import { eq, and, desc, inArray, isNull, sql } from 'drizzle-orm';
import { getDatabase, schema, type DbExecutor } from '@/db';
import type { ActorContext } from '@/rbac/policy';
import { contentReadCondition, type ContentAbility, type ContentOwnerScope } from '@/rbac/content-ownership';
import {
  DEFAULT_MEDIA_SETTING_KEY,
  DEFAULT_MEDIA_TARGETS_SETTING_KEY,
  DEFAULT_MEDIA_VARIANTS_SETTING_KEY,
} from '@/utils/default-media';

export type MediaUsageReference =
  | 'chat_attachments'
  | 'chat_bookmarks'
  | 'presentations'
  | 'screens'
  | 'emergencies'
  | 'settings'
  | 'proof_of_play';

export type MediaUsageSummary = {
  inUse: boolean;
  references: MediaUsageReference[];
  primaryReason: MediaUsageReference | null;
};

export class MediaRepository {
  async create(data: {
    id?: string;
    name: string;
    type: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'WEBPAGE';
    created_by: string;
    owner_scope?: ContentOwnerScope;
    owner_department_id?: string | null;
    source_object_id?: string;
    source_bucket?: string;
    source_object_key?: string;
    source_content_type?: string;
    source_size?: number;
    source_url?: string;
    status?: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
    status_reason?: string | null;
  }) {
    const db = getDatabase();
    const result = await db.insert(schema.media).values(data).returning();
    return result[0];
  }

  async findById(id: string, executor?: DbExecutor) {
    const db = executor ?? getDatabase();
    const result = await db.select().from(schema.media).where(and(eq(schema.media.id, id), isNull(schema.media.deleted_at)));
    return result[0] || null;
  }

  async list(options: {
    page?: number;
    limit?: number;
    type?: string;
    status?: string;
    created_by_ids?: string[];
    actor?: ActorContext;
    ability?: ContentAbility;
  }) {
    const db = getDatabase();
    const page = options.page || 1;
    const limit = options.limit || 20;
    const offset = (page - 1) * limit;

    const conditions = [isNull(schema.media.deleted_at)];
    if (options.type) {
      conditions.push(eq(schema.media.type, options.type as any));
    }
    if (options.status) {
      conditions.push(eq(schema.media.status, options.status as any));
    }
    if (options.created_by_ids) {
      if (options.created_by_ids.length === 0) {
        return { items: [], total: 0, page, limit };
      }
      conditions.push(inArray(schema.media.created_by, options.created_by_ids as any));
    }
    if (options.actor) {
      const accessCondition = contentReadCondition(options.actor, schema.media, options.ability, 'Media');
      if (accessCondition) conditions.push(accessCondition);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    let query = db.select().from(schema.media);
    if (whereClause) {
      query = query.where(whereClause) as any;
    }

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)` })
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

  async update(id: string, data: Partial<typeof schema.media.$inferInsert>, executor?: DbExecutor) {
    const db = executor ?? getDatabase();
    const result = await db
      .update(schema.media)
      .set({ ...data, updated_at: new Date() })
      .where(eq(schema.media.id, id))
      .returning();
    return result[0] || null;
  }

  async delete(id: string, executor?: DbExecutor) {
    const db = executor ?? getDatabase();
    await db.delete(schema.media).where(eq(schema.media.id, id));
  }

  async getUsageSummary(id: string, executor?: DbExecutor): Promise<MediaUsageSummary> {
    const db = executor ?? getDatabase();

    // A transaction executor owns one PostgreSQL client. Keep these reads
    // sequential so the delete check remains compatible with pg clients that
    // reject overlapping queries on a transaction connection.
    const chatAttachment = await db.select({ id: schema.chatAttachments.id }).from(schema.chatAttachments).where(eq(schema.chatAttachments.media_asset_id, id)).limit(1);
    const chatBookmark = await db.select({ id: schema.chatBookmarks.id }).from(schema.chatBookmarks).where(eq(schema.chatBookmarks.media_asset_id, id)).limit(1);
    const presentationItem = await db.select({ id: schema.presentationItems.id }).from(schema.presentationItems).where(eq(schema.presentationItems.media_id, id)).limit(1);
    const presentationSlotItem = await db.select({ id: schema.presentationSlotItems.id }).from(schema.presentationSlotItems).where(eq(schema.presentationSlotItems.media_id, id)).limit(1);
    const screen = await db.select({ id: schema.screens.id }).from(schema.screens).where(eq(schema.screens.current_media_id, id)).limit(1);
    const emergency = await db.select({ id: schema.emergencies.id }).from(schema.emergencies).where(eq(schema.emergencies.media_id, id)).limit(1);
    const emergencyType = await db.select({ id: schema.emergencyTypes.id }).from(schema.emergencyTypes).where(eq(schema.emergencyTypes.media_id, id)).limit(1);
    const proofOfPlay = await db.select({ id: schema.proofOfPlay.id }).from(schema.proofOfPlay).where(eq(schema.proofOfPlay.media_id, id)).limit(1);
    const defaultMediaSetting = await db.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, DEFAULT_MEDIA_SETTING_KEY)).limit(1);
    const defaultMediaVariantsSetting = await db.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, DEFAULT_MEDIA_VARIANTS_SETTING_KEY)).limit(1);
    const defaultMediaTargetsSetting = await db.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, DEFAULT_MEDIA_TARGETS_SETTING_KEY)).limit(1);
    const brandingSetting = await db.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, 'org.branding')).limit(1);

    const references: MediaUsageReference[] = [];

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
    if (
      (typeof defaultMediaId === 'string' && defaultMediaId === id) ||
      (defaultMediaId &&
        typeof defaultMediaId === 'object' &&
        'media_id' in defaultMediaId &&
        (defaultMediaId as { media_id?: unknown }).media_id === id)
    ) {
      references.push('settings');
    }
    const variantMediaMap = defaultMediaVariantsSetting[0]?.value;
    if (
      variantMediaMap &&
      typeof variantMediaMap === 'object' &&
      !Array.isArray(variantMediaMap) &&
      Object.values(variantMediaMap as Record<string, unknown>).some((value) =>
        value === id || Boolean(
          value && typeof value === 'object' &&
          (value as { media_id?: unknown }).media_id === id
        )
      )
    ) {
      if (!references.includes('settings')) {
        references.push('settings');
      }
    }
    const targetAssignments = defaultMediaTargetsSetting[0]?.value;
    if (
      Array.isArray(targetAssignments) &&
      targetAssignments.some((value) => {
        if (!value || typeof value !== 'object') return false;
        const candidate = value as { media_id?: unknown };
        return candidate.media_id === id;
      })
    ) {
      if (!references.includes('settings')) {
        references.push('settings');
      }
    }
    const branding = brandingSetting[0]?.value;
    if (
      branding && typeof branding === 'object' && !Array.isArray(branding) &&
      ['logo_media_id', 'icon_media_id', 'favicon_media_id'].some(
        (key) => (branding as Record<string, unknown>)[key] === id
      ) && !references.includes('settings')
    ) {
      references.push('settings');
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

export function createMediaRepository(): MediaRepository {
  return new MediaRepository();
}
