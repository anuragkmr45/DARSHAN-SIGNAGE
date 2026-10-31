import { eq, desc, type SQL } from 'drizzle-orm';
import crypto from 'crypto';
import { getDatabase, schema, type DbExecutor } from '@/db';

export class WebhookRepository {
  private generateSecret() {
    return crypto.randomBytes(16).toString('hex');
  }

  async create(data: {
    name: string;
    event_types: string[];
    target_url: string;
    headers?: Record<string, string>;
    is_active?: boolean;
    created_by: string;
  }, executor: DbExecutor = getDatabase()) {
    const db = executor;
    const secret = this.generateSecret();
    const [record] = await db
      .insert(schema.webhookSubscriptions)
      .values({
        name: data.name,
        event_types: data.event_types,
        target_url: data.target_url,
        headers: data.headers,
        is_active: data.is_active ?? true,
        secret,
        created_by: data.created_by,
      })
      .returning();
    return { record, secret };
  }

  async list(readCondition?: SQL, executor: DbExecutor = getDatabase()) {
    const db = executor;
    const items = await db
      .select()
      .from(schema.webhookSubscriptions)
      .where(readCondition)
      .orderBy(desc(schema.webhookSubscriptions.created_at));
    return items;
  }

  async findById(id: string, executor: DbExecutor = getDatabase()) {
    const db = executor;
    const [record] = await db.select().from(schema.webhookSubscriptions).where(eq(schema.webhookSubscriptions.id, id));
    return record || null;
  }

  async findByIdForUpdate(id: string, executor: DbExecutor) {
    const [record] = await executor
      .select()
      .from(schema.webhookSubscriptions)
      .where(eq(schema.webhookSubscriptions.id, id))
      .for('update');
    return record || null;
  }

  async update(id: string, data: Partial<typeof schema.webhookSubscriptions.$inferInsert>, executor: DbExecutor = getDatabase()) {
    const db = executor;
    const [record] = await db
      .update(schema.webhookSubscriptions)
      .set({ ...data, updated_at: new Date() })
      .where(eq(schema.webhookSubscriptions.id, id))
      .returning();
    return record || null;
  }

  async delete(id: string, executor: DbExecutor = getDatabase()) {
    const db = executor;
    await db.delete(schema.webhookSubscriptions).where(eq(schema.webhookSubscriptions.id, id));
  }
}

export function createWebhookRepository(): WebhookRepository {
  return new WebhookRepository();
}
