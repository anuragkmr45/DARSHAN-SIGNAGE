import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../backups/backup-broker-protocol';
import { loadRecoveryOperatorConfig, loadRecoveryPublicKeyring } from './operator-inputs';
import { createProductionRecoveryTargetController } from './target-controller';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

async function privateRoot() { const root = await fs.mkdtemp(join(tmpdir(), 'recovery-input-')); roots.push(root); await fs.chmod(root, 0o700); return root; }
async function write(path: string, value: unknown) { await fs.writeFile(path, canonicalJson(value), { mode: 0o600 }); }

describe('protected recovery operator inputs', () => {
  it('accepts only canonical strict config and retained public Ed25519 keys', async () => {
    const root = await privateRoot(); const config = join(root, 'config.json');
    await write(config, { format: 'darshan-recovery-operator-config-v1', site_id: 'site-a', repository: {
      root: '/srv/darshan-backups', device_id: '42', owner_uid: 1000, owner_gid: 1000, repository_id: randomUUID(),
    }, trust: { policy_keyring_file: '/secure/policy.json', manifest_keyring_file: '/secure/manifest.json' },
    target: { target_id: 'darshan-server-release-01', release_id: 'release-01', migrations_directory: '/app/drizzle/migrations' } });
    expect((await loadRecoveryOperatorConfig(config)).site_id).toBe('site-a');
    const { publicKey } = generateKeyPairSync('ed25519'); const keyring = join(root, 'keys.json');
    await write(keyring, { 'key-1': publicKey.export({ type: 'spki', format: 'pem' }).toString() });
    expect((await loadRecoveryPublicKeyring(keyring)).keys.size).toBe(1);

    const v2 = join(root, 'config-v2.json');
    await write(v2, { format: 'darshan-recovery-operator-config-v2', site_id: 'site-a', repository: {
      root: '/srv/darshan-backups', device_id: '42', owner_uid: 1000, owner_gid: 1000, repository_id: randomUUID(),
    }, trust: { policy_keyring_file: '/secure/policy.json', manifest_keyring_file: '/secure/manifest.json' },
    target: { target_id: 'darshan-server-release-01', release_id: 'release-01', migrations_directory: '/app/drizzle/migrations' },
    broker: { socket_path: '/run/darshan/backup-broker.sock', helper_version: 'release-01', policy_sha256: 'a'.repeat(64), control_timeout_ms: 60_000 },
    journal: { root: '/var/lib/darshan/recovery' } });
    expect(await loadRecoveryOperatorConfig(v2)).toMatchObject({ format: 'darshan-recovery-operator-config-v2',
      broker: { socket_path: '/run/darshan/backup-broker.sock' }, journal: { root: '/var/lib/darshan/recovery' } });

    const v3 = join(root, 'config-v3.json');
    await write(v3, { ...(await loadRecoveryOperatorConfig(v2)), format: 'darshan-recovery-operator-config-v3',
      target_gateway: { relay_socket_path: '/run/darshan-recovery/target-relay.sock',
        specification_root: '/var/lib/darshan/recovery-target-specifications',
        authorization_root: '/var/lib/darshan/recovery-target-authorizations',
        authorization_keyring_file: '/etc/darshan/recovery-target-authority.json', action_deadline_ms: 120_000 } });
    const loadedV3 = await loadRecoveryOperatorConfig(v3);
    expect(loadedV3).toMatchObject({ format: 'darshan-recovery-operator-config-v3',
      target_gateway: { relay_socket_path: '/run/darshan-recovery/target-relay.sock', action_deadline_ms: 120_000 } });
    if (loadedV3.format !== 'darshan-recovery-operator-config-v3') throw new Error('expected config v3');
    expect(() => createProductionRecoveryTargetController(loadedV3)).toThrowError(expect.objectContaining({ code: 'RECOVERY_TARGET_UNSUPPORTED' }));
  });

  it('rejects duplicates, secret fields, unsafe modes, symlinks, hardlinks, swaps, and growth', async () => {
    const root = await privateRoot(); const path = join(root, 'config.json'); const base = { format: 'darshan-recovery-operator-config-v1', site_id: 'site-a', repository: {
      root: '/repo', device_id: '1', owner_uid: 1, owner_gid: 1, repository_id: randomUUID(), },
    trust: { policy_keyring_file: '/policy', manifest_keyring_file: '/manifest' }, target: {
      target_id: 'darshan-server-release-01', release_id: 'release-01', migrations_directory: '/migrations' } };
    await fs.writeFile(path, Buffer.from('{"format":"darshan-recovery-operator-config-v1","format":"darshan-recovery-operator-config-v1"}'), { mode: 0o600 });
    await expect(loadRecoveryOperatorConfig(path)).rejects.toMatchObject({ code: 'RECOVERY_INPUT_INVALID' });
    await write(path, { ...base, database_url: 'SECRET-CANARY' });
    await expect(loadRecoveryOperatorConfig(path)).rejects.toMatchObject({ code: 'RECOVERY_INPUT_INVALID' });
    await write(path, base); await fs.chmod(path, 0o640);
    await expect(loadRecoveryOperatorConfig(path)).rejects.toMatchObject({ code: 'RECOVERY_INPUT_UNSAFE' });
    await fs.chmod(path, 0o600); await fs.link(path, join(root, 'hardlink'));
    await expect(loadRecoveryOperatorConfig(path)).rejects.toMatchObject({ code: 'RECOVERY_INPUT_UNSAFE' });
    await fs.unlink(join(root, 'hardlink')); await fs.rename(path, `${path}.real`); await fs.symlink(`${path}.real`, path);
    await expect(loadRecoveryOperatorConfig(path)).rejects.toMatchObject({ code: 'RECOVERY_INPUT_UNSAFE' });
    await fs.unlink(path); await fs.rename(`${path}.real`, path);
    await expect(loadRecoveryOperatorConfig(path, { hooks: { afterOpen: async (opened) => {
      await fs.rename(opened, `${opened}.old`); await write(opened, base);
    } } })).rejects.toMatchObject({ code: 'RECOVERY_INPUT_UNSAFE' });
    await fs.rm(path); await fs.rename(`${path}.old`, path);
    await expect(loadRecoveryOperatorConfig(path, { hooks: { afterRead: async (opened) => { await fs.appendFile(opened, ' '); } } }))
      .rejects.toMatchObject({ code: 'RECOVERY_INPUT_UNSAFE' });
  });
});
