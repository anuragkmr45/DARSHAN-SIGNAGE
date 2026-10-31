import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { parseStrictJson } from './backup-broker-protocol';

export function parseCanonicalEd25519PublicKeyring(bytes: Uint8Array, label: string): ReadonlyMap<string, string> {
  const value = parseStrictJson(bytes, 1024 * 1024);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be one strict key-id to public-PEM object.`);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length < 1 || entries.length > 128) throw new Error(`${label} must contain between 1 and 128 public keys.`);
  const result = new Map<string, string>();
  for (const [keyId, pem] of entries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(keyId) || typeof pem !== 'string' || pem.includes('PRIVATE KEY')) {
      throw new Error(`${label} entries must be stable ids and public PEM only.`);
    }
    const key = createPublicKey(pem);
    const canonical = key.export({ type: 'spki', format: 'pem' }).toString();
    if (key.asymmetricKeyType !== 'ed25519' || canonical !== pem) throw new Error(`${label} entries must be canonical Ed25519 PUBLIC KEY SPKI PEM.`);
    result.set(keyId, pem);
  }
  return result;
}

export function canonicalKeyringObject(keyring: ReadonlyMap<string, string>): Record<string, string> {
  return Object.fromEntries([...keyring.entries()].sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right))));
}

export function parseCanonicalEd25519PrivateKey(bytes: Uint8Array, label: string): KeyObject {
  const text = Buffer.from(bytes).toString('utf8');
  if (!text.includes('BEGIN PRIVATE KEY') || text.includes('BEGIN PUBLIC KEY')) throw new Error(`${label} must be private PKCS8 PEM.`);
  const key = createPrivateKey(text);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`${label} must be an Ed25519 PRIVATE KEY PKCS8 PEM.`);
  return key;
}
