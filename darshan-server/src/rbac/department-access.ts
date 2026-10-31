import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@/db';
import type { AppAbility } from '@/rbac';

const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Keep Department list/count SQL aligned with supported record-read grants. */
export function departmentReadPredicate(ability: AppAbility): SQL {
  const permitted: SQL[] = [];
  for (const rule of ability.rules) {
    if (rule.inverted) continue;
    const actions = Array.isArray(rule.action) ? rule.action : [rule.action];
    const subjects = Array.isArray(rule.subject) ? rule.subject : [rule.subject];
    if (!actions.some((action) => action === 'read' || action === 'manage') ||
        !subjects.some((item) => item === 'Department' || item === 'all')) continue;

    const conditions = rule.conditions as Record<string, unknown> | undefined;
    if (conditions === undefined) return sql`true`;
    if (conditions === null || typeof conditions !== 'object' || Array.isArray(conditions)) continue;
    if (Object.keys(conditions).length === 0) return sql`true`;

    const parts: SQL[] = [];
    for (const [key, value] of Object.entries(conditions)) {
      if (typeof value !== 'string') { parts.length = 0; break; }
      if (key === 'id' && canonicalUuid.test(value)) parts.push(eq(schema.departments.id, value));
      else if (key === 'name') parts.push(eq(schema.departments.name, value));
      else if (key === 'description') parts.push(eq(schema.departments.description, value));
      else { parts.length = 0; break; }
    }
    if (parts.length > 0) permitted.push(and(...parts)!);
  }
  return permitted.length > 0 ? or(...permitted)! : sql`false`;
}
