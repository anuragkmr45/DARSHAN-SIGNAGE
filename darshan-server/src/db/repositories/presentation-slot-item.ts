import { eq, asc } from 'drizzle-orm';
import { getDatabase, schema, type DbExecutor } from '@/db';

export class PresentationSlotItemRepository {
  async listByPresentation(presentationId: string, executor?: DbExecutor) {
    const db = executor ?? getDatabase();
    return db
      .select()
      .from(schema.presentationSlotItems)
      .where(eq(schema.presentationSlotItems.presentation_id, presentationId))
      .orderBy(asc(schema.presentationSlotItems.slot_id), asc(schema.presentationSlotItems.order));
  }

  async create(data: {
    presentation_id: string;
    slot_id: string;
    media_id: string;
    order?: number;
    duration_seconds?: number;
    fit_mode?: string;
    audio_enabled?: boolean;
    loop_enabled?: boolean;
    page_number?: number | null;
  }, executor?: DbExecutor) {
    const db = executor ?? getDatabase();
    const [item] = await db.insert(schema.presentationSlotItems).values(data).returning();
    return item;
  }

  async replaceByPresentation(
    presentationId: string,
    items: Array<{
      slot_id: string;
      media_id: string;
      order: number;
      duration_seconds?: number;
      fit_mode?: string;
      audio_enabled?: boolean;
      loop_enabled?: boolean;
      page_number?: number | null;
    }>,
    executor?: DbExecutor
  ) {
    const replace = async (tx: DbExecutor) => {
      await tx
        .delete(schema.presentationSlotItems)
        .where(eq(schema.presentationSlotItems.presentation_id, presentationId));

      if (items.length === 0) return [];

      return tx
        .insert(schema.presentationSlotItems)
        .values(items.map((item) => ({ ...item, presentation_id: presentationId })))
        .returning();
    };
    return executor ? replace(executor) : getDatabase().transaction(replace);
  }

  async findById(id: string, executor?: DbExecutor) {
    const db = executor ?? getDatabase();
    const [item] = await db.select().from(schema.presentationSlotItems).where(eq(schema.presentationSlotItems.id, id));
    return item || null;
  }

  async delete(id: string, executor?: DbExecutor) {
    const db = executor ?? getDatabase();
    await db.delete(schema.presentationSlotItems).where(eq(schema.presentationSlotItems.id, id));
  }
}

export function createPresentationSlotItemRepository(): PresentationSlotItemRepository {
  return new PresentationSlotItemRepository();
}
