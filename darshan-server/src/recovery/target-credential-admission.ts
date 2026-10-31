import { createPublicKey, verify } from 'node:crypto';
import { canonicalJson } from '../backups/backup-broker-protocol';
import { RecoveryError } from './errors';
import {
  credentialAdmissionV1Sha256, credentialProvisionScopeV1Sha256,
  credentialProvisionScopeWireV1Sha256, encodeCredentialProvisionScopeWireV1,
  parseCredentialAdmissionV1, parseCredentialProvisionJournalV1, parseCredentialProvisionScopeV1,
  type CredentialAdmissionV1, type CredentialProvisionScopeV1,
} from './target-credential-contracts';

export interface SignedCredentialPrepareAuthorizationV1 {
  readonly format: 'darshan-recovery-credential-prepare-authorization-v1';
  readonly scopeSemanticSha256: string;
  readonly scopeWireSha256: string;
  readonly keyId: string;
  readonly algorithm: 'Ed25519';
  readonly signatureBase64: string;
}

const SIGNATURE_DOMAIN = Buffer.from('darshan-recovery-credential-prepare-authorization-v1\0', 'utf8');

export function verifyCredentialPrepareAuthorizationV1(input: {
  scope: CredentialProvisionScopeV1; authorization: SignedCredentialPrepareAuthorizationV1;
  expectedKeyId: string; publicKeyPem: string; nowUnixMs: bigint;
}): void {
  try {
    const scope = parseCredentialProvisionScopeV1(canonicalJson(input.scope));
    const semantic = credentialProvisionScopeV1Sha256(scope);
    const wire = credentialProvisionScopeWireV1Sha256(encodeCredentialProvisionScopeWireV1(scope));
    const authorization = input.authorization; const signature = Buffer.from(authorization.signatureBase64, 'base64');
    if (authorization.format !== 'darshan-recovery-credential-prepare-authorization-v1' || authorization.algorithm !== 'Ed25519' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(authorization.keyId) || authorization.keyId !== input.expectedKeyId ||
        authorization.scopeSemanticSha256 !== semantic || authorization.scopeWireSha256 !== wire ||
        signature.byteLength !== 64 || signature.toString('base64') !== authorization.signatureBase64 ||
        input.publicKeyPem.length > 4096 || input.nowUnixMs < 0n || input.nowUnixMs >= BigInt(scope.deadlineUnixMs) ||
        !verify(null, Buffer.concat([SIGNATURE_DOMAIN, canonicalJson({
          format: authorization.format, scopeSemanticSha256: semantic, scopeWireSha256: wire,
          keyId: authorization.keyId, algorithm: authorization.algorithm,
        })]), createPublicKey(input.publicKeyPem), signature)) throw new Error('invalid authorization');
  } catch {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Credential PREPARE authorization is invalid, expired, or differently bound.');
  }
}

export interface CredentialAdmissionStore {
  scan(): Promise<readonly Uint8Array[]>;
  readAdmission(): Promise<Uint8Array | null>;
}

function same(value: string, expected: string, label: string): void {
  if (value !== expected) throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', `Credential ${label} binding differs.`);
}

export class TargetCredentialAdmissionVerifier {
  constructor(private readonly store: CredentialAdmissionStore) {}

