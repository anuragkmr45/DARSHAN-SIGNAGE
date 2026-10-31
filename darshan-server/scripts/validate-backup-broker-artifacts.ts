import { createPrivateKey, createPublicKey } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, parse, resolve } from 'node:path';
import { parseStrictJson } from '../src/backups/backup-broker-protocol';
import { parseSignedCapsulePolicy, policySha256, validateCapsuleBytes } from '../src/backups/configuration-capsule-policy';
import { parseCanonicalEd25519PrivateKey, parseCanonicalEd25519PublicKeyring } from '../src/backups/ed25519-public-keyring';
import { PRODUCTION_CAPSULE_CONTRACT_ID, REQUIRED_CAPSULE_ROLES } from '../src/backups/configuration-capsule-inventory';

interface Input {
  capsuleFile: string;
  policyFile: string;
  policyTrustFile: string;
  manifestPrivateKeyFile: string;
  manifestPublicKeyringFile: string;
  releaseSigningPrivateKeyFile: string;
  manifestActiveKeyId: string;
  siteId: string;
  repositoryId: string;
  releaseGeneration: string;
  deploymentGeneration: string;
  compatibilityGeneration: number;
  ageRecipientKeyId: string;
}

function protectedInput(path: string, privateKey = false): void {
  const stat = lstatSync(path, { bigint: true });
  const mode = Number(stat.mode & 0o777n);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1n || stat.size < 1n || stat.size > 16n * 1024n * 1024n ||
      (privateKey ? mode !== 0o600 : (mode & 0o022) !== 0)) {
    throw new Error(`${path} is not a protected bounded single-link regular file.`);
  }
  let parent = dirname(path);
  for (;;) {
    const directory = lstatSync(parent, { bigint: true });
    const worldWritable = Number(directory.mode & 0o002n) !== 0;
    const protectedStickyRoot = worldWritable && Number(directory.uid) === 0 && Number(directory.mode & 0o1000n) !== 0;
    if (directory.isSymbolicLink() || !directory.isDirectory() || (worldWritable && !protectedStickyRoot)) {
      throw new Error(`${path} has an unsafe parent directory chain.`);
    }
    if (parent === parse(parent).root) break;
    parent = dirname(parent);
  }
}

const inputBytes = await new Promise<Buffer>((accept, reject) => {
  const chunks: Buffer[] = [];
  process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
  process.stdin.once('end', () => accept(Buffer.concat(chunks)));
  process.stdin.once('error', reject);
});
const input = parseStrictJson(inputBytes, 64 * 1024) as Input;
for (const name of ['capsuleFile', 'policyFile', 'policyTrustFile', 'manifestPrivateKeyFile', 'manifestPublicKeyringFile', 'releaseSigningPrivateKeyFile'] as const) {
  if (typeof input[name] !== 'string' || resolve(input[name]) !== input[name]) throw new Error(`${name} must be an absolute normalized path.`);
}
protectedInput(input.capsuleFile);
protectedInput(input.policyFile);
protectedInput(input.policyTrustFile);
protectedInput(input.manifestPublicKeyringFile);
protectedInput(input.manifestPrivateKeyFile, true);
protectedInput(input.releaseSigningPrivateKeyFile, true);
const trustedKeys = parseCanonicalEd25519PublicKeyring(readFileSync(input.policyTrustFile), 'Policy trust');
const signed = parseSignedCapsulePolicy(readFileSync(input.policyFile), trustedKeys);
if (signed.policy.contract_id !== PRODUCTION_CAPSULE_CONTRACT_ID || signed.policy.required_roles.join(',') !== REQUIRED_CAPSULE_ROLES.join(',')) {
  throw new Error('Signed capsule policy required_roles must be exactly backend, data, cms, valkey, and observability.');
}
const capsule = readFileSync(input.capsuleFile);
if (!capsule.subarray(0, 'age-encryption.org/v1\n'.length).equals(Buffer.from('age-encryption.org/v1\n'))) throw new Error('Encrypted capsule does not have the age v1 framing header.');
validateCapsuleBytes(signed.policy, capsule);
if (signed.policy.site_id !== input.siteId || signed.policy.repository_id !== input.repositoryId ||
    signed.policy.release_generation !== input.releaseGeneration || signed.policy.deployment_generation !== input.deploymentGeneration ||
    signed.policy.compatibility_generation !== input.compatibilityGeneration || signed.policy.age_recipient_key_id !== input.ageRecipientKeyId) {
  throw new Error('Signed capsule policy identity does not match the production bundle.');
}
const manifestKeyring = parseCanonicalEd25519PublicKeyring(readFileSync(input.manifestPublicKeyringFile), 'Manifest keyring');
const manifestPublic = manifestKeyring.get(input.manifestActiveKeyId);
if (!manifestPublic) throw new Error('Manifest active key is absent from the public keyring.');
const expectedManifestPublic = createPublicKey(parseCanonicalEd25519PrivateKey(readFileSync(input.manifestPrivateKeyFile), 'Manifest private key')).export({ type: 'spki', format: 'pem' }).toString();
if (createPublicKey(manifestPublic).export({ type: 'spki', format: 'pem' }).toString() !== expectedManifestPublic) {
  throw new Error('Manifest private key does not match the active public keyring entry.');
}
const policyPublic = trustedKeys.get(signed.signature.key_id);
const policyPublicPem = policyPublic && createPublicKey(policyPublic).export({ type: 'spki', format: 'pem' }).toString();
const releasePublicPem = createPublicKey(createPrivateKey(readFileSync(input.releaseSigningPrivateKeyFile))).export({ type: 'spki', format: 'pem' }).toString();
if (!policyPublicPem || new Set([policyPublicPem, expectedManifestPublic, releasePublicPem]).size !== 3) {
  throw new Error('Release, policy, and manifest signing authorities must be distinct.');
}
process.stdout.write(JSON.stringify({
  policySha256: policySha256(signed),
  capsuleGeneration: signed.policy.generation,
  capsuleSha256: signed.policy.capsule_sha256,
  capsuleSizeBytes: signed.policy.capsule_size_bytes,
}));
