import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../backups/backup-broker-protocol';
import { parseBrokerJournalState } from '../backups/backup-broker-journal';
import { discoverRecoveryCandidates, findExactRecoveryPublication } from './discovery';

function publication(runId: string, repositoryId: string, digest: string) {
  return { site_id: 'site-a', repository_id: repositoryId, run_id: runId, attempt_id: randomUUID(), capture_id: randomUUID(),
    capture_generation: 1, policy_sha256: '1'.repeat(64), capsule_generation: 'g1', unsigned_manifest_sha256: '2'.repeat(64),
    signed_manifest_sha256: digest, key_id: 'key-1', signature_base64: 'YQ==', unsigned_manifest_base64: 'e30=',
    attempt_directory: null, status: 'COMMITTED' };
}
function state(publications: Record<string, ReturnType<typeof publication>>, extra: Record<string, unknown> = {}) {
  return parseBrokerJournalState(canonicalJson({ format: 'darshan-backup-broker-journal-v2', revision: 4, requests: {}, publications,
    holds: {}, deletions: {}, tombstones: {}, staging_cleanups: {}, ...extra }));
}

describe('recovery candidate discovery', () => {
  it('is deterministic, bounded, cursor-paginated, and never selects latest implicitly', () => {
    const repositoryId = randomUUID(); const runs = [randomUUID(), randomUUID(), randomUUID()].sort();
    const journal = state(Object.fromEntries(runs.map((run, index) => [run, publication(run, repositoryId, String(index + 1).repeat(64))])));
    const first = discoverRecoveryCandidates({ state: journal, siteId: 'site-a', repositoryId, limit: 2 });
    expect(first.candidates.map((item) => item.runId)).toEqual(runs.slice(0, 2)); expect(first.nextAfterRunId).toBe(runs[1]);
    const second = discoverRecoveryCandidates({ state: journal, siteId: 'site-a', repositoryId, limit: 2, afterRunId: first.nextAfterRunId! });
    expect(second.candidates.map((item) => item.runId)).toEqual([runs[2]]); expect(second.candidates[0].candidateOnly).toBe(true);
  });

  it('classifies tombstone/deletion conservatively and rejects them for exact planning', () => {
    const repositoryId = randomUUID(); const runId = randomUUID(); const digest = 'a'.repeat(64); const pub = publication(runId, repositoryId, digest);
    const tombstone = { site_id: 'site-a', repository_id: repositoryId, run_id: runId, attempt_id: pub.attempt_id,
      capture_id: pub.capture_id, capture_generation: 1, manifest_sha256: digest, operation_id: randomUUID(), disposition: 'INTENT',
      recorded_at: '2026-10-29T00:00:00.000Z', completed_at: null };
    const journal = state({ [runId]: pub }, { tombstones: { [runId]: tombstone } });
    expect(discoverRecoveryCandidates({ state: journal, siteId: 'site-a', repositoryId }).candidates[0].retentionState).toBe('TOMBSTONED');
    expect(() => findExactRecoveryPublication({ state: journal, siteId: 'site-a', repositoryId, runId, manifestSha256: digest }))
      .toThrowError(expect.objectContaining({ code: 'RECOVERY_SOURCE_TOMBSTONED' }));
  });

  it('rejects non-canonical and aliased journal maps before pagination or exact selection', () => {
    const repositoryId = randomUUID(); const runId = randomUUID(); const alias = randomUUID(); const digest = 'a'.repeat(64);
    const pub = publication(runId, repositoryId, digest); const document = { format: 'darshan-backup-broker-journal-v2', revision: 1,
      requests: {}, publications: { [alias]: pub }, holds: {}, deletions: {}, tombstones: {}, staging_cleanups: {} };
    expect(() => parseBrokerJournalState(Buffer.from(JSON.stringify(document))))
      .toThrowError(expect.objectContaining({ code: 'BROKER_JOURNAL_CORRUPT' }));
    expect(() => parseBrokerJournalState(canonicalJson(document)))
      .toThrowError(expect.objectContaining({ code: 'BROKER_JOURNAL_CORRUPT' }));
    const caseAliased = { ...document, publications: {
      [runId]: pub, [runId.toUpperCase()]: publication(runId.toUpperCase(), repositoryId, digest),
    } };
    expect(() => parseBrokerJournalState(canonicalJson(caseAliased)))
      .toThrowError(expect.objectContaining({ code: 'BROKER_JOURNAL_CORRUPT' }));
    const uppercaseSingleton = { ...document, publications: {
      [runId.toUpperCase()]: publication(runId.toUpperCase(), repositoryId, digest),
    } };
    expect(() => parseBrokerJournalState(canonicalJson(uppercaseSingleton))).toThrow();
    const valid = state({ [runId]: pub });
    const aliased = { ...valid, publications: { [alias]: pub } } as typeof valid;
    expect(() => discoverRecoveryCandidates({ state: aliased, siteId: 'site-a', repositoryId, limit: 1 }))
      .toThrowError(expect.objectContaining({ code: 'BROKER_JOURNAL_CORRUPT' }));
    expect(() => findExactRecoveryPublication({ state: aliased, siteId: 'site-a', repositoryId, runId, manifestSha256: digest }))
      .toThrowError(expect.objectContaining({ code: 'BROKER_JOURNAL_CORRUPT' }));
    const casePagination = { ...valid, publications: {
      [runId]: pub, [runId.toUpperCase()]: publication(runId.toUpperCase(), repositoryId, digest),
    } } as typeof valid;
    expect(() => discoverRecoveryCandidates({ state: casePagination, siteId: 'site-a', repositoryId, limit: 1 }))
      .toThrowError(expect.objectContaining({ code: 'BROKER_JOURNAL_CORRUPT' }));
  });

  it('rejects uppercase lifecycle references and map keys before they can bypass lowercase publication truth', () => {
    const repositoryId = randomUUID(); const runId = randomUUID(); const digest = 'b'.repeat(64); const pub = publication(runId, repositoryId, digest);
    const valid = state({ [runId]: pub }); const operationId = randomUUID(); const owner = randomUUID(); const fence = randomUUID();
    const identity = { site_id: 'site-a', repository_id: repositoryId, run_id: runId.toUpperCase(), attempt_id: pub.attempt_id,
      capture_id: pub.capture_id, capture_generation: 1, manifest_sha256: digest };
    const tombstone = { ...identity, operation_id: operationId, disposition: 'DELETED', recorded_at: '2026-10-29T00:00:00.000Z',
      completed_at: '2026-10-29T00:01:00.000Z' };
    const unsafeTombstone = { ...valid, tombstones: { [runId.toUpperCase()]: tombstone } } as typeof valid;
    expect(() => discoverRecoveryCandidates({ state: unsafeTombstone, siteId: 'site-a', repositoryId }))
      .toThrowError(expect.objectContaining({ code: 'BROKER_JOURNAL_CORRUPT' }));
    expect(() => findExactRecoveryPublication({ state: unsafeTombstone, siteId: 'site-a', repositoryId, runId, manifestSha256: digest }))
      .toThrowError(expect.objectContaining({ code: 'BROKER_JOURNAL_CORRUPT' }));

    const root = { format: 'darshan-backup-broker-journal-v2', revision: 1, requests: {}, publications: { [runId]: pub },
      tombstones: {}, staging_cleanups: {} };
    const hold = { ...identity, operation_id: operationId, owner_token: owner, fence_token: fence, status: 'ACTIVE',
      acquired_at: '2026-10-29T00:00:00.000Z', released_at: null, uncertain_at: null };
    const deletion = { ...identity, operation_id: operationId, owner_token: owner, fence_token: fence, status: 'DELETED',
      claimed_at: '2026-10-29T00:00:00.000Z', updated_at: '2026-10-29T00:01:00.000Z', namespace_renamed: true,
      entries: {}, last_error_code: null };
    expect(() => parseBrokerJournalState(canonicalJson({ ...root, holds: { [operationId]: hold }, deletions: {} }))).toThrow();
    expect(() => parseBrokerJournalState(canonicalJson({ ...root, holds: {}, deletions: { [operationId]: deletion } }))).toThrow();
    expect(() => parseBrokerJournalState(canonicalJson({ ...root, holds: { [operationId.toUpperCase()]: {
      ...hold, run_id: runId, operation_id: operationId.toUpperCase(),
    } }, deletions: {} }))).toThrow();
  });

  it.each([
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-aaaa-0aaa-8aaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-9aaa-8aaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-4aaa-7aaa-aaaaaaaaaaaa',
  ])('rejects non-RFC4122 broker UUID identity %s', (invalidRunId) => {
    const repositoryId = randomUUID(); const pub = publication(invalidRunId, repositoryId, 'c'.repeat(64));
    expect(() => parseBrokerJournalState(canonicalJson({ format: 'darshan-backup-broker-journal-v2', revision: 1,
      requests: {}, publications: { [invalidRunId]: pub }, holds: {}, deletions: {}, tombstones: {}, staging_cleanups: {} }))).toThrow();
  });
});
