import { eq, desc, sql } from 'drizzle-orm';
import { getDatabase, schema } from '../index.js';
function resolveDb(executor) {
    return executor ?? getDatabase();
}
export class DeviceCertificateRepository {
    async create(data, executor) {
        const db = resolveDb(executor);
        const result = await db.insert(schema.deviceCertificates).values({
            screen_id: data.device_id,
            serial: data.serial,
            certificate_pem: data.certificate,
            public_key_pem: data.public_key_pem ?? null,
            auth_version: data.auth_version ?? 'legacy',
            expires_at: data.expires_at,
        }).returning();
        return result[0];
    }
    async findByDeviceId(deviceId, executor) {
        const db = resolveDb(executor);
        const result = await db
            .select()
            .from(schema.deviceCertificates)
            .where(eq(schema.deviceCertificates.screen_id, deviceId));
        return result[0] || null;
    }
    async listByDeviceId(deviceId, executor) {
        const db = resolveDb(executor);
        return await db
            .select()
            .from(schema.deviceCertificates)
            .where(eq(schema.deviceCertificates.screen_id, deviceId))
            .orderBy(desc(schema.deviceCertificates.created_at));
    }
    async findLatestByDeviceId(deviceId, executor) {
        const db = resolveDb(executor);
        const result = await db
            .select()
            .from(schema.deviceCertificates)
            .where(eq(schema.deviceCertificates.screen_id, deviceId))
            .orderBy(desc(schema.deviceCertificates.created_at))
            .limit(1);
        return result[0] || null;
    }
    async findByFingerprint(fingerprint, executor) {
        const db = resolveDb(executor);
        const result = await db
            .select()
            .from(schema.deviceCertificates)
            .where(eq(schema.deviceCertificates.serial, fingerprint));
        return result[0] || null;
    }
    async list(options) {
        const db = getDatabase();
        const page = options.page || 1;
        const limit = options.limit || 20;
        const offset = (page - 1) * limit;
        const total = await db.select({ count: sql `count(*)` }).from(schema.deviceCertificates);
        const items = await db
            .select()
            .from(schema.deviceCertificates)
            .orderBy(desc(schema.deviceCertificates.created_at))
            .limit(limit)
            .offset(offset);
        return {
            items,
            total: Number(total[0]?.count ?? 0),
            page,
            limit,
        };
    }
    async revoke(id, executor) {
        const db = resolveDb(executor);
        const result = await db
            .update(schema.deviceCertificates)
            .set({ is_revoked: true, revoked_at: new Date() })
            .where(eq(schema.deviceCertificates.id, id))
            .returning();
        return result[0] || null;
    }
    async revokeByDeviceId(deviceId, executor) {
        const db = resolveDb(executor);
        return await db
            .update(schema.deviceCertificates)
            .set({ is_revoked: true, revoked_at: new Date() })
            .where(eq(schema.deviceCertificates.screen_id, deviceId))
            .returning();
    }
    async findById(id, executor) {
        const db = resolveDb(executor);
        const result = await db
            .select()
            .from(schema.deviceCertificates)
            .where(eq(schema.deviceCertificates.id, id));
        return result[0] || null;
    }
}
export function createDeviceCertificateRepository() {
    return new DeviceCertificateRepository();
}
