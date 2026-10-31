import { createMongoAbility } from '@casl/ability';
import { describe, expect, it } from 'vitest';
import type { AppAbility } from '@/rbac';
import { conversationReadAccess } from './conversations';

describe('legacy conversation access', () => {
  it('evaluates conditional read against the actual DM record', () => {
    const ability = createMongoAbility([
      { action: 'read', subject: 'Conversation', conditions: { id: 'allowed' } },
    ]) as AppAbility;
    const access = conversationReadAccess(ability);

    expect(access.allowLegacyMigration).toBe(false);
    expect(() => access.authorize({ id: 'allowed', type: 'DM' })).not.toThrow();
    expect(() => access.authorize({ id: 'denied', type: 'DM' })).toThrow();
  });

  it('keeps unconditional read available for legacy data migration', () => {
    const ability = createMongoAbility([{ action: 'read', subject: 'Conversation' }]) as AppAbility;
    const access = conversationReadAccess(ability);

    expect(access.allowLegacyMigration).toBe(true);
    expect(() => access.authorize({ id: 'any', type: 'DM' })).not.toThrow();
  });
});
