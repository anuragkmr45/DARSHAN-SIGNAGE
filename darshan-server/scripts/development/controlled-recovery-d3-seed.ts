import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import type { D3FixtureInventory } from './controlled-recovery-d3-fixtures';

export const D3_SEED_CASES = [
  'IMAGE', 'SHORT_VIDEO', 'MULTIPAGE_PDF_SELECTED_PAGE', 'OFFLINE_WEBPAGE', 'LAYOUT_PRESENTATION', 'SCHEDULE_DEFAULT',
  'EMERGENCY_LOOP', 'CHAT_ATTACHMENT', 'PROOF_OF_PLAY', 'SCREENSHOT', 'LOGS', 'OLD_SESSION_PAIRING_COMMAND_OUTBOX_JOBS',
] as const;
export interface D3SeedSqlBoundary {
  currentMigration(): Promise<string>;
  seedCurrentSchema0057(input: { fixtureInventorySha256: string; cases: typeof D3_SEED_CASES }): Promise<{ transactionCommitted: boolean; rowCountsSha256: string; contentSha256: string }>;
}
export async function seedD3CurrentSchema(boundary: D3SeedSqlBoundary, inventory: D3FixtureInventory) {
  if (await boundary.currentMigration() !== '0057_controlled_recovery_report_projection')
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SCHEMA_MISMATCH', 'D3 source is not at the enrolled 0057 schema.');
  const result = await boundary.seedCurrentSchema0057({ fixtureInventorySha256: inventory.aggregateSha256, cases: D3_SEED_CASES });
  if (!result.transactionCommitted || !/^[a-f0-9]{64}$/.test(result.rowCountsSha256) || !/^[a-f0-9]{64}$/.test(result.contentSha256))
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SEED_FAILED', 'D3 representative seed transaction is incomplete.');
  return { ...result, catalogSha256: digest(D3_SEED_CASES) };
}
