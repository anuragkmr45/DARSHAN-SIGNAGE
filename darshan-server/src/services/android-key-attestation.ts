import { createPublicKey, timingSafeEqual, X509Certificate } from 'node:crypto';

const ANDROID_KEY_ATTESTATION_OID = '1.3.6.1.4.1.11129.2.1.17';

type DerNode = Readonly<{ tag: number; value: Buffer; children: readonly DerNode[] }>;
type AndroidKeyDescription = Readonly<{ attestationSecurityLevel: number; challenge: Buffer }>;

export type AndroidKeyAttestationVerification = Readonly<{
  /** A structurally valid chain is not trusted until its root is explicitly pinned. */
  trusted: boolean;
  rootFingerprint256: string;
  securityLevel: 'TRUSTED_ENVIRONMENT' | 'STRONGBOX';
  certificateSerials: readonly string[];
}>;

type RevocationEntries = Readonly<Record<string, Readonly<{ status: 'REVOKED' | 'SUSPENDED'; expires?: string }>>>;
let revocationCache: Readonly<{ entries: RevocationEntries; expiresAt: number }> | null = null;

/** Test-only cache reset; production callers cannot alter attestation state. */
export function resetAndroidAttestationRevocationCacheForTest() { revocationCache = null; }

/** Bounded, cache-controlled Google attestation CRL lookup. */
export async function assertAndroidAttestationNotRevoked(serials: readonly string[], options: Readonly<{ url: string; now?: () => number; fetchImpl?: typeof fetch }> ): Promise<void> {
  const now = options.now?.() ?? Date.now();
  if (!revocationCache || revocationCache.expiresAt <= now) {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 3_000);
    try {
      const response = await (options.fetchImpl ?? fetch)(options.url, { signal: abort.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`attestation revocation list request failed: ${response.status}`);
      const raw = await response.text();
      if (raw.length > 1_000_000) throw new Error('attestation revocation list is too large');
      const parsed = JSON.parse(raw) as { entries?: unknown };
      if (!parsed.entries || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) throw new Error('attestation revocation list is malformed');
      const entries: Record<string, { status: 'REVOKED' | 'SUSPENDED'; expires?: string }> = {};
      for (const [serial, value] of Object.entries(parsed.entries as Record<string, unknown>)) {
        if (!/^[a-f1-9][a-f0-9]*$/.test(serial) || !value || typeof value !== 'object') continue;
        const entry = value as { status?: unknown; expires?: unknown };
        if ((entry.status === 'REVOKED' || entry.status === 'SUSPENDED') && (entry.expires === undefined || typeof entry.expires === 'string')) entries[serial] = entry as { status: 'REVOKED' | 'SUSPENDED'; expires?: string };
      }
      const maxAge = Math.min(86_400_000, Math.max(60_000, Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] ?? 3_600) * 1_000));
      revocationCache = { entries, expiresAt: now + maxAge };
    } finally { clearTimeout(timeout); }
  }
  for (const serial of serials) if (revocationCache.entries[serial.toLowerCase()]) throw new Error('Android attestation certificate is revoked or suspended');
}

/**
 * Verifies the portions of Android Key Attestation that can be checked without
 * trusting the client: certificate linkage, server challenge binding, public
 * key identity and hardware security level. Trust anchors are deployment
 * configuration, not a client-provided certificate chain.
 */
export function verifyAndroidKeyAttestation(input: Readonly<{
  certificateChainPem: readonly string[];
  expectedChallenge: string;
  expectedPublicKeyPem: string;
  trustedRootFingerprints256: readonly string[];
}>): AndroidKeyAttestationVerification {
  if (input.certificateChainPem.length < 2 || input.certificateChainPem.length > 8) {
    throw new Error('Android key attestation must contain a bounded certificate chain');
  }
  const certificates = input.certificateChainPem.map((pem) => {
    if (typeof pem !== 'string' || pem.length > 16_384) throw new Error('Android key attestation certificate is invalid');
    try {
      return new X509Certificate(pem);
    } catch {
      throw new Error('Android key attestation certificate cannot be parsed');
    }
  });
  const expectedPublicKey = createPublicKey(input.expectedPublicKeyPem).export({ format: 'der', type: 'spki' }) as Buffer;
  const leafPublicKey = certificates[0]!.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  if (!sameBytes(expectedPublicKey, leafPublicKey)) throw new Error('Android attestation key does not match the enrollment public key');

  for (let index = 0; index < certificates.length - 1; index += 1) {
    const child = certificates[index]!;
    const issuer = certificates[index + 1]!;
    if (!child.checkIssued(issuer) || !child.verify(issuer.publicKey)) {
      throw new Error('Android key attestation certificate chain is invalid');
    }
  }
  const root = certificates.at(-1)!;
  if (!root.checkIssued(root) || !root.verify(root.publicKey)) {
    throw new Error('Android key attestation root is not self-signed');
  }

  const keyDescription = extractAndroidKeyDescription(certificates[0]!.raw);
  const expectedChallenge = decodeBase64Url(input.expectedChallenge);
  if (!sameBytes(keyDescription.challenge, expectedChallenge)) {
    throw new Error('Android key attestation challenge does not match this enrollment');
  }
  const securityLevel = keyDescription.attestationSecurityLevel === 2
    ? 'STRONGBOX'
    : keyDescription.attestationSecurityLevel === 1
      ? 'TRUSTED_ENVIRONMENT'
      : null;
  if (!securityLevel) throw new Error('Android key attestation is not hardware-backed');

  const rootFingerprint256 = root.fingerprint256.replaceAll(':', '').toLowerCase();
  const trustedRoots = new Set(input.trustedRootFingerprints256.map(normalizeFingerprint).filter(Boolean));
  return { trusted: trustedRoots.has(rootFingerprint256), rootFingerprint256, securityLevel, certificateSerials: certificates.map((certificate) => certificate.serialNumber.toLowerCase()) };
}

