import { describe, expect, it } from 'vitest';
import { assertAndroidAttestationNotRevoked, parseAndroidKeyDescriptionDer, parseTrustedAttestationRootFingerprints, resetAndroidAttestationRevocationCacheForTest } from './android-key-attestation';

function length(value: number): number[] {
  return value < 128 ? [value] : [0x81, value];
}

function keyDescription(securityLevel: number, challenge: Buffer): Buffer {
  const integer = (tag: number, value: number) => Buffer.from([tag, 1, value]);
  const body = Buffer.concat([
    integer(0x02, 1), integer(0x0a, securityLevel), integer(0x02, 4), integer(0x0a, 1),
    Buffer.from([0x04, ...length(challenge.length)]), challenge,
    Buffer.from([0x04, 0]), Buffer.from([0x30, 0]), Buffer.from([0x30, 0]),
  ]);
  return Buffer.from([0x30, ...length(body.length), ...body]);
}

describe('Android Key Attestation parser', () => {
  it('extracts a challenge and TEE security level from the Android key description', () => {
    const challenge = Buffer.alloc(32, 7);
    expect(parseAndroidKeyDescriptionDer(keyDescription(1, challenge))).toEqual({ attestationSecurityLevel: 1, challenge });
  });

  it('rejects malformed or too-short attestation challenges', () => {
    expect(() => parseAndroidKeyDescriptionDer(keyDescription(1, Buffer.alloc(15)))).toThrow(/challenge/i);
    expect(() => parseAndroidKeyDescriptionDer(Buffer.from([0x30, 0]))).toThrow(/malformed/i);
  });

  it('normalizes only valid configured SHA-256 root fingerprints', () => {
    const fingerprint = 'AA'.repeat(32);
    expect(parseTrustedAttestationRootFingerprints(` ${fingerprint.slice(0, 32)}:${fingerprint.slice(32)}, invalid `)).toEqual([fingerprint.toLowerCase()]);
  });

  it('rejects listed serials and caches a valid bounded revocation response', async () => {
    resetAndroidAttestationRevocationCacheForTest();
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response(JSON.stringify({ entries: { deadbeef: { status: 'REVOKED' } } }), { headers: { 'cache-control': 'max-age=600' } });
    };
    await expect(assertAndroidAttestationNotRevoked(['deadbeef'], { url: 'https://example.test/status', fetchImpl })).rejects.toThrow(/revoked/i);
    await expect(assertAndroidAttestationNotRevoked(['cafe'], { url: 'https://example.test/status', fetchImpl })).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });
});
