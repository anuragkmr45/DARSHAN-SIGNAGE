import { eq, asc } from 'drizzle-orm';
import { getDatabase, schema, type DbExecutor } from '@/db';

export class PresentationItemRepository {
  async listByPresentation(presentationId: string, executor?: DbExecutor) {
    const db = executor ?? getDatabase();
    return db
      .select()
      .from(schema.presentationItems)
      .where(eq(schema.presentationItems.presentation_id, presentationId))
      .orderBy(asc(schema.presentationItems.order));
  }

  async create(data: {
    presentation_id: string;
    media_id: string;
    order: number;
    duration_seconds?: number;
    page_number?: number | null;
  }, executor?: DbExecutor) {
    const db = executor ?? getDatabase();
    const [item] = await db.insert(schema.presentationItems).values(data).returning();
    return item;
  }

  async findById(id: string, executor?: DbExecutor) {
    const db = executor ?? getDatabase();
    const [item] = await db.select().from(schema.presentationItems).where(eq(schema.presentationItems.id, id));
    return item || null;
  }

  async delete(id: string, executor?: DbExecutor) {
    const db = executor ?? getDatabase();
    await db.delete(schema.presentationItems).where(eq(schema.presentationItems.id, id));
  }
}

export function createPresentationItemRepository(): PresentationItemRepository {
  return new PresentationItemRepository();
}
