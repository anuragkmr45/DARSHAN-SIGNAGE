import { eq, and } from 'drizzle-orm';
import { getDatabase, schema } from '../index.js';
export class SessionRepository {
    async create(data) {
        const db = getDatabase();
        const result = await db.insert(schema.sessions).values(data).returning();
        return result[0];
    }
    async findByJti(jti) {
        const db = getDatabase();
        const result = await db
            .select()
            .from(schema.sessions)
            .where(eq(schema.sessions.access_jti, jti));
        return result[0] || null;
    }
    async findByUserId(userId) {
        const db = getDatabase();
        const result = await db
            .select()
            .from(schema.sessions)
            .where(eq(schema.sessions.user_id, userId));
        return result;
    }
    async revokeByJti(jti) {
        const db = getDatabase();
        await db.delete(schema.sessions).where(eq(schema.sessions.access_jti, jti));
    }
    async revokeByUserId(userId) {
        const db = getDatabase();
        await db.delete(schema.sessions).where(eq(schema.sessions.user_id, userId));
    }
    async extendByJti(jti, expiresAt) {
        const db = getDatabase();
        const [session] = await db
            .update(schema.sessions)
            .set({ expires_at: expiresAt })
            .where(eq(schema.sessions.access_jti, jti))
            .returning();
        return session || null;
    }
    async cleanupExpired() {
        const db = getDatabase();
        await db
            .delete(schema.sessions)
            .where(and(eq(schema.sessions.expires_at, new Date())));
    }
}
export function createSessionRepository() {
    return new SessionRepository();
}
