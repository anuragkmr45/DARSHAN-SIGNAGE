import { digest } from '../../src/recovery/controlled-docker/contracts';
import { DurableD3AgeIdentity, type D3AgeReceipt, type VerifiedD3AgeIdentity } from './controlled-recovery-d3-age-identity';
import { deriveD3OperationAuthority, type D3OperationAuthority } from './controlled-recovery-d3-authority';
import { developmentD2ActivationSchema } from './controlled-recovery-d2';
import d2Json from '../../../deploy/development/controlled-recovery/tiny-e2e-d2.activation.json';
import type { D3BackupEvidence } from './controlled-recovery-d3-backup';
export const testD3Operation = deriveD3OperationAuthority(developmentD2ActivationSchema.parse(d2Json));
export const testAgeRecipient = 'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p';
export const testWrapperAuthority = { wrapperSourceSha256: digest('wrapper-source'), wrapperBinarySha256: digest('wrapper-binary'), buildBasePackageVersion: '0.5-r4' };
export const testWrapperLabels = { 'com.darshan.d3.wrapper-source-sha256': testWrapperAuthority.wrapperSourceSha256, 'com.darshan.d3.wrapper-umask': '0077', 'com.darshan.d3.wrapper-build-base-apk-version': '0.5-r4' };
export async function testD3Identity(configSha256 = digest('container-tools'), authority: D3OperationAuthority = testD3Operation): Promise<VerifiedD3AgeIdentity> {
  let receipt: D3AgeReceipt | null = null;
  return new DurableD3AgeIdentity(authority, { imageId: `sha256:${digest('tools')}`, configSha256 }, { ageKeygen: async () => undefined, ageRecipient: async () => ({ recipient: testAgeRecipient }) }, {
    prepare: async () => undefined, readReceipt: async () => receipt, keyExists: async () => true, createKey: async () => { throw new Error('unexpected generation'); },
    withRetainedKey: async (derive) => derive(), publishReceipt: async (value) => { receipt = value; },
  }).readOrCreate({ allowCreate: false, dependentAuthorityExists: false });
}
export function testD3BackupEvidence(identity: VerifiedD3AgeIdentity): D3BackupEvidence {
  return { operationId: identity.operationId, siteId: identity.siteId, repositoryId: identity.repositoryId, releaseId: 'release-03',
    runId: 'b3000000-0000-4000-8000-000000000001', sourceSealSha256: digest('content'), keyId: identity.keyId, recipientSha256: digest(identity.recipient), ageReceiptSha256: identity.receiptSha256,
    capsuleSha256: digest('capsule'), manifestSha256: digest('manifest'), encryptedArtifactSha256: digest('cipher'),
    artifacts: [{ kind: 'CONFIGURATION', relativePath: 'config.age', ciphertextSha256: digest('config'), bytes: '12' },
      { kind: 'DATABASE', relativePath: 'database.age', ciphertextSha256: digest('database'), bytes: '13' }, { kind: 'OBJECTS', relativePath: 'objects.age', ciphertextSha256: digest('objects'), bytes: '14' }] };
}
