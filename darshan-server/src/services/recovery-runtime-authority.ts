import { and, desc, eq } from 'drizzle-orm';
import { config } from '@/config';
import { getDatabase, schema } from '@/db';

export type RecoveryCertificateAdmission =
  | { active: false }
  | { active: true; generation: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' };

export function recoveryCertificateAdmissionFailure(
  admission: RecoveryCertificateAdmission,
  mode: 'http-signed' | 'http-legacy' | 'socket-signed' | 'socket-legacy',
): 'RECOVERY_PAIRING_REVIEW_REQUIRED' | null {
  if (!admission.active) return null;
  if (mode.endsWith('legacy')) return 'RECOVERY_PAIRING_REVIEW_REQUIRED';
  return admission.status === 'APPROVED' ? null : 'RECOVERY_PAIRING_REVIEW_REQUIRED';
}

export async function getActiveRecoveryGeneration(): Promise<string | null> {
  const db = getDatabase();
  const siteId = config.BACKUP_SITE_ID ?? 'local';
  const [authority] = await db.select({ generation: schema.siteRecoveryGenerations.generation })
    .from(schema.siteRecoveryGenerations)
    .where(eq(schema.siteRecoveryGenerations.site_id, siteId))
    .orderBy(desc(schema.siteRecoveryGenerations.updated_at))
    .limit(1);
  return authority?.generation ?? null;
}

/** Shared read-only quarantine projection. It never revokes device identity. */
export async function getRecoveryCertificateAdmission(input: {
  screenId: string;
  certificateId: string;
}): Promise<RecoveryCertificateAdmission> {
  const db = getDatabase();
  const generation = await getActiveRecoveryGeneration();
  if (!generation) return { active: false };
  const [review] = await db.select({ status: schema.recoveryPairingReviews.status })
    .from(schema.recoveryPairingReviews)
    .where(and(eq(schema.recoveryPairingReviews.generation, generation),
      eq(schema.recoveryPairingReviews.screen_id, input.screenId),
      eq(schema.recoveryPairingReviews.certificate_id, input.certificateId)))
    .limit(1);
  const status = review?.status === 'APPROVED' || review?.status === 'REJECTED' ? review.status : 'PENDING';
  return { active: true, generation, status };
}
