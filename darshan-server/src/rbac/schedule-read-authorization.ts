import { subject } from '@casl/ability';
import { and, getTableColumns, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import { schema } from '@/db';
import { canReadContentResource, type ContentAbility, type ContentOwnedResource } from './content-ownership';
import type { ActorContext } from './policy';

type Rule = { conditions?: unknown; inverted?: boolean; fields?: unknown };
type ReadAbility = ContentAbility & { rulesFor?: (action: string, resource: string) => Rule[] };

/** SQL equivalent of CASL's first matching rule, in priority order. The role
 * editor currently supports flat scalar equality; unsupported rule shapes fail
 * closed rather than disappearing into an unconditional permission. */
function compileSchedulePermission(ability: ContentAbility | undefined, action: string,
  resource: 'Schedule' | 'ScheduleRequest', table: AnyPgTable): SQL | undefined {
  const inspected = ability as ReadAbility | undefined;
  if (!inspected?.rulesFor) return undefined;
  const columns = getTableColumns(table);
  const rules = inspected.rulesFor(action, resource);
  const clauses: SQL[] = [];
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index]!;
    if (rule.fields !== undefined) return undefined;
    let match: SQL = sql`true`;
    if (rule.conditions !== undefined) {
      if (!rule.conditions || typeof rule.conditions !== 'object' || Array.isArray(rule.conditions) ||
          ![Object.prototype, null].includes(Object.getPrototypeOf(rule.conditions))) return undefined;
      const terms: SQL[] = [];
      for (const [key, value] of Object.entries(rule.conditions)) {
        if (!Object.hasOwn(columns, key)) return undefined;
        const column = columns[key]!;
        if (value === null) terms.push(sql`${column} IS NULL`);
        else if (column.dataType === 'string' && typeof value === 'string') {
          // PostgreSQL UUID/enum coercion is broader than JS string equality
          // (and rejects some strings). Text comparison preserves CASL rules.
          terms.push(sql`COALESCE(CAST(${column} AS text) = ${value}, false)`);
        } else if (column.dataType === 'boolean' && typeof value === 'boolean') terms.push(sql`${column} = ${value}`);
        else if (column.dataType === 'number' && typeof value === 'number' && Number.isFinite(value)) terms.push(sql`${column} = ${value}`);
        else return undefined;
      }
      match = terms.length ? and(...terms)! : sql`true`;
    }
    clauses.push(sql`WHEN ${match} THEN ${!rule.inverted}`);
  }
  return clauses.length ? sql`CASE ${sql.join(clauses, sql` `)} ELSE false END` : sql`false`;
}

export function scheduleRecordPermissionCondition(ability: ContentAbility | undefined, action: string,
  resource: 'Schedule' | 'ScheduleRequest', table: AnyPgTable): SQL {
  return compileSchedulePermission(ability, action, resource, table) ?? sql`false`;
}

export function scheduleReadCondition(actor: ActorContext, ability?: ContentAbility): SQL {
  const departments = actor.departmentIds ?? (actor.departmentId ? [actor.departmentId] : []);
  const ownership = or(sql`${schema.schedules.owner_scope} = 'ORGANIZATION'`,
    departments.length ? and(sql`${schema.schedules.owner_scope} = 'DEPARTMENT'`, inArray(schema.schedules.owner_department_id, departments)) : sql`false`)!;
  return and(scheduleRecordPermissionCondition(ability, 'read', 'Schedule', schema.schedules),
    or(scheduleRecordPermissionCondition(ability, 'manage', 'Schedule', schema.schedules), ownership))!;
}

export function scheduleRequestReadCondition(actor: ActorContext, ability?: ContentAbility): SQL {
  return and(scheduleRecordPermissionCondition(ability, 'read', 'ScheduleRequest', schema.scheduleRequests),
    sql`EXISTS (SELECT 1 FROM ${schema.schedules} WHERE ${schema.schedules.id} = ${schema.scheduleRequests.schedule_id}
      AND ${scheduleReadCondition(actor, ability)})`)!;
}

export function canReadScheduleRecord(actor: ActorContext, schedule: ContentOwnedResource, ability: ContentAbility): boolean {
  if (!compileSchedulePermission(ability, 'read', 'Schedule', schema.schedules) ||
      !compileSchedulePermission(ability, 'manage', 'Schedule', schema.schedules)) return false;
  return canReadContentResource(actor, schedule,
    { can: action => ability.can(action, subject('Schedule', schedule) as never) }, 'Schedule');
}

export function canReadScheduleRequestRecord(request: object, ability: ContentAbility): boolean {
  return Boolean(compileSchedulePermission(ability, 'read', 'ScheduleRequest', schema.scheduleRequests)) &&
    ability.can('read', subject('ScheduleRequest', request) as never);
}