export function parseTrustedAttestationRootFingerprints(value: string | undefined): string[] {
  return (value ?? '').split(',').map(normalizeFingerprint).filter(Boolean);
}

/** Exported for small, deterministic parser tests; the certificate verifier
 * above is the only production entry point. */
export function parseAndroidKeyDescriptionDer(value: Buffer): AndroidKeyDescription {
  const root = readDer(value, 0);
  if (root.next !== value.length || root.node.tag !== 0x30 || root.node.children.length < 5) {
    throw new Error('Android key attestation key description is malformed');
  }
  const securityLevel = integerValue(root.node.children[1]!, 0x0a);
  const challenge = root.node.children[4]!;
  if (challenge.tag !== 0x04 || challenge.value.length < 16 || challenge.value.length > 512) {
    throw new Error('Android key attestation challenge is malformed');
  }
  return { attestationSecurityLevel: securityLevel, challenge: Buffer.from(challenge.value) };
}

function extractAndroidKeyDescription(certificateDer: Buffer): AndroidKeyDescription {
  const root = readDer(certificateDer, 0);
  if (root.next !== certificateDer.length) throw new Error('Android attestation certificate DER is malformed');
  const extension = findExtension(root.node, ANDROID_KEY_ATTESTATION_OID);
  if (!extension) throw new Error('Android key attestation extension is missing');
  return parseAndroidKeyDescriptionDer(extension);
}

function findExtension(node: DerNode, oid: string): Buffer | null {
  if (node.tag === 0x30 && node.children.length >= 2 && node.children[0]!.tag === 0x06 && decodeOid(node.children[0]!.value) === oid) {
    const octet = [...node.children].reverse().find((child) => child.tag === 0x04);
    return octet ? Buffer.from(octet.value) : null;
  }
  for (const child of node.children) {
    const found = findExtension(child, oid);
    if (found) return found;
  }
  return null;
}

function readDer(input: Buffer, offset: number): Readonly<{ node: DerNode; next: number }> {
  if (offset >= input.length) throw new Error('DER value is truncated');
  const tag = input[offset]!;
  let cursor = offset + 1;
  if ((tag & 0x1f) === 0x1f) throw new Error('High-tag DER form is unsupported');
  if (cursor >= input.length) throw new Error('DER length is truncated');
  const firstLength = input[cursor++]!;
  let length: number;
  if ((firstLength & 0x80) === 0) {
    length = firstLength;
  } else {
    const count = firstLength & 0x7f;
    if (count === 0 || count > 4 || cursor + count > input.length) throw new Error('DER length is invalid');
    length = 0;
    for (let index = 0; index < count; index += 1) length = (length << 8) | input[cursor++]!;
    if (length < 128) throw new Error('DER length is non-canonical');
  }
  const end = cursor + length;
  if (end > input.length) throw new Error('DER value is truncated');
  const value = input.subarray(cursor, end);
  const children: DerNode[] = [];
  if ((tag & 0x20) !== 0) {
    let childOffset = 0;
    while (childOffset < value.length) {
      const child = readDer(value, childOffset);
      children.push(child.node);
      childOffset = child.next;
    }
    if (childOffset !== value.length) throw new Error('DER children are malformed');
  }
  return { node: { tag, value, children }, next: end };
}

function decodeOid(value: Buffer): string {
  if (!value.length) throw new Error('DER object identifier is malformed');
  const first = value[0]!;
  const parts = [Math.floor(first / 40), first % 40];
  let current = 0;
  for (let index = 1; index < value.length; index += 1) {
    const byte = value[index]!;
    current = (current << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      parts.push(current);
      current = 0;
    }
  }
  if (current !== 0 || (value.at(-1)! & 0x80) !== 0) throw new Error('DER object identifier is malformed');
  return parts.join('.');
}

function integerValue(node: DerNode, expectedTag: number): number {
  if (node.tag !== expectedTag || node.value.length < 1 || node.value.length > 4 || (node.value[0]! & 0x80) !== 0) {
    throw new Error('DER integer is malformed');
  }
  return [...node.value].reduce((total, byte) => (total << 8) | byte, 0);
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]{16,512}$/.test(value)) throw new Error('Expected Android attestation challenge is malformed');
  return Buffer.from(value, 'base64url');
}

function normalizeFingerprint(value: string): string {
  const normalized = value.replaceAll(':', '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : '';
}

function sameBytes(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}