  async readExactAdmission(scopeValue: CredentialProvisionScopeV1, prepareRequestSha256: string): Promise<CredentialAdmissionV1> {
    const scope = parseCredentialProvisionScopeV1(canonicalJson(scopeValue));
    if (!/^[a-f0-9]{64}$/.test(prepareRequestSha256)) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Credential PREPARE request digest is invalid.');
    }
    if (prepareRequestSha256 !== credentialProvisionScopeWireV1Sha256(scope)) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Credential PREPARE request digest differs from the exact executed scope wire.');
    }
    const entries = await this.store.scan();
    if (entries.length !== 3 || entries.some((entry) => entry.byteLength === 0 || entry.byteLength > 64 * 1024) ||
        entries.reduce((total, entry) => total + entry.byteLength, 0) > 192 * 1024) {
      throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Credential journal exceeds its exact record or byte bound.');
    }
    const records = entries.map(parseCredentialProvisionJournalV1);
    if (records.length !== 3 || records.map((record) => record.state).join(',') !== 'INTENT,FILES_DURABLE,ADMITTED') {
      throw new RecoveryError('RECOVERY_TARGET_EFFECT_INELIGIBLE', 'Credential provisioning is not durably admitted.');
    }
    let head = scope.previousJournalHeadSha256;
    records.forEach((record, index) => {
      if (record.sequence !== String(index + 1) || record.previousHeadSha256 !== head) {
        throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Credential journal is stale, gapped, or reordered.');
      }
      same(record.operationId, scope.operationId, 'operation'); same(record.generation, scope.generation, 'generation');
      same(record.targetHandle, scope.targetHandle, 'target');
      same(record.scopeSemanticSha256, credentialProvisionScopeV1Sha256(scope), 'semantic scope');
      same(record.scopeWireSha256, credentialProvisionScopeWireV1Sha256(scope), 'executed wire scope');
      same(record.authorizationSha256, scope.authorizationSha256, 'authorization');
      same(record.allocationIdentitySha256, scope.allocationIdentitySha256, 'allocation');
      same(record.allocationLedgerHeadSha256, scope.allocationLedgerHeadSha256, 'allocation ledger');
      same(record.credentialPolicySha256, scope.credentialPolicySha256, 'policy');
      same(record.authorityInstanceSha256, scope.authorityInstanceSha256, 'authority instance');
      head = record.recordSha256;
    });
    const intent = records[0]!; const durable = records[1]!; const admitted = records[2]!;
    if (durable.state !== 'FILES_DURABLE' || admitted.state !== 'ADMITTED' ||
        durable.intentRecordSha256 !== intent.recordSha256 || admitted.intentRecordSha256 !== intent.recordSha256 ||
        admitted.filesDurableRecordSha256 !== durable.recordSha256) {
      throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Credential journal transition references differ.');
    }
    durable.descriptors.forEach((descriptor, index) => {
      same(descriptor.authorityHandle, scope.roles[index]!.authorityHandle, `durable ${descriptor.role} handle`);
    });
    const bytes = await this.store.readAdmission();
    if (!bytes) throw new RecoveryError('RECOVERY_TARGET_EFFECT_INELIGIBLE', 'Credential admission receipt is absent.');
    const receipt = parseCredentialAdmissionV1(bytes);
    for (const [actual, expected, label] of [
      [receipt.operationId, scope.operationId, 'operation'], [receipt.generation, scope.generation, 'generation'],
      [receipt.targetHandle, scope.targetHandle, 'target'], [receipt.authorityHandle, scope.authorityHandle, 'authority'],
      [receipt.scopeSemanticSha256, credentialProvisionScopeV1Sha256(scope), 'semantic scope'],
      [receipt.scopeWireSha256, credentialProvisionScopeWireV1Sha256(scope), 'wire scope'],
      [receipt.intentRecordSha256, intent.recordSha256, 'intent'],
      [receipt.filesDurableRecordSha256, durable.recordSha256, 'files durable'],
      [receipt.requestSha256, prepareRequestSha256, 'request'], [receipt.authorizationSha256, scope.authorizationSha256, 'authorization'],
      [receipt.allocationIdentitySha256, scope.allocationIdentitySha256, 'allocation'],
      [receipt.allocationLedgerHeadSha256, scope.allocationLedgerHeadSha256, 'ledger'],
      [receipt.credentialPolicySha256, scope.credentialPolicySha256, 'policy'],
      [receipt.authorityInstanceSha256, scope.authorityInstanceSha256, 'authority instance'],
    ] as const) same(actual, expected, label);
    receipt.descriptors.forEach((descriptor, index) => {
      same(descriptor.authorityHandle, scope.roles[index]!.authorityHandle, `receipt ${descriptor.role} handle`);
    });
    if (!canonicalJson(receipt.descriptors).equals(canonicalJson(durable.descriptors))) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Credential receipt physical descriptors differ from FILES_DURABLE.');
    }
    if (admitted.admissionReceiptSha256 !== credentialAdmissionV1Sha256(receipt)) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Credential admission journal digest differs from exact receipt bytes.');
    }
    return Object.freeze(receipt);
  }
}

export function credentialAuthorizationMessage(input: Omit<SignedCredentialPrepareAuthorizationV1, 'signatureBase64'>): Buffer {
  return Buffer.concat([SIGNATURE_DOMAIN, canonicalJson(input)]);
}
