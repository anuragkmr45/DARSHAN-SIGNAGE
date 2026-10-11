import { eq, desc } from 'drizzle-orm';
import crypto from 'crypto';
import { getDatabase, schema } from '../index.js';
export class WebhookRepository {
    generateSecret() {
        return crypto.randomBytes(16).toString('hex');
    }
    async create(data) {
        const db = getDatabase();
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
    async list() {
        const db = getDatabase();
        const items = await db.select().from(schema.webhookSubscriptions).orderBy(desc(schema.webhookSubscriptions.created_at));
        return items;
    }
    async findById(id) {
        const db = getDatabase();
        const [record] = await db.select().from(schema.webhookSubscriptions).where(eq(schema.webhookSubscriptions.id, id));
        return record || null;
    }
    async update(id, data) {
        const db = getDatabase();
        const [record] = await db
            .update(schema.webhookSubscriptions)
            .set({ ...data, updated_at: new Date() })
            .where(eq(schema.webhookSubscriptions.id, id))
            .returning();
        return record || null;
    }
    async delete(id) {
        const db = getDatabase();
        await db.delete(schema.webhookSubscriptions).where(eq(schema.webhookSubscriptions.id, id));
    }
}
export function createWebhookRepository() {
    return new WebhookRepository();
}
