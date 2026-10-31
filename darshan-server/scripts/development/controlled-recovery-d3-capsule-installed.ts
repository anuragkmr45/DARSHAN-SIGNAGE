import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { ControlledRecoveryError, digest, sha256 } from '../../src/recovery/controlled-docker/contracts';
import type { ProtectedD3Capsule, D3CapsuleReceipt } from './controlled-recovery-d3-capsule';

const root = '/home/hexmon/Desktop/DARSHAN-SIGNAGE';
export const D3_CAPSULE_ACTIVATION_PATH = `${root}/deploy/development/controlled-recovery/tiny-d3.capsule-activation.json`;
export const D3_CAPSULE_ACCEPTED_REPORT_PATH = `${root}/qa-artifacts/evidence/controlled-recovery-d3-source-data-fresh-process-acceptance-2026-10-31.json`;
export const D3_CAPSULE_ACCEPTED_DATA = Object.freeze({ migrationFingerprint: 'bc4a594244220695f869fbaaeb2a9799d03c3668dd1c212b663d009aff3fc144',
  businessContentSha256: 'c51d8cee4990b29ad62bfaa088f0f8cbd40208db569faaf58f815bc0bcfeabba', physicalIdentitySha256: 'cd9f309f81b122a81462b0ac3ddaa84bf3eb91cc60445ddfa3fa9baa206c86a4', objects: 16, tables: 75 });
export const d3CapsuleActivationSchema = z.object({ format: z.literal('darshan-d3-capsule-activation-v1'), non_production: z.literal(true), enabled: z.boolean(),
  commands: z.tuple([z.literal('capsule'), z.literal('capsule-status')]), source_profile_sha256: z.literal('1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632'),
  data_profile_sha256: z.literal('33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b'), capsule_profile_sha256: z.literal('5ff0dcaf1c6c6f0c6588143bb1f24ec39f2a772efd360d72bc596e2232e5c1e7'),
  accepted_data_report_path: z.literal(D3_CAPSULE_ACCEPTED_REPORT_PATH), accepted_data_report_sha256: z.literal('176efc22b74ecdfd10634cea7b3f43c15c90e6da547d26ae65db8c130a499573'),
  source_intent_sha256: z.literal('79a4bbc72e5b43c7ed32d1f3065983a347f69b867bc5f70febdfa47ff4e90f46'), layout_sha256: z.literal('cf7bbf660449bb5fe791a6e663775dc415d5538c3ed208b46aecb0cdf87b5cff'),
  resources_sha256: z.literal('c8fdf00e766b1fe54282ee3bd71895667b73ea6b9e8ad7f947732d1b4d269936'), age_receipt_sha256: z.literal('a5e908b3fce787c33399e202449fcceff2ed8284cd56af690e278630d4ab76cf'),
  age_key_metadata_sha256: z.literal('9ce941b0a7fd4a4f561159b8de5b910f98554b215c7605ba012c95f45ff76527'),
  reservation_enabled: z.literal(false), broker_enabled: z.literal(false), capture_enabled: z.literal(false), whole_run_enabled: z.literal(false),
  status_verification: z.literal('AT_REST_SIGNED_ROUNDTRIP_RECEIPT'), status_decrypts: z.literal(false), timeout_ms: z.literal(300000),
}).strict();
export type D3CapsuleActivation = z.infer<typeof d3CapsuleActivationSchema>;
const failed = (code = 'CONTROLLED_RECOVERY_D3_CAPSULE_ACTIVATION_INVALID') => new ControlledRecoveryError(code, 'The separate capsule enrollment, accepted source identity or fixed command is unverified.');
export function assertD3CapsuleAcceptedData(value: Record<string, unknown>) {
  if (value.command !== 'data-status' || value.status !== 'VERIFIED' || value.writerRevoked !== true || value.capsuleEnabled !== false || value.captureEnabled !== false || value.wholeRunEnabled !== false || value.fixtureDerivativesAreConversionEvidence !== false || Object.entries(D3_CAPSULE_ACCEPTED_DATA).some(([key, expected]) => value[key] !== expected)) throw failed('CONTROLLED_RECOVERY_D3_CAPSULE_ACCEPTED_DATA_CHANGED');
}
export async function loadD3CapsuleActivation() {
  const read = async (path: string) => { const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { const stat = await file.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || stat.gid !== process.getgid?.() || (stat.mode & 0o002) || stat.size < 1 || stat.size > 16384 || await realpath(path) !== path) throw failed(); return await file.readFile(); } finally { await file.close(); } };
  try { const bytes = await read(D3_CAPSULE_ACTIVATION_PATH), activation = d3CapsuleActivationSchema.parse(parseStrictJson(bytes, 16384)); if (!canonicalJson(activation).equals(bytes)) throw failed();
    const reportBytes = await read(activation.accepted_data_report_path); if (sha256(reportBytes) !== activation.accepted_data_report_sha256) throw failed(); const report = parseStrictJson(reportBytes, 16384) as Record<string, unknown>; if (!canonicalJson(report).equals(reportBytes)) throw failed(); assertD3CapsuleAcceptedData(report); return { activation, sha256: sha256(bytes) };
  } catch { throw failed(); }
}
export interface D3InstalledCapsuleDependencies { activation: D3CapsuleActivation; activationSha256: string; capsuleProfileSha256: string;
  core: Pick<ProtectedD3Capsule, 'prepare' | 'status'>; assertInactive(): Promise<void>; assertPublishedStage(receipt: D3CapsuleReceipt): Promise<void>; admit(): Promise<void>; }
