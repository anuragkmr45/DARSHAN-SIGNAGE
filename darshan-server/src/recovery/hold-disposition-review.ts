import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { RecoveryError } from './errors';
import { readProtectedOperatorFile, type ProtectedOperatorReadHooks } from './operator-inputs';
import { assertCanonicalTimestamp, recoveryDigest, recoveryUuid, sha256RecoveryBytes } from './contracts';

export const RECOVERY_HOLD_DISPOSITION_REVIEW_FORMAT = 'darshan-recovery-hold-disposition-review-v1' as const;
const MAX_REVIEW_BYTES = 32 * 1024;
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z.object({
  format: z.literal(RECOVERY_HOLD_DISPOSITION_REVIEW_FORMAT),
  decisionId: uuid,
  operationId: uuid,
  action: z.enum(['RELEASE', 'MARK_UNCERTAIN']),
  closedAs: z.enum(['ABORTED_PRE_IMPORT', 'ABANDONED']),
  planSha256: digest,
  sourceDescriptorSha256: digest,
  expectedJournalSequence: z.number().int().nonnegative().safe(),
  expectedHoldStatus: z.enum(['ACTIVE', 'UNCERTAIN']),
  reviewedAt: z.string().datetime({ offset: false }),
  retainedReviewEvidenceSha256: digest,
}).strict().superRefine((value, context) => {
  if ((value.action === 'RELEASE') !== (value.closedAs === 'ABORTED_PRE_IMPORT')) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'action and closure do not match' });
  }
});

export type RecoveryHoldDispositionReview = z.infer<typeof schema>;

export async function loadRecoveryHoldDispositionReview(input: {
  path: string;
  expectedSha256: string;
  expectedUid?: number;
  expectedGid?: number;
  hooks?: ProtectedOperatorReadHooks;
  signal?: AbortSignal;
}): Promise<{ review: RecoveryHoldDispositionReview; reviewSha256: string }> {
  const expectedUid = input.expectedUid ?? process.getuid?.();
  const expectedGid = input.expectedGid ?? process.getgid?.();
  if (expectedUid === undefined || expectedGid === undefined) {
    throw new RecoveryError('RECOVERY_INPUT_UNSAFE', 'Review input ownership cannot be established on this platform.');
  }
  const expectedSha256 = recoveryDigest(input.expectedSha256, 'reviewSha256');
  const bytes = await readProtectedOperatorFile({ path: input.path, maximumBytes: MAX_REVIEW_BYTES,
    expectedUid, expectedGid, hooks: input.hooks, signal: input.signal });
  if (sha256RecoveryBytes(bytes) !== expectedSha256) {
    throw new RecoveryError('RECOVERY_REVIEW_CHANGED', 'Protected disposition review digest does not match.');
  }
  try {
    const review = schema.parse(parseStrictJson(bytes, MAX_REVIEW_BYTES));
    if (!canonicalJson(review).equals(bytes)) throw new Error('noncanonical review');
    recoveryUuid(review.decisionId, 'decisionId'); recoveryUuid(review.operationId, 'operationId');
    assertCanonicalTimestamp(review.reviewedAt, 'reviewedAt');
    return { review, reviewSha256: expectedSha256 };
  } catch (cause) {
    throw new RecoveryError('RECOVERY_REVIEW_INVALID', 'Disposition review is not strict canonical approved evidence.', { cause });
  }
}
