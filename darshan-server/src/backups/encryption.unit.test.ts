import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  decryptFileWithAgeForRecovery,
  encryptFileWithAge,
  validateAgeX25519Recipient,
  validatePinnedAgeExecutable,
} from './encryption';

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
let directory: string;
let executablePath: string;
let executableSha256: string;

function polymod(values: number[]) {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let index = 0; index < 5; index++) if ((top >>> index) & 1) checksum ^= generators[index];
  }
  return checksum >>> 0;
}

function recipient() {
  const hrp = 'age';
  // 32 zero bytes are 52 zero-valued 5-bit groups (the final group is padded).
  const data = Array(52).fill(0) as number[];
  const expanded = [...hrp].map((value) => value.charCodeAt(0) >>> 5).concat(0, [...hrp].map((value) => value.charCodeAt(0) & 31));
  const mod = polymod([...expanded, ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, index) => (mod >>> (5 * (5 - index))) & 31);
  return `${hrp}1${[...data, ...checksum].map((value) => CHARSET[value]).join('')}`;
}

beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'darshan-age-'));
  executablePath = join(directory, 'age');
  await fs.writeFile(executablePath, `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv.includes('--version')) { process.stdout.write('age test-1.0\\n'); process.exit(0); }
const chunks = [];
process.stdin.on('data', chunk => chunks.push(chunk));
process.stdin.on('end', () => {
  const input = Buffer.concat(chunks);
  if (input.toString().startsWith('FAIL')) {
    process.stdout.write('partial');
    process.stderr.write('x'.repeat(100000));
    process.exit(7);
  }
  if (input.toString().startsWith('CAPACITY')) {
    process.stderr.write('write failed: No space left on device (ENOSPC)');
    process.exit(1);
  }
  if (input.toString().startsWith('HANG')) {
    setInterval(() => {}, 1000);
    return;
  }
  if (process.argv.includes('--decrypt')) {
    const identity = fs.readFileSync(process.argv[process.argv.indexOf('--identity') + 1], 'utf8').trim();
    if (identity !== 'correct identity' || !input.subarray(0, 8).equals(Buffer.from('FAKEAGE\\n'))) {
      process.stderr.write('no identity matched or file was tampered');
      process.exit(1);
    }
    process.stdout.write(input.subarray(8));
  } else {
    process.stdout.write('FAKEAGE\\n');
    process.stdout.write(input);
  }
});
`);
  await fs.chmod(executablePath, 0o700);
  executableSha256 = createHash('sha256').update(await fs.readFile(executablePath)).digest('hex');
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

const pin = () => ({ executablePath, expectedExecutableSha256: executableSha256, expectedVersion: 'age test-1.0' });

describe('pinned native age wrapper', () => {
  it('validates canonical X25519 recipients and exact executable versions', async () => {
    expect(validateAgeX25519Recipient(recipient())).toBe(recipient());
    expect(() => validateAgeX25519Recipient(`${recipient().slice(0, -1)}q`)).toThrowError(expect.objectContaining({ code: 'BACKUP_AGE_RECIPIENT_INVALID' }));
    await expect(validatePinnedAgeExecutable(pin())).resolves.toEqual({ executablePath, executableSha256, version: 'age test-1.0' });
    await expect(validatePinnedAgeExecutable({ ...pin(), expectedExecutableSha256: '0'.repeat(64) })).rejects.toMatchObject({ code: 'BACKUP_AGE_EXECUTABLE_INVALID' });
    await expect(validatePinnedAgeExecutable({ ...pin(), expectedVersion: 'age other' })).rejects.toMatchObject({ code: 'BACKUP_AGE_VERSION_MISMATCH' });
    await expect(validatePinnedAgeExecutable({ ...pin(), executablePath: 'age' })).rejects.toMatchObject({ code: 'BACKUP_AGE_EXECUTABLE_INVALID' });
  });

  it('round-trips content through private wx outputs using an operator/test identity', async () => {
    const plain = join(directory, 'plain.bin');
    const encrypted = join(directory, 'plain.bin.age');
    const recovered = join(directory, 'recovered.bin');
    const identityPath = join(directory, 'identity.txt');
    const content = Buffer.alloc(2 * 1024 * 1024 + 17, 0x5a);
    await fs.writeFile(plain, content);
    await fs.writeFile(identityPath, 'correct identity\n', { mode: 0o600 });
    await encryptFileWithAge({ ...pin(), inputPath: plain, outputPath: encrypted, recipient: recipient() });
    expect((await fs.stat(encrypted)).mode & 0o777).toBe(0o600);
    await expect(encryptFileWithAge({ ...pin(), inputPath: plain, outputPath: encrypted, recipient: recipient() })).rejects.toMatchObject({ code: 'BACKUP_OUTPUT_EXISTS' });
    await decryptFileWithAgeForRecovery({ ...pin(), inputPath: encrypted, outputPath: recovered, identityPath });
    expect(await fs.readFile(recovered)).toEqual(content);
  });

  it('bounds diagnostics and removes failed, timed-out, wrong-key, and tampered partial outputs', async () => {
    const failing = join(directory, 'failing');
    const partial = join(directory, 'partial.age');
    await fs.writeFile(failing, 'FAIL input');
    const failure = encryptFileWithAge({ ...pin(), inputPath: failing, outputPath: partial, recipient: recipient(), maxDiagnosticBytes: 32 });
    await expect(failure).rejects.toMatchObject({ code: 'BACKUP_ENCRYPTION_FAILED', details: { diagnosticsTruncated: true } });
    await expect(fs.stat(partial)).rejects.toMatchObject({ code: 'ENOENT' });

    const hanging = join(directory, 'hanging');
    const timedOut = join(directory, 'timeout.age');
    await fs.writeFile(hanging, 'HANG forever');
    await expect(encryptFileWithAge({ ...pin(), inputPath: hanging, outputPath: timedOut, recipient: recipient(), timeoutMs: 100 })).rejects.toMatchObject({ code: 'BACKUP_TIMEOUT' });
    await expect(fs.stat(timedOut)).rejects.toMatchObject({ code: 'ENOENT' });

    const tampered = join(directory, 'tampered.age');
    const output = join(directory, 'wrong-output');
    const identityPath = join(directory, 'identity.txt');
    await fs.writeFile(tampered, 'not age data');
    await fs.writeFile(identityPath, 'wrong identity\n', { mode: 0o600 });
    await expect(decryptFileWithAgeForRecovery({ ...pin(), inputPath: tampered, outputPath: output, identityPath })).rejects.toMatchObject({ code: 'BACKUP_DECRYPTION_FAILED' });
    await expect(fs.stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('classifies age ENOSPC diagnostics as a non-retryable capacity prerequisite', async () => {
    const plain = join(directory, 'capacity-input');
    const output = join(directory, 'capacity.age');
    await fs.writeFile(plain, 'CAPACITY exhausted');
    await expect(encryptFileWithAge({
      ...pin(), inputPath: plain, outputPath: output, recipient: recipient(),
    })).rejects.toMatchObject({
      code: 'BACKUP_CAPACITY_EXHAUSTED',
      failureClass: 'PREREQUISITE',
      retryDisposition: 'AFTER_PREREQUISITE_CHANGE',
      retryable: false,
    });
    await expect(fs.stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
