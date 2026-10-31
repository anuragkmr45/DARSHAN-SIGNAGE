import { ControlledRecoveryError, canonicalDecimal, digest } from './contracts';

export const REQUIRED_REFERENCE_CLASSES = [
  'storage_objects', 'media', 'thumbnail', 'pdf', 'fallback', 'chat', 'screenshot',
  'proof_of_play', 'heartbeat', 'log', 'layout', 'presentation', 'schedule', 'default', 'emergency',
] as const;
export type ReferenceClass = typeof REQUIRED_REFERENCE_CLASSES[number];

export interface RecoveredReference {
  class: ReferenceClass; objectKey: string | null; recordIdSha256: string;
}

export interface DataValidationObservation {
  references: RecoveredReference[];
  objectKeys: string[];
  integrityChecks: Record<ReferenceClass, boolean>;
  postValidationTableCounts: Record<string, string>;
  reconciliationDeltas: Record<string, string>;
  excludedObjects: Array<{ keySha256: string; reason: 'STAGING' | 'RECURSIVE_ARCHIVE' | 'TRANSIENT' }>;
  excludedSummary: Record<'STAGING' | 'RECURSIVE_ARCHIVE' | 'TRANSIENT', string>;
}

export interface DataValidationAdapter {
  observe(signal?: AbortSignal): Promise<DataValidationObservation>;
}

function count(value: string, label: string): bigint { return canonicalDecimal(value, label); }

export async function validateRecoveredData(input: {
  adapter: DataValidationAdapter; baselineTableCounts: Record<string, string>;
  allowedReconciliationDeltas: Record<string, string>; signal?: AbortSignal;
}): Promise<{ evidenceSha256: string; aggregateCounts: Record<string, string>; excludedCount: string }> {
  const observed = await input.adapter.observe(input.signal);
  const keys = new Set(observed.objectKeys);
  if (keys.size !== observed.objectKeys.length) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_VALIDATION_OBJECT_DUPLICATE', 'Recovered object enumeration contains duplicates.');
  for (const required of REQUIRED_REFERENCE_CLASSES) {
    if (observed.integrityChecks[required] !== true) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_VALIDATION_CHECK_FAILED', `Required ${required} integrity validation failed.`);
  }
  for (const reference of observed.references) {
    if (!REQUIRED_REFERENCE_CLASSES.includes(reference.class) || !/^[a-f0-9]{64}$/.test(reference.recordIdSha256) ||
        (reference.objectKey !== null && !keys.has(reference.objectKey))) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_VALIDATION_MISSING_REFERENCE', 'A recovered database-to-object reference does not resolve.');
    }
  }
  const allowedTables = Object.keys(input.allowedReconciliationDeltas).sort();
  if (JSON.stringify(Object.keys(observed.reconciliationDeltas).sort()) !== JSON.stringify(allowedTables)) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_RECONCILIATION_UNEXPECTED', 'Post-import reconciliation changed an unapproved table.');
  }
  for (const [table, baselineText] of Object.entries(input.baselineTableCounts)) {
    const baseline = count(baselineText, `baseline ${table}`);
    const actual = count(observed.postValidationTableCounts[table] ?? '', `post-validation ${table}`);
    const allowed = count(input.allowedReconciliationDeltas[table] ?? '0', `allowed reconciliation ${table}`);
    const recorded = count(observed.reconciliationDeltas[table] ?? '0', `recorded reconciliation ${table}`);
    if (recorded > allowed || actual !== baseline + recorded) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_RECONCILIATION_DELTA', 'Post-import table counts exceed or differ from recorded allowed reconciliation deltas.');
    }
  }
  const excludedReasons = ['STAGING', 'RECURSIVE_ARCHIVE', 'TRANSIENT'] as const;
  if (observed.excludedObjects.some((entry) => !/^[a-f0-9]{64}$/.test(entry.keySha256)) || excludedReasons.some((reason) =>
    count(observed.excludedSummary[reason], `excluded ${reason}`) !== BigInt(observed.excludedObjects.filter((entry) => entry.reason === reason).length))) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_EXCLUSIONS_UNRECONCILED', 'Excluded staging, recursive archive, and transient objects were not explicitly reconciled.');
  }
  const aggregateCounts = Object.fromEntries(REQUIRED_REFERENCE_CLASSES.map((kind) => [kind, observed.references.filter((reference) => reference.class === kind).length.toString()]));
  return { evidenceSha256: digest({ integrityChecks: observed.integrityChecks, aggregateCounts,
    postValidationTableCounts: observed.postValidationTableCounts, reconciliationDeltas: observed.reconciliationDeltas,
    excluded: observed.excludedObjects, excludedSummary: observed.excludedSummary }), aggregateCounts, excludedCount: observed.excludedObjects.length.toString() };
}

