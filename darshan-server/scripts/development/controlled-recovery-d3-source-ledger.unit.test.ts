import { beforeAll, describe, expect, it } from 'vitest';
import { loadMigrationManifest, loadProductionBaseline, type MigrationManifestEntry } from '../../src/deployment/migration-manifest';
import { digest } from '../../src/recovery/controlled-docker/contracts';
import { verifyD3MigrationLedger } from './controlled-recovery-d3-source-seal';

let manifest: MigrationManifestEntry[]; let retainedShape: Record<string, unknown>[];
beforeAll(async () => { manifest = await loadMigrationManifest(); const baseline = new Set((await loadProductionBaseline(undefined, manifest)).migrationIds);
  retainedShape = manifest.map(({ id, checksum }) => ({ migration_id: id, checksum_sha256: checksum, release_id: 'release-03',
    applied_method: baseline.has(id) ? 'BASELINED' : 'APPLIED', execution_state: baseline.has(id) ? 'BASELINED' : 'SUCCEEDED', approval_ticket: null })); });

describe('D3 production migration method/execution-state comparison', () => {
  it('accepts the real release shape of 38 BASELINED/BASELINED and 21 APPLIED/SUCCEEDED without rewriting provenance', () => {
    expect(retainedShape).toHaveLength(59); expect(retainedShape.filter(({ applied_method }) => applied_method === 'BASELINED')).toHaveLength(38);
    expect(retainedShape.filter(({ applied_method }) => applied_method === 'APPLIED')).toHaveLength(21);
    const before = digest(retainedShape); expect(before).toBe('a93cdab2e0c5ffbfb89276866a11157cad9aacb0417433e246c835f2979e7ce2');
    const observed = verifyD3MigrationLedger(manifest, retainedShape); expect(observed.terminal).toBe('0057_controlled_recovery_report_projection.sql');
    expect(observed.ledger.filter(({ method, executionState }) => method === 'BASELINED' && executionState === 'BASELINED')).toHaveLength(38);
    expect(observed.ledger.filter(({ method, executionState }) => method === 'APPLIED' && executionState === 'SUCCEEDED')).toHaveLength(21);
    expect(digest(retainedShape)).toBe(before); expect(verifyD3MigrationLedger(manifest, structuredClone(retainedShape))).toEqual(observed);
  });
  const crossed: unknown[][] = [['BASELINED', 'SUCCEEDED'], ['APPLIED', 'BASELINED'], ['ADOPTED', 'ADOPTED'], ['ADOPTED', 'SUCCEEDED'], ['UNKNOWN', 'SUCCEEDED'], [null, 'BASELINED'], [42, 'SUCCEEDED']];
  const invalidStates = ['FAILED', 'RUNNING', 'PENDING', 'CANCELLED', 'ADOPTED', 'UNKNOWN', 'succeeded', '', null, undefined, 42];
  it.each([...crossed, ...['BASELINED', 'APPLIED'].flatMap((method) => invalidStates.map((state) => [method, state]))])('rejects method=%s execution_state=%s', (method, state) => {
    const rows = structuredClone(retainedShape); rows[0]!.applied_method = method; rows[0]!.execution_state = state;
    expect(() => verifyD3MigrationLedger(manifest, rows)).toThrowError(expect.objectContaining({ code: 'CONTROLLED_RECOVERY_D3_SCHEMA_MISMATCH' }));
  });
  it.each(['checksum', 'order', 'gap', 'duplicate', 'extra', 'id', 'release', 'approval', 'terminal'] as const)('still rejects %s mismatch when method/state pairs are legitimate', (kind) => {
    const rows = structuredClone(retainedShape); const entries = [...manifest]; expect(() => verifyD3MigrationLedger(entries, rows)).not.toThrow();
    if (kind === 'checksum') rows[0]!.checksum_sha256 = digest('foreign'); if (kind === 'order') [rows[0], rows[1]] = [rows[1]!, rows[0]!]; if (kind === 'gap') rows.splice(0, 1);
    if (kind === 'duplicate') rows[1] = { ...rows[0] }; if (kind === 'extra') rows.push({ ...rows[0] }); if (kind === 'id') rows[0]!.migration_id = '0000_foreign.sql';
    if (kind === 'release') rows[0]!.release_id = 'release-04'; if (kind === 'approval') rows[0]!.approval_ticket = 'foreign-adoption'; if (kind === 'terminal') entries[entries.length - 1] = { ...entries.at(-1)!, id: '0058_foreign.sql' };
    expect(() => verifyD3MigrationLedger(entries, rows)).toThrowError(expect.objectContaining({ code: 'CONTROLLED_RECOVERY_D3_SCHEMA_MISMATCH' }));
  });
});
