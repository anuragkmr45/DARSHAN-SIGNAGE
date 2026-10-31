import { ControlledRecoveryError, digest } from './contracts';

export const FIXED_PSQL_IMPORT_ARGUMENTS = Object.freeze(['-X', '--set=ON_ERROR_STOP=1', '--single-transaction'] as const);

export interface DatabaseObservation {
  targetId: string; owned: boolean; empty: boolean; importMarker: 'ABSENT' | 'STARTED' | 'COMPLETED';
  schemaMigrationId?: string; tableCounts?: Record<string, string>;
}

export interface DatabaseImportAdapter {
  observe(signal?: AbortSignal): Promise<DatabaseObservation>;
  importDump(input: { dumpFile: string; arguments: readonly string[]; ambientOptions: Readonly<Record<string, never>>; signal?: AbortSignal }): Promise<void>;
  resetOwned(signal?: AbortSignal): Promise<void>;
}

function validateCounts(counts: Record<string, string> | undefined): Record<string, string> {
  if (!counts || Object.entries(counts).some(([table, value]) => !/^[a-z_][a-z0-9_]*$/.test(table) || !/^(0|[1-9][0-9]*)$/.test(value))) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DATABASE_OBSERVATION_INVALID', 'Database table-count observation is invalid.');
  }
  return counts;
}

export async function restoreDatabase(input: {
  adapter: DatabaseImportAdapter; dumpFile: string; expectedTargetId: string; terminalMigrationId: string; signal?: AbortSignal;
}): Promise<{ baselineTableCounts: Record<string, string>; evidenceSha256: string }> {
  const before = await input.adapter.observe(input.signal);
  if (before.targetId !== input.expectedTargetId || !before.owned) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DATABASE_FOREIGN', 'Database target is not exactly owned by this operation.');
  if (before.importMarker === 'COMPLETED') {
    if (before.schemaMigrationId !== input.terminalMigrationId) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DATABASE_IMPORT_AMBIGUOUS', 'Completed database import has unexpected schema identity.');
    const counts = validateCounts(before.tableCounts); return { baselineTableCounts: counts, evidenceSha256: digest({ targetId: before.targetId, schemaMigrationId: before.schemaMigrationId, counts }) };
  }
  if (!before.empty || before.importMarker === 'STARTED') {
    // Ambiguous/failed imports can recreate only the already verified owned database target.
    await input.adapter.resetOwned(input.signal);
    const reset = await input.adapter.observe(input.signal);
    if (reset.targetId !== input.expectedTargetId || !reset.owned || !reset.empty || reset.importMarker !== 'ABSENT') {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DATABASE_RESET_FAILED', 'Owned database target did not return to exact empty state.');
    }
  }
  try { await input.adapter.importDump({ dumpFile: input.dumpFile, arguments: FIXED_PSQL_IMPORT_ARGUMENTS, ambientOptions: {}, signal: input.signal }); }
  catch (cause) {
    const observed = await input.adapter.observe(input.signal).catch(() => null);
    if (!observed || observed.importMarker !== 'COMPLETED') throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DATABASE_IMPORT_AMBIGUOUS', 'Database import failed with non-confirmed target truth; retain or safely recreate only the owned target.', { cause });
  }
  const after = await input.adapter.observe(input.signal);
  if (after.targetId !== input.expectedTargetId || !after.owned || after.importMarker !== 'COMPLETED' || after.schemaMigrationId !== input.terminalMigrationId) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DATABASE_IMPORT_AMBIGUOUS', 'Database import result was not exactly re-observed.');
  }
  const counts = validateCounts(after.tableCounts);
  return { baselineTableCounts: counts, evidenceSha256: digest({ targetId: after.targetId, schemaMigrationId: after.schemaMigrationId, counts }) };
}

