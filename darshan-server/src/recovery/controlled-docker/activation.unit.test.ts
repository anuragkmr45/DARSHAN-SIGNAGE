import { generateKeyPairSync } from 'node:crypto';
import { chmod, link, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson } from '../../backups/backup-broker-protocol';
import { runControlledDockerRecoveryCli } from '../../../scripts/controlled-docker-recovery';
import { CONTROLLED_RECOVERY_ACTIVATION_FORMAT, INSTALLED_CONTROLLED_RECOVERY_ACTIVATION,
  controlledRecoveryActivationAssets, controlledRecoveryActivationSchema, loadInstalledControlledRecoveryActivation, parseCanonicalControlledRecoveryActivation } from './activation';
import { sha256 } from './contracts';
import { ControlledRecoveryError } from './contracts';
import { verifyFixedInstalledAsset } from './fixed-assets';
import { loadRecoveryPublicKeyring } from '../operator-inputs';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function example(name: string) {
  return JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(
    new URL(`../../../../deploy/production/controlled-recovery/${name}`, import.meta.url), 'utf8')));
}

describe('Activation Packet A closed contract', () => {
  it('accepts only disabled or tiny-disposable release-03/0057 contracts and requires canonical bytes', async () => {
    const disabled = controlledRecoveryActivationSchema.parse(await example('activation.disabled.example.json'));
    const tiny = controlledRecoveryActivationSchema.parse(await example('activation.tiny-disposable.example.json'));
    expect(disabled).toMatchObject({ format: CONTROLLED_RECOVERY_ACTIVATION_FORMAT, enabled: false, activation_mode: 'DISABLED' });
    expect(tiny).toMatchObject({ enabled: true, activation_mode: 'TINY_DISPOSABLE_FIXTURE', release: { release_id: 'release-03' } });
    expect(parseCanonicalControlledRecoveryActivation(canonicalJson(disabled))).toEqual(disabled);
    expect(() => parseCanonicalControlledRecoveryActivation(Buffer.from(JSON.stringify(disabled)))).toThrowError(expect.objectContaining({ code: 'CONTROLLED_RECOVERY_ACTIVATION_INVALID' }));
    expect(() => controlledRecoveryActivationSchema.parse({ ...disabled, enabled: true })).toThrow();
  });

  it('has one fixed installed path and effect CLI admission fails before profile or adapter access', async () => {
    expect(INSTALLED_CONTROLLED_RECOVERY_ACTIVATION).toBe('/etc/darshan/controlled-recovery/activation.json');
    expect(loadInstalledControlledRecoveryActivation.length).toBe(0);
    const loadProfile = vi.fn(); const adapterAccess = vi.fn(); const output: string[] = [];
    const code = await runControlledDockerRecoveryCli(['prepare', '--operation-id', '00000000-0000-4000-8000-000000000001',
      '--backup-run-id', '00000000-0000-4000-8000-000000000002', '--manifest-sha256', 'a'.repeat(64), '--site-id', 'site-a',
      '--approved-release-id', 'release-03', '--recovery-key-file', '/run/keys/recovery.age'], {
      loadActivation: async () => { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_NOT_ACTIVATED', 'disabled'); },
      loadProfile, adapter: new Proxy({}, { get: () => adapterAccess }) as never,
      readReportAggregates: async () => ({ aggregates: {}, timingsMs: {} }),
    }, { stdout: vi.fn(), stderr: (value) => output.push(value) });
    expect(code).toBe(5); expect(loadProfile).not.toHaveBeenCalled(); expect(adapterAccess).not.toHaveBeenCalled();
    expect(output.join('')).not.toContain('/run/keys/recovery.age');
  });

  it('verifies fixed regular single-link asset identity and rejects a hard link', async () => {
    const root = await mkdtemp(join(tmpdir(), 'activation-assets-')); roots.push(root);
    const path = join(root, 'asset'); const other = join(root, 'asset-link'); const bytes = Buffer.from('fixed\n');
    await writeFile(path, bytes, { mode: 0o600 });
    const ownerUid = process.getuid?.() ?? 0; const ownerGid = process.getgid?.() ?? 0;
    await expect(verifyFixedInstalledAsset({ path, sha256: sha256(bytes), ownerUid, ownerGid, mode: 0o600, maximumBytes: 64 }))
      .resolves.toMatchObject({ size: '6' });
    await link(path, other);
    await expect(verifyFixedInstalledAsset({ path, sha256: sha256(bytes), ownerUid, ownerGid, mode: 0o600, maximumBytes: 64 }))
      .rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_ACTIVATION_ASSET_UNSAFE' });
  });

  it('uses one 0600 keyring ownership/mode contract in activation verification and installed composition', async () => {
    const tiny = controlledRecoveryActivationSchema.parse(await example('activation.tiny-disposable.example.json'));
    const keyringPaths = new Set([tiny.source.manifest_keyring.path, tiny.source.policy_keyring.path, tiny.report_authority.public_keyring.path]);
    expect(controlledRecoveryActivationAssets(tiny).filter(({ path }) => keyringPaths.has(path)).map(({ mode }) => mode)).toEqual([0o600, 0o600, 0o600]);
    const root = await mkdtemp(join(tmpdir(), 'activation-keyring-')); roots.push(root); await chmod(root, 0o700);
    const { publicKey } = generateKeyPairSync('ed25519'); const path = join(root, 'keys.json');
    await writeFile(path, canonicalJson({ enrolled: publicKey.export({ type: 'spki', format: 'pem' }).toString() }), { mode: 0o600 });
    const ownerUid = process.getuid?.() ?? 0; const ownerGid = process.getgid?.() ?? 0;
    await expect(verifyFixedInstalledAsset({ path, sha256: sha256(await import('node:fs/promises').then(({ readFile }) => readFile(path))), ownerUid, ownerGid, mode: 0o600, maximumBytes: 64 * 1024 })).resolves.toBeDefined();
    await expect(loadRecoveryPublicKeyring(path, { expectedUid: ownerUid, expectedGid: ownerGid })).resolves.toMatchObject({ keys: expect.any(Map) });
  });
});