/** Installed status checks signed at-rest roundtrip evidence; it never invokes decrypt or acquires a mutation lease. */
export class FixedInstalledD3Capsule {
  constructor(private readonly d: D3InstalledCapsuleDependencies) {}
  async execute(command: 'capsule' | 'capsule-status', signal?: AbortSignal) {
    const abort = new AbortController(), cancel = () => abort.abort(), timer = setTimeout(cancel, 300000); signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    try { return await this.executeBounded(command, abort.signal); } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
  private async executeBounded(command: 'capsule' | 'capsule-status', signal: AbortSignal) {
    const d = this.d, activation = d3CapsuleActivationSchema.parse(d.activation); if (!activation.enabled) throw failed('CONTROLLED_RECOVERY_D3_CAPSULE_NOT_ADMITTED');
    if (!['capsule', 'capsule-status'].includes(command) || digest(activation) !== d.activationSha256 || d.capsuleProfileSha256 !== activation.capsule_profile_sha256 || signal?.aborted) throw failed();
    await d.assertInactive(); if (signal?.aborted) throw failed('CONTROLLED_RECOVERY_D3_CAPSULE_CANCELLED');
    let receipt: D3CapsuleReceipt;
    if (command === 'capsule') receipt = await d.core.prepare(signal);
    else { await d.admit(); receipt = await d.core.status(signal); await d.assertInactive(); await d.admit(); }
    if (signal.aborted || receipt.sourceProfileSha256 !== activation.source_profile_sha256 || receipt.dataProfileSha256 !== activation.data_profile_sha256 || receipt.capsuleProfileSha256 !== activation.capsule_profile_sha256 || receipt.sourceIntentSha256 !== activation.source_intent_sha256 || receipt.layoutSha256 !== activation.layout_sha256 || receipt.resourcesSha256 !== activation.resources_sha256 || receipt.ageReceiptSha256 !== activation.age_receipt_sha256) throw failed();
    await d.assertPublishedStage(receipt); await d.assertInactive();
    return { format: 'darshan-d3-installed-capsule-report-v1', command, status: 'VERIFIED', stage: 'CAPSULE_READY', capsuleReceiptSha256: receipt.receiptSha256, ciphertextSha256: receipt.ciphertextSha256, ciphertextBytes: receipt.ciphertextBytes,
      inventorySha256: receipt.inventorySha256, plaintextSha256: receipt.plaintextSha256, policySha256: receipt.policySha256, ageReceiptSha256: receipt.ageReceiptSha256, activationSha256: d.activationSha256,
      verification: command === 'capsule' ? 'DURABLE_ENCRYPT_DECRYPT_AND_SIGNED_READBACK_RECEIPT' : activation.status_verification, roundtripReceiptVerified: true, ...(command === 'capsule-status' ? { decryptionPerformed: false } : {}), backupWorkerAvailable: false,
      reservationEnabled: false, brokerEnabled: false, captureEnabled: false, wholeRunEnabled: false, nextAction: 'REVIEW_RESERVATION_BOUNDARY' };
  }
}
