import { eq, and, desc, gt, lte, sql } from 'drizzle-orm';
import { getDatabase, schema } from '../index.js';
function resolveDb(executor) {
    return executor ?? getDatabase();
}
export class DevicePairingRepository {
    async create(data, executor) {
        const db = resolveDb(executor);
        const result = await db.insert(schema.devicePairings).values(data).returning();
        return result[0];
    }
    async findByCode(code, executor) {
        const db = resolveDb(executor);
        const result = await db
            .select()
            .from(schema.devicePairings)
            .where(and(eq(schema.devicePairings.pairing_code, code), eq(schema.devicePairings.used, false), gt(schema.devicePairings.expires_at, new Date())));
        return result[0] || null;
    }
    async findActiveById(id, executor) {
        const db = resolveDb(executor);
        const result = await db
            .select()
            .from(schema.devicePairings)
            .where(and(eq(schema.devicePairings.id, id), eq(schema.devicePairings.used, false), gt(schema.devicePairings.expires_at, new Date())))
            .limit(1);
        return result[0] || null;
    }
    async findAnyByCode(code, executor) {
        const db = resolveDb(executor);
        const result = await db
            .select()
            .from(schema.devicePairings)
            .where(eq(schema.devicePairings.pairing_code, code))
            .orderBy(desc(schema.devicePairings.created_at))
            .limit(1);
        return result[0] || null;
    }
    async findByDeviceId(deviceId, executor) {
        const db = resolveDb(executor);
        const result = await db
            .select()
            .from(schema.devicePairings)
            .where(eq(schema.devicePairings.device_id, deviceId))
            .orderBy(desc(schema.devicePairings.created_at));
        return result[0] || null;
    }
    async findActiveByDeviceId(deviceId, executor) {
        const db = resolveDb(executor);
        const result = await db
            .select()
            .from(schema.devicePairings)
            .where(and(eq(schema.devicePairings.device_id, deviceId), eq(schema.devicePairings.used, false), gt(schema.devicePairings.expires_at, new Date())))
            .orderBy(desc(schema.devicePairings.created_at));
        return result[0] || null;
    }
    async markAsUsed(id, executor) {
        const db = resolveDb(executor);
        const result = await db
            .update(schema.devicePairings)
            .set({ used: true, used_at: new Date() })
            .where(eq(schema.devicePairings.id, id))
            .returning();
        return result[0] || null;
    }
    async markAsUsedIfActive(id, executor) {
        const db = resolveDb(executor);
        const now = new Date();
        const result = await db
            .update(schema.devicePairings)
            .set({ used: true, used_at: now })
            .where(and(eq(schema.devicePairings.id, id), eq(schema.devicePairings.used, false), gt(schema.devicePairings.expires_at, now)))
            .returning();
        return result[0] || null;
    }
    async retireExpired(executor) {
        const db = resolveDb(executor);
        const now = new Date();
        return await db
            .update(schema.devicePairings)
            .set({
            used: true,
            used_at: now,
        })
            .where(and(eq(schema.devicePairings.used, false), lte(schema.devicePairings.expires_at, now)))
            .returning();
    }
    async retireActiveByDeviceId(deviceId, exceptId, executor) {
        const db = resolveDb(executor);
        const activePairings = await db
            .select({ id: schema.devicePairings.id })
            .from(schema.devicePairings)
            .where(and(eq(schema.devicePairings.device_id, deviceId), eq(schema.devicePairings.used, false), gt(schema.devicePairings.expires_at, new Date())));
        const retireIds = activePairings
            .map((row) => row.id)
            .filter((id) => !exceptId || id !== exceptId);
        if (retireIds.length === 0) {
            return [];
        }
        const retired = [];
        const usedAt = new Date();
        for (const id of retireIds) {
            const [row] = await db
                .update(schema.devicePairings)
                .set({ used: true, used_at: usedAt })
                .where(eq(schema.devicePairings.id, id))
                .returning();
            if (row) {
                retired.push(row);
            }
        }
        return retired;
    }
    async updateDeviceInfo(id, device_info, executor) {
        const db = resolveDb(executor);
        const result = await db
            .update(schema.devicePairings)
            .set({ device_info })
            .where(eq(schema.devicePairings.id, id))
            .returning();
        return result[0] || null;
    }
    async list(options) {
        const db = getDatabase();
        const page = options.page || 1;
        const limit = options.limit || 20;
        const offset = (page - 1) * limit;
        const [total] = await db.select({ count: sql `count(*)` }).from(schema.devicePairings);
        const items = await db
            .select()
            .from(schema.devicePairings)
            .orderBy(desc(schema.devicePairings.created_at))
            .limit(limit)
            .offset(offset);
        return {
            items,
            total: Number(total?.count ?? 0),
            page,
            limit,
        };
    }
    async findById(id, executor) {
        const db = resolveDb(executor);
        const result = await db
            .select()
            .from(schema.devicePairings)
            .where(eq(schema.devicePairings.id, id));
        return result[0] || null;
    }
}
export function createDevicePairingRepository() {
    return new DevicePairingRepository();
}
