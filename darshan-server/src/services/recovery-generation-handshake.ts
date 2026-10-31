import { createVerify, randomBytes, randomUUID, createHash } from 'node:crypto';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { config } from '@/config';
import { getDatabase, schema, type DbExecutor } from '@/db';
import { ControlledRecoveryError } from '@/recovery/controlled-docker/contracts';
import { recoveryGenerationProofPayload, type RecoveryGenerationChallenge } from '@/recovery/controlled-docker/packet2';
import { getActiveRecoveryGeneration } from './recovery-runtime-authority';

export function recoveryGenerationRequiresAuthorityReset(stored: string | null | undefined, accepted: string): boolean {
  return stored !== accepted;
}

export async function issueDeviceRecoveryGenerationChallenge(input: {
  screenId: string; certificateId: string; clientNonce: string; now?: Date;
}): Promise<RecoveryGenerationChallenge | null> {
  if (!/^[A-Za-z0-9_-]{22,172}$/.test(input.clientNonce)) throw new ControlledRecoveryError('RECOVERY_GENERATION_PROOF_INVALID', 'HELLO recovery nonce is invalid.');
  const generation = await getActiveRecoveryGeneration();
  if (!generation) return null;
  const now = input.now ?? new Date();
  const challenge: RecoveryGenerationChallenge = { id: randomUUID(), siteId: config.BACKUP_SITE_ID ?? 'local', generation,
    screenId: input.screenId, certificateId: input.certificateId, clientNonce: input.clientNonce,
    serverChallenge: randomBytes(32).toString('base64url'), expiresAt: new Date(now.getTime() + 60_000).toISOString(), consumedAt: null };
  const db = getDatabase();
  await db.insert(schema.recoveryGenerationChallenges).values({ id: challenge.id, generation, screen_id: input.screenId,
    certificate_id: input.certificateId, client_nonce: input.clientNonce, server_challenge: challenge.serverChallenge,
    expires_at: new Date(challenge.expiresAt), created_at: now });
  return challenge;
}

export async function acceptDeviceRecoveryGenerationProof(input: {
  challengeId: string; screenId: string; certificateId: string; signatureBase64: string; now?: Date;
}): Promise<{ generation: string; receiptSha256: string }> {
  const db = getDatabase(); const now = input.now ?? new Date(); const siteId = config.BACKUP_SITE_ID ?? 'local';
  return db.transaction(async (tx: DbExecutor) => {
    const [row] = await tx.select().from(schema.recoveryGenerationChallenges)
      .where(eq(schema.recoveryGenerationChallenges.id, input.challengeId)).limit(1);
    if (!row || row.screen_id !== input.screenId || row.certificate_id !== input.certificateId) throw new ControlledRecoveryError('RECOVERY_GENERATION_CHALLENGE_MISMATCH', 'Challenge identity differs.');
    if (row.consumed_at) throw new ControlledRecoveryError('RECOVERY_GENERATION_CHALLENGE_REPLAYED', 'Challenge was already consumed.');
    if (row.expires_at.getTime() <= now.getTime()) throw new ControlledRecoveryError('RECOVERY_GENERATION_CHALLENGE_EXPIRED', 'Challenge expired.');
    const [certificate] = await tx.select().from(schema.deviceCertificates)
      .where(and(eq(schema.deviceCertificates.id, input.certificateId), eq(schema.deviceCertificates.screen_id, input.screenId))).limit(1);
    if (!certificate?.public_key_pem || certificate.is_revoked || certificate.revoked_at) throw new ControlledRecoveryError('RECOVERY_GENERATION_PROOF_INVALID', 'Certificate cannot prove the recovery generation.');
    const challenge: RecoveryGenerationChallenge = { id: row.id, siteId, generation: row.generation, screenId: row.screen_id,
      certificateId: row.certificate_id, clientNonce: row.client_nonce, serverChallenge: row.server_challenge,
      expiresAt: row.expires_at.toISOString(), consumedAt: null };
    const payload = recoveryGenerationProofPayload(challenge); const verifier = createVerify('RSA-SHA256'); verifier.update(payload); verifier.end();
    if (!verifier.verify(certificate.public_key_pem, input.signatureBase64, 'base64')) throw new ControlledRecoveryError('RECOVERY_GENERATION_PROOF_INVALID', 'Generation proof signature is invalid.');
    const receiptSha256 = createHash('sha256').update(`${payload}\n${input.signatureBase64}`).digest('hex');
    const consumed = await tx.update(schema.recoveryGenerationChallenges).set({ consumed_at: now, receipt_sha256: receiptSha256 })
      .where(and(eq(schema.recoveryGenerationChallenges.id, row.id), isNull(schema.recoveryGenerationChallenges.consumed_at), gt(schema.recoveryGenerationChallenges.expires_at, now))).returning({ id: schema.recoveryGenerationChallenges.id });
    if (consumed.length !== 1) throw new ControlledRecoveryError('RECOVERY_GENERATION_CHALLENGE_REPLAYED', 'Concurrent challenge consumption lost.');
    const [authority] = await tx.select({ recoveryGeneration: schema.deviceDesiredState.recovery_generation })
      .from(schema.deviceDesiredState).where(eq(schema.deviceDesiredState.screen_id, input.screenId)).for('update');
    if (recoveryGenerationRequiresAuthorityReset(authority?.recoveryGeneration, row.generation)) {
      const nonterminal = ['PENDING', 'SENT', 'LEASED', 'PROCESSING'] as const;
      await tx.update(schema.deviceCommands).set({ status: 'CANCELLED', delivery_token: null, claimed_at: null, lease_expires_at: null,
        cancelled_at: now, completed_at: now, last_error: `RECOVERY_GENERATION_CHANGED:${row.generation}`, updated_at: now })
        .where(and(eq(schema.deviceCommands.screen_id, input.screenId), inArray(schema.deviceCommands.status, [...nonterminal]),
          sql`${schema.deviceCommands.recovery_generation} is distinct from ${row.generation}`));
      await tx.insert(schema.deviceDesiredState).values({ screen_id: input.screenId, recovery_generation: row.generation,
        command_version: 0, state_version: 1, last_changed_reason: 'RECOVERY_GENERATION_ACCEPTED', created_at: now, updated_at: now })
        .onConflictDoUpdate({ target: schema.deviceDesiredState.screen_id, set: { recovery_generation: row.generation,
          command_version: 0, state_version: 1, last_command_id: null, last_command_type: null,
          last_command_reason: null, last_changed_reason: 'RECOVERY_GENERATION_ACCEPTED', updated_at: now } });
    }
    return { generation: row.generation, receiptSha256 };
  });
}
