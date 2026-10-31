import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildCreateCommandValues, commandRecoveryGenerationIsCurrent } from './command-lifecycle-service';

describe('device command recovery-generation binding', () => {
  it('persists the transaction-selected generation and distinguishes legacy/different commands', () => {
    const generation = randomUUID();
    const values = buildCreateCommandValues({ screenId: randomUUID(), type: 'PING', createdBy: randomUUID() }, randomUUID(), generation);
    expect(values.recovery_generation).toBe(generation);
    expect(commandRecoveryGenerationIsCurrent(generation, generation)).toBe(true);
    expect(commandRecoveryGenerationIsCurrent(null, generation)).toBe(false);
    expect(commandRecoveryGenerationIsCurrent(randomUUID(), generation)).toBe(false);
    expect(commandRecoveryGenerationIsCurrent(null, null)).toBe(true);
  });

  it('keeps generation selection, command insert, claim fencing, and serialization in the reviewed transaction path', async () => {
    const lifecycle = await readFile(new URL('./command-lifecycle-service.ts', import.meta.url), 'utf8');
    const selected = lifecycle.indexOf('const activeRecoveryGeneration = await activeRecoveryGenerationInTransaction(tx);');
    const inserted = lifecycle.indexOf('buildCreateCommandValues(input, id, activeRecoveryGeneration)');
    expect(selected).toBeGreaterThan(0);
    expect(inserted).toBeGreaterThan(selected);
    expect(lifecycle).toContain("reason: 'recovery_generation_mismatch_before_claim'");
    const route = await readFile(new URL('../routes/device-telemetry.ts', import.meta.url), 'utf8');
    expect(route.match(/recovery_generation: command\.recoveryGeneration/g)).toHaveLength(2);
    expect(route).not.toMatch(/commands: pendingCommands\.map[\s\S]{0,240}recovery_generation: recoveryGeneration/);
  });
});
