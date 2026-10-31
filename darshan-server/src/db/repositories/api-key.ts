import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import crypto from 'crypto';
import { getDatabase, schema, type DbExecutor } from '@/db';

export class ApiKeyRepository {
  private hashSecret(secret: string) {
    return crypto.createHash('sha256').update(secret).digest('hex');
  }

  private generateSecret() {
    const raw = crypto.randomBytes(24).toString('base64url'); // ~32 chars
    const prefix = raw.substring(0, 12);
    return { raw, prefix };
  }

  async create(data: {
    name: string;
    scopes?: string[];
    roles?: string[];
    created_by: string;
    expires_at?: Date | null;
  }, executor: DbExecutor = getDatabase()) {
    const db = executor;
    const { raw, prefix } = this.generateSecret();
    const hash = this.hashSecret(raw);

    const [record] = await db
      .insert(schema.apiKeys)
      .values({
        name: data.name,
        scopes: data.scopes,
        roles: data.roles,
        created_by: data.created_by,
        expires_at: data.expires_at ?? null,
        token_prefix: prefix,
        secret_hash: hash,
      })
      .returning();

    return { record, secret: raw };
  }

  async list(options: { page?: number; limit?: number; includeRevoked?: boolean; readCondition?: SQL }, executor: DbExecutor = getDatabase()) {
    const db = executor;
    const page = options.page || 1;
    const limit = options.limit || 20;
    const offset = (page - 1) * limit;

    const includeRevoked = options.includeRevoked ?? false;
    const activeCondition = includeRevoked ? undefined : eq(schema.apiKeys.is_revoked, false);
    const where = activeCondition && options.readCondition
      ? and(activeCondition, options.readCondition)
      : activeCondition ?? options.readCondition;

    const items = await db
      .select()
      .from(schema.apiKeys)
      .where(where as any)
      .orderBy(desc(schema.apiKeys.created_at))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.apiKeys)
      .where(where as any);

    return { items, total: Number(totalRow?.count || 0), page, limit };
  }

  async findById(id: string, executor: DbExecutor = getDatabase()) {
    const db = executor;
    const [record] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, id));
    return record || null;
  }

  async findByIdForUpdate(id: string, executor: DbExecutor) {
    const [record] = await executor
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, id))
      .for('update');
    return record || null;
  }

  async revoke(id: string, executor: DbExecutor = getDatabase()) {
    const db = executor;
    const [record] = await db
      .update(schema.apiKeys)
      .set({ is_revoked: true, updated_at: new Date() })
      .where(eq(schema.apiKeys.id, id))
      .returning();
    return record || null;
  }

  async rotate(id: string, executor: DbExecutor = getDatabase()) {
    const db = executor;
    const { raw, prefix } = this.generateSecret();
    const hash = this.hashSecret(raw);
    const [record] = await db
      .update(schema.apiKeys)
      .set({
        token_prefix: prefix,
        secret_hash: hash,
        is_revoked: false,
        updated_at: new Date(),
      })
      .where(eq(schema.apiKeys.id, id))
      .returning();
    return { record: record || null, secret: raw };
  }

  async touchLastUsed(prefix: string) {
    const db = getDatabase();
    await db
      .update(schema.apiKeys)
      .set({ last_used_at: new Date() })
      .where(and(eq(schema.apiKeys.token_prefix, prefix), eq(schema.apiKeys.is_revoked, false)));
  }
}

export function createApiKeyRepository(): ApiKeyRepository {
  return new ApiKeyRepository();
}
