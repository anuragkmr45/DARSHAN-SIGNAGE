import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalRecoveryBytes, sha256RecoveryBytes } from './contracts';
import { loadRecoveryHoldDispositionReview } from './hold-disposition-review';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

async function writeReview(overrides: Record<string, unknown> = {}) {
  const root = await fs.mkdtemp(join(tmpdir(), 'recovery-review-')); roots.push(root); await fs.chmod(root, 0o700);
  const path = join(root, 'review.json');
  const review = { format: 'darshan-recovery-hold-disposition-review-v1', decisionId: randomUUID(), operationId: randomUUID(),
    action: 'RELEASE', closedAs: 'ABORTED_PRE_IMPORT', planSha256: 'a'.repeat(64), sourceDescriptorSha256: 'b'.repeat(64),
    expectedJournalSequence: 2, expectedHoldStatus: 'ACTIVE', reviewedAt: '2026-10-29T04:00:00.000Z',
    retainedReviewEvidenceSha256: 'c'.repeat(64), ...overrides };
  const bytes = canonicalRecoveryBytes(review); await fs.writeFile(path, bytes, { mode: 0o600 });
  return { path, bytes };
}

describe('protected recovery hold disposition review', () => {
  it('loads only exact canonical protected bytes and caller digest', async () => {
    const value = await writeReview();
    await expect(loadRecoveryHoldDispositionReview({ path: value.path, expectedSha256: sha256RecoveryBytes(value.bytes) }))
      .resolves.toMatchObject({ review: { action: 'RELEASE', closedAs: 'ABORTED_PRE_IMPORT', expectedHoldStatus: 'ACTIVE' } });
    await expect(loadRecoveryHoldDispositionReview({ path: value.path, expectedSha256: 'd'.repeat(64) }))
      .rejects.toMatchObject({ code: 'RECOVERY_REVIEW_CHANGED' });
  });

  it.each([
    { owner: 'forbidden' },
    { action: 'RELEASE', closedAs: 'ABANDONED' },
    { reviewedAt: '2026-10-29T04:00:00Z' },
  ])('rejects unknown, contradictory, and noncanonical review fields %#', async (override) => {
    const value = await writeReview(override);
    await expect(loadRecoveryHoldDispositionReview({ path: value.path, expectedSha256: sha256RecoveryBytes(value.bytes) }))
      .rejects.toMatchObject({ code: 'RECOVERY_REVIEW_INVALID' });
  });
});
