import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { DbExecutor } from '@/db';
const fixture = vi.hoisted(() => ({ global: vi.fn(() => { throw new Error('Global pool must not be used during locked authorization'); }) }));
vi.mock('@/db', async () => ({ schema: await vi.importActual('@/db/schema'), getDatabase: fixture.global }));
import { defineAbilityFor } from './index';

describe('effective permissions on the supplied locked transaction', () => {
  it('reads the direct and inherited role graph without acquiring another pool connection', async () => {
    const actor = randomUUID(), department = randomUUID(), root = randomUUID(), parent = randomUUID();
    const rows = [{ id: root, name: 'SYNTHETIC_RUNTIME_PRESENTER', permissions: { grants: [], inherits: [parent] } },
      { id: parent, name: 'SYNTHETIC_PARENT', permissions: { grants: [{ action: 'publish', subject: 'LiveBroadcast', conditions: { presenter_user_id: '$user.id' } }] } }];
    const where = vi.fn(async () => [rows.shift()]);
    const tx = { select: () => ({ from: () => ({ where }) }) } as unknown as DbExecutor;
    const ability = await defineAbilityFor(root, actor, department, tx);
    expect(where).toHaveBeenCalledTimes(2); expect(fixture.global).not.toHaveBeenCalled();
    const { subject } = await import('@casl/ability');
    expect(ability.can('publish', subject('LiveBroadcast', { presenter_user_id: actor }) as never)).toBe(true);
    expect(ability.can('publish', subject('LiveBroadcast', { presenter_user_id: randomUUID() }) as never)).toBe(false);
  });
});
