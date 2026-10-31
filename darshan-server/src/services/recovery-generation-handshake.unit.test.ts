import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { recoveryGenerationRequiresAuthorityReset } from './recovery-generation-handshake';

describe('server recovery-generation authority transition', () => {
  it('preserves counters for same-generation reconnect proofs and resets only on generation change', () => {
    const generation = randomUUID();
    expect(recoveryGenerationRequiresAuthorityReset(generation, generation)).toBe(false);
    expect(recoveryGenerationRequiresAuthorityReset(null, generation)).toBe(true);
    expect(recoveryGenerationRequiresAuthorityReset(randomUUID(), generation)).toBe(true);
  });
});
