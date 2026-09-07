import { eq, desc, isNull, and, or, gt, sql } from 'drizzle-orm';
import { getDatabase, schema } from '@/db';

export class EmergencyRepository {
  async create(data: {
    triggered_by: string;
    message: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    emergency_type_id?: string | null;
    media_id?: string | null;
    screen_ids?: string[] | null;
    screen_group_ids?: string[] | null;
    target_all?: boolean;
    expires_at?: Date | null;
    audit_note?: string | null;
    idempotency_key?: string | null;
    request_fingerprint?: string | null;
  }) {
    const db = getDatabase();
    return await db.transaction(async (tx) => {
      const [emergency] = await tx
        .insert(schema.emergencies)
        .values({
          triggered_by: data.triggered_by,
          message: data.message,
          priority: data.severity,
          emergency_type_id: data.emergency_type_id ?? null,
          media_id: data.media_id ?? null,
          screen_ids: data.screen_ids ?? [],
          screen_group_ids: data.screen_group_ids ?? [],
          target_all: data.target_all ?? false,
          expires_at: data.expires_at ?? null,
          audit_note: data.audit_note ?? null,
          idempotency_key: data.idempotency_key ?? null,
          request_fingerprint: data.request_fingerprint ?? null,
          is_active: true,
        })
        .returning();

      if (!emergency) throw new Error('Emergency insert returned no row');
      await tx.insert(schema.emergencyTransitionOutbox).values({
        emergency_id: emergency.id,
        transition: 'START',
        transition_version: emergency.transition_version,
        selector: {
          target_all: emergency.target_all,
          screen_ids: emergency.screen_ids,
          screen_group_ids: emergency.screen_group_ids,
        },
        actor_id: data.triggered_by,
      });
      return emergency;
    });
  }

  async getActive() {
    const db = getDatabase();
    const result = await db
      .select()
      .from(schema.emergencies)
      .where(
        and(
          isNull(schema.emergencies.cleared_at),
          eq(schema.emergencies.is_active, true),
          or(isNull(schema.emergencies.expires_at), gt(schema.emergencies.expires_at, new Date()))
        )
      )
      .orderBy(desc(schema.emergencies.created_at));
    return result[0] || null;
  }

  async listActive() {
    const db = getDatabase();
    return db
      .select()
      .from(schema.emergencies)
      .where(
        and(
          isNull(schema.emergencies.cleared_at),
          eq(schema.emergencies.is_active, true),
          or(isNull(schema.emergencies.expires_at), gt(schema.emergencies.expires_at, new Date()))
        )
      )
      .orderBy(desc(schema.emergencies.created_at));
  }

  async list(options: {
    page?: number;
    limit?: number;
  }) {
    const db = getDatabase();
    const page = options.page || 1;
    const limit = options.limit || 20;
    const offset = (page - 1) * limit;

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.emergencies);

    const items = await db
      .select()
      .from(schema.emergencies)
      .orderBy(desc(schema.emergencies.created_at))
      .limit(limit)
      .offset(offset);

    return {
      items,
      total: Number(totalRow?.count || 0),
      page,
      limit,
    };
  }

  async clear(id: string, cleared_by: string, clear_reason?: string | null) {
    const db = getDatabase();
    return await db.transaction(async (tx) => {
      const [emergency] = await tx
        .update(schema.emergencies)
        .set({
          cleared_at: new Date(),
          cleared_by,
          clear_reason: clear_reason ?? null,
          is_active: false,
          transition_version: sql`${schema.emergencies.transition_version} + 1`,
          updated_at: new Date(),
        })
        .where(and(
          eq(schema.emergencies.id, id),
          eq(schema.emergencies.is_active, true),
          isNull(schema.emergencies.cleared_at)
        ))
        .returning();

      if (emergency) {
        await tx.insert(schema.emergencyTransitionOutbox).values({
          emergency_id: emergency.id,
          transition: 'CLEAR',
          transition_version: emergency.transition_version,
          selector: {
            target_all: emergency.target_all,
            screen_ids: emergency.screen_ids,
            screen_group_ids: emergency.screen_group_ids,
          },
          actor_id: cleared_by,
        });
        return { emergency, transitioned: true };
      }

      const [existing] = await tx
        .select()
        .from(schema.emergencies)
        .where(eq(schema.emergencies.id, id))
        .limit(1);
      return existing ? { emergency: existing, transitioned: false } : null;
    });
  }

  async findByUserAndIdempotencyKey(triggeredBy: string, idempotencyKey: string) {
    const db = getDatabase();
    const [result] = await db
      .select()
      .from(schema.emergencies)
      .where(and(
        eq(schema.emergencies.triggered_by, triggeredBy),
        eq(schema.emergencies.idempotency_key, idempotencyKey)
      ))
      .limit(1);
    return result || null;
  }

  async findById(id: string) {
    const db = getDatabase();
    const result = await db
      .select()
      .from(schema.emergencies)
      .where(eq(schema.emergencies.id, id));
    return result[0] || null;
  }
}

export function createEmergencyRepository(): EmergencyRepository {
  return new EmergencyRepository();
}
