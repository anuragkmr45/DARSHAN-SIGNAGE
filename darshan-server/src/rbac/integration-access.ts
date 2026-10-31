import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import type { AppAbility } from '@/rbac';

export type IntegrationSubject = 'ApiKey' | 'Webhook';

type IntegrationColumns = {
  id: any;
  name: any;
  created_by: any;
  target_url?: any;
};

const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Translate the supported equality-only integration record conditions to SQL.
 * A conditional rule with an unsupported field or malformed UUID grants no
 * list rows; it is never treated as an unrestricted subject permission.
 */
export function integrationReadCondition(
  ability: AppAbility,
  subject: IntegrationSubject,
  columns: IntegrationColumns
): SQL {
  const permitted: SQL[] = [];
  for (const rule of ability.rules) {
    if (rule.inverted) continue;
    const actions = Array.isArray(rule.action) ? rule.action : [rule.action];
    const subjects = Array.isArray(rule.subject) ? rule.subject : [rule.subject];
    if (!actions.some((action) => action === 'read' || action === 'manage') ||
        !subjects.some((item) => item === subject || item === 'all')) continue;

    const conditions = rule.conditions as Record<string, unknown> | undefined;
    if (conditions === undefined || Object.keys(conditions).length === 0) return sql`true`;
    if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions)) continue;

    const parts: SQL[] = [];
    let supported = true;
    for (const [key, value] of Object.entries(conditions)) {
      if (typeof value !== 'string') {
        supported = false;
        break;
      }
      if (key === 'id' || key === 'created_by') {
        if (!canonicalUuid.test(value)) {
          supported = false;
          break;
        }
        parts.push(eq(columns[key], value));
      } else if (key === 'name') {
        parts.push(eq(columns.name, value));
      } else if (key === 'target_url' && subject === 'Webhook' && columns.target_url) {
        parts.push(eq(columns.target_url, value));
      } else {
        supported = false;
        break;
      }
    }
    if (supported && parts.length > 0) permitted.push(and(...parts)!);
  }
  return permitted.length > 0 ? or(...permitted)! : sql`false`;
}
