import { createHash } from 'crypto'
import { getDeviceStateStore, type DeviceStateStore } from './device-state-store'

export const RECOVERY_GENERATION_PROOF_PREFIX = 'DARSHAN_RECOVERY_GENERATION_PROOF_V1'

export interface PlayerRecoveryChallenge {
  challenge_id: string
  site_id: string
  recovery_generation: string
  screen_id: string
  certificate_id: string
  client_nonce: string
  server_challenge: string
  expires_at: string
}

export function buildPlayerRecoveryGenerationProofPayload(value: PlayerRecoveryChallenge): string {
  return [RECOVERY_GENERATION_PROOF_PREFIX, value.site_id, value.recovery_generation, value.screen_id,
    value.certificate_id, value.client_nonce, value.server_challenge, value.expires_at].join('\n')
}

export function recoveryGenerationReceiptSha256(payload: string, signatureBase64: string): string {
  return createHash('sha256').update(`${payload}\n${signatureBase64}`).digest('hex')
}

export async function persistAcceptedRecoveryGeneration(input: {
  generation: string
  receiptSha256: string
  store?: DeviceStateStore
}): Promise<void> {
  await (input.store ?? getDeviceStateStore()).acceptRecoveryGeneration({
    generation: input.generation,
    receiptSha256: input.receiptSha256,
  })
}

export function isRecoveryGenerationCurrent(incoming: string | null | undefined, current: string | undefined): boolean {
  if (!current) return incoming === null || incoming === undefined
  return incoming === current
}
