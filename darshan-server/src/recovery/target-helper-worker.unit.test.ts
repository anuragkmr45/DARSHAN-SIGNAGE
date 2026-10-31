import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createProductionTargetHelperGateway, readOneShotTargetFrame,
  runTargetHelperOneShot } from '../../scripts/recovery-target-helper-worker';
import { canonicalJson } from '../backups/backup-broker-protocol';
import { TargetHelperJournal } from './target-helper-journal';
import { encodeTargetHelperRequest, parseTargetHelperResponse, type TargetHelperRequest } from './target-helper-protocol';
import { RecoveryTargetHelperService, UnavailableRecoveryTargetEngine } from './target-helper-service';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

function request(operation: TargetHelperRequest['operation']): TargetHelperRequest {
  return { format: 'darshan-recovery-target-helper-v1', requestId: randomUUID(), operation,
    operationId: randomUUID(), siteId: 'site-a', hostInstallationId: randomUUID(),
    planSha256: '1'.repeat(64), targetSetId: '2'.repeat(64), generation: 1,
    targetSpecificationSha256: '3'.repeat(64), authorizationSha256: '4'.repeat(64),
    expectedHelperSequence: null };
}

describe('one-shot target-helper worker', () => {
  it('loads the actual protected production identity and rejects every fixed identity mismatch', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'target-worker-production-')); roots.push(root);
    const journal = join(root, 'journal'); await fs.mkdir(journal, { mode: 0o700 });
    const keyring = join(root, 'keys.json'); const identityPath = join(root, 'identity.json');
    const keys = generateKeyPairSync('ed25519'); const pem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    await fs.writeFile(keyring, canonicalJson({ authority: pem }), { mode: 0o600 });
    const identity = { format: 'darshan-recovery-target-helper-installation-v2', siteId: 'site-a',
      hostInstallationId: '00000000-0000-4000-8000-000000000001', hostPolicySha256: '1'.repeat(64),
      helperRoleSha256: '2'.repeat(64), engineProfileSha256: '3'.repeat(64), specificationRootSha256: '4'.repeat(64),
      evidenceRootSha256: '5'.repeat(64), allocationLedgerRootSha256: '6'.repeat(64),
      allocationControlRootSha256: '7'.repeat(64), activeRootSha256: '8'.repeat(64),
      quarantineRootSha256: '9'.repeat(64), poolRootSha256: 'a'.repeat(64),
      storageAuthorityIdentitySha256: 'b'.repeat(64), hostMode: 'SPLIT_HOST' };
    await fs.writeFile(identityPath, canonicalJson(identity), { mode: 0o600 });
    const names = ['DARSHAN_TARGET_HELPER_JOURNAL_ROOT', 'DARSHAN_TARGET_HELPER_KEYRING_FILE',
      'DARSHAN_TARGET_HELPER_IDENTITY_FILE', 'DARSHAN_TARGET_HELPER_INSTANCE_AUTHORITY_TOKEN',
      'DARSHAN_TARGET_HELPER_UID', 'DARSHAN_TARGET_HELPER_GID', 'DARSHAN_TARGET_HELPER_SITE_ID',
      'DARSHAN_TARGET_HELPER_INSTALLATION_ID', 'DARSHAN_TARGET_HELPER_POLICY_SHA256',
      'DARSHAN_TARGET_HELPER_ROLE_SHA256', 'DARSHAN_TARGET_HELPER_ENGINE_PROFILE_SHA256',
      'DARSHAN_TARGET_HELPER_SPECIFICATION_ROOT_SHA256', 'DARSHAN_TARGET_HELPER_EVIDENCE_ROOT_SHA256',
      'DARSHAN_TARGET_HELPER_ALLOCATION_LEDGER_ROOT_SHA256', 'DARSHAN_TARGET_HELPER_ALLOCATION_CONTROL_ROOT_SHA256',
      'DARSHAN_TARGET_HELPER_ACTIVE_ROOT_SHA256', 'DARSHAN_TARGET_HELPER_QUARANTINE_ROOT_SHA256',
      'DARSHAN_TARGET_HELPER_POOL_ROOT_SHA256', 'DARSHAN_TARGET_HELPER_STORAGE_AUTHORITY_SHA256',
      'DARSHAN_TARGET_HELPER_HOST_MODE'] as const;
    const prior = new Map(names.map((name) => [name, process.env[name]]));
    Object.assign(process.env, { DARSHAN_TARGET_HELPER_JOURNAL_ROOT: journal,
      DARSHAN_TARGET_HELPER_KEYRING_FILE: keyring, DARSHAN_TARGET_HELPER_IDENTITY_FILE: identityPath,
      DARSHAN_TARGET_HELPER_INSTANCE_AUTHORITY_TOKEN: 'a'.repeat(64), DARSHAN_TARGET_HELPER_UID: String(process.getuid()),
      DARSHAN_TARGET_HELPER_GID: String(process.getgid()), DARSHAN_TARGET_HELPER_SITE_ID: identity.siteId,
      DARSHAN_TARGET_HELPER_INSTALLATION_ID: identity.hostInstallationId,
      DARSHAN_TARGET_HELPER_POLICY_SHA256: identity.hostPolicySha256,
      DARSHAN_TARGET_HELPER_ROLE_SHA256: identity.helperRoleSha256,
      DARSHAN_TARGET_HELPER_ENGINE_PROFILE_SHA256: identity.engineProfileSha256,
      DARSHAN_TARGET_HELPER_SPECIFICATION_ROOT_SHA256: identity.specificationRootSha256,
      DARSHAN_TARGET_HELPER_EVIDENCE_ROOT_SHA256: identity.evidenceRootSha256,
      DARSHAN_TARGET_HELPER_ALLOCATION_LEDGER_ROOT_SHA256: identity.allocationLedgerRootSha256,
      DARSHAN_TARGET_HELPER_ALLOCATION_CONTROL_ROOT_SHA256: identity.allocationControlRootSha256,
      DARSHAN_TARGET_HELPER_ACTIVE_ROOT_SHA256: identity.activeRootSha256,
      DARSHAN_TARGET_HELPER_QUARANTINE_ROOT_SHA256: identity.quarantineRootSha256,
      DARSHAN_TARGET_HELPER_POOL_ROOT_SHA256: identity.poolRootSha256,
      DARSHAN_TARGET_HELPER_STORAGE_AUTHORITY_SHA256: identity.storageAuthorityIdentitySha256,
      DARSHAN_TARGET_HELPER_HOST_MODE: identity.hostMode });
    try {
      await expect(createProductionTargetHelperGateway()).resolves.toBeInstanceOf(Object);
      const mismatches = [
        ['DARSHAN_TARGET_HELPER_SITE_ID', 'foreign-site'],
        ['DARSHAN_TARGET_HELPER_INSTALLATION_ID', '00000000-0000-4000-8000-000000000002'],
        ['DARSHAN_TARGET_HELPER_POLICY_SHA256', '5'.repeat(64)],
        ['DARSHAN_TARGET_HELPER_ROLE_SHA256', '6'.repeat(64)],
        ['DARSHAN_TARGET_HELPER_ENGINE_PROFILE_SHA256', '7'.repeat(64)],
        ['DARSHAN_TARGET_HELPER_SPECIFICATION_ROOT_SHA256', '8'.repeat(64)],
        ['DARSHAN_TARGET_HELPER_EVIDENCE_ROOT_SHA256', '9'.repeat(64)],
        ['DARSHAN_TARGET_HELPER_STORAGE_AUTHORITY_SHA256', 'c'.repeat(64)],
        ['DARSHAN_TARGET_HELPER_HOST_MODE', 'SINGLE_HOST'],
      ] as const;
      for (const [name, value] of mismatches) {
        const exact = process.env[name]; process.env[name] = value;
        await expect(createProductionTargetHelperGateway()).rejects.toThrow(/differs from native authority/);
        process.env[name] = exact;
      }
      await fs.writeFile(identityPath, canonicalJson({ ...identity, format: 'foreign-format' }), { mode: 0o600 });
      await expect(createProductionTargetHelperGateway()).rejects.toBeDefined();
      await expect(fs.lstat(join(journal, 'target-sets'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      for (const name of names) { const value = prior.get(name); if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    }
  });

  it('requires native instance authority in production mode while historical fixtures remain compatible', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'target-worker-authority-')); roots.push(root);
    expect(() => new TargetHelperJournal({ root, requireInstanceAuthority: true })).toThrow(/native instance authority/);
    expect(() => new TargetHelperJournal({ root, instanceAuthorityToken: 'z'.repeat(64) })).toThrow(/token is invalid/);
    expect(() => new TargetHelperJournal({ root })).not.toThrow();
    expect(() => new TargetHelperJournal({ root, requireInstanceAuthority: true,
      instanceAuthorityToken: 'a'.repeat(64) })).not.toThrow();
  });

  it('reads exactly one newline-plus-EOF frame and enforces the first-byte incomplete deadline', async () => {
    const exact = new PassThrough(); exact.end('{"a":1}\n');
    await expect(readOneShotTargetFrame(exact, 100)).resolves.toEqual(Buffer.from('{"a":1}'));
    const multiple = new PassThrough(); multiple.end('{}\n{}\n');
    await expect(readOneShotTargetFrame(multiple, 100)).rejects.toThrow(/invalid frame/);
    const partial = new PassThrough(); partial.write('{');
    await expect(readOneShotTargetFrame(partial, 20)).rejects.toThrow(/incomplete frame/);
  });

  it('emits one bounded newline response and then closes output', async () => {
    const readable = new PassThrough(); const writable = new PassThrough(); const chunks: Buffer[] = [];
    writable.on('data', (chunk) => chunks.push(Buffer.from(chunk))); readable.end('{"request":true}\n');
    await runTargetHelperOneShot({ readable, writable, gateway: { handle: async () => Buffer.from('{"ok":true}') } });
    expect(Buffer.concat(chunks).toString()).toBe('{"ok":true}\n');
  });

  it('returns stable TARGET_NOT_INSTALLED before any production engine effect', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'target-worker-unavailable-')); roots.push(root);
    const service = new RecoveryTargetHelperService({ journal: new TargetHelperJournal({ root,
      requireInstanceAuthority: true, instanceAuthorityToken: 'a'.repeat(64) }),
    engine: new UnavailableRecoveryTargetEngine(), authorize: () => undefined });
    const inspect = parseTargetHelperResponse(await service.handle(encodeTargetHelperRequest(request('INSPECT'))));
    expect(inspect).toMatchObject({ ok: false, helperSequence: 0, state: 'ABSENT',
      error: { code: 'TARGET_NOT_INSTALLED' } });
    const prepare = parseTargetHelperResponse(await service.handle(encodeTargetHelperRequest(request('PREPARE'))));
    expect(prepare).toMatchObject({ ok: false, state: 'ABSENT', error: { code: 'TARGET_NOT_INSTALLED' } });
  });
});
