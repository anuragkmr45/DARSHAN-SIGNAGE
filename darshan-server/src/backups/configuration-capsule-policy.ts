import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from './backup-broker-protocol';
import { PRODUCTION_CAPSULE_CONTRACT_ID, REQUIRED_CAPSULE_ROLES } from './configuration-capsule-inventory';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const role = z.enum(['backend', 'data', 'cms', 'valkey', 'observability']);

export const capsulePolicySchema = z.object({
  version: z.literal(2), generation: z.string().min(1).max(160), site_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  repository_id: z.string().uuid(), created_at: z.string().datetime({ offset: true }), capsule_sha256: sha256,
  capsule_size_bytes: z.string().regex(/^[1-9][0-9]*$/),
  release_generation: z.string().min(1).max(160),
  deployment_generation: z.string().min(1).max(160),
  compatibility_generation: z.number().int().positive().safe(),
  age_recipient_key_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  contract_id: z.literal(PRODUCTION_CAPSULE_CONTRACT_ID),
  encrypted_inventory_sha256: sha256,
  required_roles: z.array(role).min(1).max(5),
}).strict();
export type ConfigurationCapsulePolicy = z.infer<typeof capsulePolicySchema>;

export const signedCapsulePolicySchema = z.object({
  policy: capsulePolicySchema,
  signature: z.object({ algorithm: z.literal('Ed25519'), key_id: z.string().min(1).max(128), value_base64: z.string().min(1).max(1024) }).strict(),
}).strict();
export type SignedConfigurationCapsulePolicy = z.infer<typeof signedCapsulePolicySchema>;

export function validateCapsulePolicy(value: unknown): ConfigurationCapsulePolicy {
  const policy = capsulePolicySchema.parse(value);
  if (BigInt(policy.capsule_size_bytes) > 16n * 1024n * 1024n) throw new Error('Encrypted configuration capsule exceeds the 16 MiB protocol bound.');
  if (policy.required_roles.length !== REQUIRED_CAPSULE_ROLES.length ||
      policy.required_roles.some((value, index) => value !== REQUIRED_CAPSULE_ROLES[index])) throw new Error('Capsule policy required_roles must be the exact production role set.');
  return policy;
}

export function validateCapsuleBytes(policy: ConfigurationCapsulePolicy, capsule: Uint8Array): void {
  if (capsule.byteLength.toString() !== policy.capsule_size_bytes) throw new Error('Encrypted capsule size does not match signed policy.');
  if (createHash('sha256').update(capsule).digest('hex') !== policy.capsule_sha256) throw new Error('Encrypted capsule digest does not match signed policy.');
}

export function signCapsulePolicy(input: { policy: ConfigurationCapsulePolicy; privateKeyPem: string; keyId: string }): SignedConfigurationCapsulePolicy {
  const policy = validateCapsulePolicy(input.policy);
  const signature = sign(null, canonicalJson(policy), createPrivateKey(input.privateKeyPem));
  return { policy, signature: { algorithm: 'Ed25519', key_id: input.keyId, value_base64: signature.toString('base64') } };
}

export function verifySignedCapsulePolicy(input: { document: unknown; trustedKeys: ReadonlyMap<string, string> }): SignedConfigurationCapsulePolicy {
  const document = signedCapsulePolicySchema.parse(input.document); validateCapsulePolicy(document.policy);
  const key = input.trustedKeys.get(document.signature.key_id);
  if (!key || !verify(null, canonicalJson(document.policy), createPublicKey(key), Buffer.from(document.signature.value_base64, 'base64'))) {
    throw new Error('Configuration capsule policy signature is not trusted.');
  }
  return document;
}

export function policySha256(document: SignedConfigurationCapsulePolicy): string {
  return createHash('sha256').update(canonicalJson(document)).digest('hex');
}

export function parseSignedCapsulePolicy(bytes: Uint8Array, trustedKeys: ReadonlyMap<string, string>): SignedConfigurationCapsulePolicy {
  return verifySignedCapsulePolicy({ document: parseStrictJson(bytes, 1024 * 1024), trustedKeys });
}
