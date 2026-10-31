import { chmod, link, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson } from '../../src/backups/backup-broker-protocol';
import { validateAgeX25519Recipient } from '../../src/backups/encryption';
import { digest } from '../../src/recovery/controlled-docker/contracts';
import { DurableD3AgeIdentity, d3AgeReceiptVersionPath } from './controlled-recovery-d3-age-identity';
import { loadDevelopmentD3Activation } from './controlled-recovery-d3-activation';
import { deriveD3OperationAuthority, type D3OperationAuthority } from './controlled-recovery-d3-authority';
import { d3FoundationProfileSchema, loadD3Foundation, loadD3FoundationProfile } from './controlled-recovery-d3-foundation';
import { DurableD3PublicationStore, validateD3Publication, type D3PublicationReceipt } from './controlled-recovery-d3-publication';
import { FixedD3Backup, requestFromD3Publication } from './controlled-recovery-d3-backup';
import { fixedD3BackendProductionEnv } from './controlled-recovery-d3-process';
import { developmentD2ActivationSchema } from './controlled-recovery-d2';
import { testAgeRecipient, testD3BackupEvidence, testD3Identity, testD3Operation } from './controlled-recovery-d3.test-support';
import d2Json from '../../../deploy/development/controlled-recovery/tiny-e2e-d2.activation.json';

const roots: string[] = []; afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'darshan-d3-foundation-')); roots.push(root);
  return { ...testD3Operation, root, evidenceRoot: `${root}/evidence`, keyPath: `${root}/keys/recovery.age`, recipientReceiptPath: `${root}/evidence/age-public.json` } as D3OperationAuthority; }
function age(authority: D3OperationAuthority, recipient = testAgeRecipient) {
  const tools = { ageKeygen: vi.fn(async () => { await writeFile(`${authority.root}/keys/pending/recovery.age`, 'FAKE PRIVATE KEY NEVER IN RECEIPT', { flag: 'wx', mode: 0o600 }); }),
    ageRecipient: vi.fn(async () => ({ recipient })) };
  return { tools, store: new DurableD3AgeIdentity(authority, { imageId: `sha256:${digest('tools')}`, configSha256: digest('container-tools') }, tools) };
}
const create = { allowCreate: true, dependentAuthorityExists: false };
const currentReceiptPath = (authority: D3OperationAuthority) => d3AgeReceiptVersionPath(authority, { imageId: `sha256:${digest('tools')}`, configSha256: digest('container-tools') });
function publication(evidence: ReturnType<typeof testD3BackupEvidence>): D3PublicationReceipt {
  const unsigned = { format: 'darshan-d3-publication-v2' as const, ...evidence, artifactInventorySha256: digest(evidence.artifacts) };
  return validateD3Publication({ ...unsigned, receiptSha256: digest(unsigned) });
}

describe('D3 real foundation and operation authority', () => {
  it('derives the D2 operation with a distinct repository and rejects roots/resource/UUID drift', () => {
    const d2 = developmentD2ActivationSchema.parse(d2Json); expect(deriveD3OperationAuthority(d2)).toEqual(testD3Operation); expect(d2.enabled).toBe(false);
    for (const delta of [{ operation_id: testD3Operation.repositoryId }, { work_root: `${d2.work_root}-foreign` }, { evidence_root: '/tmp/foreign' }]) expect(() => deriveD3OperationAuthority({ ...d2, ...delta })).toThrow();
    const changed = structuredClone(d2); changed.resources[0]!.name += '-foreign'; expect(() => deriveD3OperationAuthority(changed)).toThrow();
  });
  it('loads a real strict tiny runtime enrollment without example authority or host age', async () => {
    const profile = await loadD3FoundationProfile(); expect(JSON.stringify(profile)).not.toMatch(/\.example|registry\.invalid|\/usr\/bin\/age/);
    expect(profile.whole_run_enabled).toBe(false); expect(profile.docker.images.map(({ role }) => role)).toEqual(['postgres', 'minio', 'valkey', 'tools']);
    expect(() => d3FoundationProfileSchema.parse({ ...profile, extra: true })).toThrow();
    const changed = structuredClone(profile); changed.assets[0]!.sha256 = '0'.repeat(64); expect(() => d3FoundationProfileSchema.parse(changed)).toThrow();
    const activation = await loadDevelopmentD3Activation();
    if (activation.container_tools.enrolled) { const foundation = await loadD3Foundation(); expect(foundation).not.toHaveProperty('boundary'); expect(foundation.liveToolsImageVerified).toBe(false); expect(foundation.missingRequirements).toContain('separatePromotionAndWriteFreeze'); }
    else await expect(loadD3Foundation()).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_PROFILE_BINDING_CHANGED' });
  });
  it('requires a freshly verified key and the exact root for backend environment', async () => {
    const authority = { ageIdentity: await testD3Identity(), containerToolsConfigSha256: digest('container-tools'), brokerPolicySha256: digest('policy'), capsuleSha256: digest('capsule'), capsuleGeneration: 'd3-v1',
      repositoryDeviceId: '1', spoolDeviceId: '1', ownerUid: String(process.getuid!()), ownerGid: String(process.getgid!()) };
    expect(fixedD3BackendProductionEnv('api', testD3Operation.root, authority).BACKUP_ENCRYPTION_KEY_ID).toBe(authority.ageIdentity.keyId);
    expect(() => fixedD3BackendProductionEnv('api', `${testD3Operation.root}-foreign`, authority)).toThrow();
    expect(() => fixedD3BackendProductionEnv('api', testD3Operation.root, { ...authority, ageIdentity: { ...authority.ageIdentity } })).toThrow();
  });
});

describe('D3 durable retained age identity', () => {
  it('creates once, re-derives on restart, binds image/config and never publishes private bytes', async () => {
    const authority = await fixture(); const { store, tools } = age(authority); const first = await store.readOrCreate(create); const second = await store.readOrCreate(create);
    expect(second).toEqual(first); expect(tools.ageKeygen).toHaveBeenCalledTimes(1); expect(tools.ageRecipient).toHaveBeenCalledTimes(2);
    const bytes = await readFile(currentReceiptPath(authority)); expect(bytes.toString()).not.toMatch(/PRIVATE|AGE-SECRET/); expect(canonicalJson(first)).toEqual(bytes);
    await expect(new DurableD3AgeIdentity(authority, { imageId: `sha256:${digest('foreign')}`, configSha256: digest('container-tools') }, tools).readOrCreate({ ...create, dependentAuthorityExists: true })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_AGE_IDENTITY_INVALID' });
  });
  it('fails receipt-without-key and never silently regenerates', async () => {
    const authority = await fixture(); const { store, tools } = age(authority); await store.readOrCreate(create); await unlink(authority.keyPath);
    await expect(store.readOrCreate(create)).rejects.toThrow(); expect(tools.ageKeygen).toHaveBeenCalledTimes(1);
  });
  it('recovers key-without-receipt only before dependent authority and rejects a changed recipient', async () => {
    const authority = await fixture(); const { store, tools } = age(authority); await store.readOrCreate(create); await unlink(currentReceiptPath(authority));
    await expect(store.readOrCreate({ ...create, dependentAuthorityExists: true })).rejects.toThrow();
    await expect(store.readOrCreate({ ...create, allowCreate: false })).resolves.toBeDefined(); expect(tools.ageKeygen).toHaveBeenCalledTimes(1);
    await expect(age(authority, 'age1invalid').store.readOrCreate(create)).rejects.toThrow();
  });
  it.each(['symlink-key', 'mode-key', 'hardlink-key', 'symlink-receipt', 'mode-receipt', 'mode-directory'] as const)('rejects unsafe retained state: %s', async (fault) => {
    const authority = await fixture(); const { store } = age(authority); await store.readOrCreate(create);
    if (fault === 'symlink-key') { await unlink(authority.keyPath); await symlink('/etc/passwd', authority.keyPath); }
    if (fault === 'hardlink-key') await link(authority.keyPath, `${authority.root}/keys/other`);
    if (fault === 'mode-key') await chmod(authority.keyPath, 0o644);
    if (fault === 'symlink-receipt') { await unlink(currentReceiptPath(authority)); await symlink('/etc/passwd', currentReceiptPath(authority)); }
    if (fault === 'mode-receipt') await chmod(currentReceiptPath(authority), 0o644);
    if (fault === 'mode-directory') await chmod(`${authority.root}/keys`, 0o755);
    await expect(store.readOrCreate(create)).rejects.toThrow();
  });
  it('preserves a pending key after interrupted generation instead of overwriting it', async () => {
    const authority = await fixture(); await mkdir(`${authority.root}/keys`, { mode: 0o700 }); await mkdir(`${authority.root}/keys/pending`, { mode: 0o700 });
    await writeFile(`${authority.root}/keys/pending/recovery.age`, 'retained interrupted key', { mode: 0o600 }); const { store, tools } = age(authority);
    await expect(store.readOrCreate(create)).rejects.toThrow(); expect(tools.ageKeygen).not.toHaveBeenCalled();
  });
  it('recovers the exclusive key-link commit window without regenerating', async () => {
    const authority = await fixture(); const { store, tools } = age(authority); await store.readOrCreate(create); await unlink(currentReceiptPath(authority));
    await link(authority.keyPath, `${authority.root}/keys/pending/recovery.age`); await expect(store.readOrCreate(create)).resolves.toBeDefined(); expect(tools.ageKeygen).toHaveBeenCalledTimes(1);
  });
  it('keeps the same key and every immutable receipt when tools rotate before dependent authority', async () => {
    const authority = await fixture(); const { store, tools } = age(authority); const first = await store.readOrCreate(create); const firstBytes = await readFile(currentReceiptPath(authority)); const keyBytes = await readFile(authority.keyPath);
    const rotatedTools = { imageId: `sha256:${digest('new-image')}`, configSha256: digest('new-config') };
    const second = await new DurableD3AgeIdentity(authority, rotatedTools, tools).readOrCreate({ ...create, allowCreate: false });
    expect(second.recipient).toBe(first.recipient); expect(second.keyId).toBe(first.keyId); expect(second.toolsImageId).toBe(rotatedTools.imageId); expect(second.receiptSha256).not.toBe(first.receiptSha256);
    expect(await readFile(currentReceiptPath(authority))).toEqual(firstBytes); expect(await readFile(authority.keyPath)).toEqual(keyBytes); expect(await readFile(d3AgeReceiptVersionPath(authority, rotatedTools))).toEqual(canonicalJson(second)); expect(tools.ageKeygen).toHaveBeenCalledTimes(1);
  });
  it('requires explicit legacy import, preserves the legacy bytes, and refuses rotation with dependents', async () => {
    const authority = await fixture(); const { store, tools } = age(authority); const first = await store.readOrCreate(create); const legacy = canonicalJson(first);
    await writeFile(authority.recipientReceiptPath, legacy, { mode: 0o600 }); await unlink(currentReceiptPath(authority));
    const rotatedTools = { imageId: `sha256:${digest('new-image')}`, configSha256: digest('new-config') }; const rotated = new DurableD3AgeIdentity(authority, rotatedTools, tools);
    await expect(rotated.readOrCreate(create)).rejects.toThrow();
    await expect(rotated.readOrCreate({ ...create, allowLegacyReceiptImport: true, dependentAuthorityExists: true })).rejects.toThrow();
    const second = await rotated.readOrCreate({ ...create, allowLegacyReceiptImport: true }); expect(second.keyId).toBe(first.keyId);
    expect(await readFile(authority.recipientReceiptPath)).toEqual(legacy); expect(await readFile(currentReceiptPath(authority))).toEqual(legacy);
    await expect(rotated.readOrCreate({ ...create, allowLegacyReceiptImport: false, dependentAuthorityExists: true })).resolves.toEqual(second);
    expect(tools.ageKeygen).toHaveBeenCalledTimes(1);
  });
  it.each(['recipient', 'keyId', 'operationId', 'repositoryId'] as const)('rejects a conflicting prior %s even when the current version verifies', async (field) => {
    const authority = await fixture(); const { store, tools } = age(authority); const first = await store.readOrCreate(create);
    const otherTools = { imageId: `sha256:${digest('new-image')}`, configSha256: digest('new-config') }; await new DurableD3AgeIdentity(authority, otherTools, tools).readOrCreate(create);
    const otherRecipient = validateAgeX25519Recipient('age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq5cu47z');
    const changed = { ...first, [field]: field === 'recipient' ? otherRecipient : field === 'keyId' ? digest('foreign') : 'd2000000-0000-4000-8000-000000000099', ...(field === 'recipient' ? { keyId: digest(otherRecipient) } : {}) }; const unsigned: Record<string, unknown> = { ...changed }; delete unsigned.receiptSha256;
    await writeFile(currentReceiptPath(authority), canonicalJson({ ...changed, receiptSha256: digest(unsigned) }));
    await expect(new DurableD3AgeIdentity(authority, otherTools, tools).readOrCreate(create)).rejects.toThrow(); expect(tools.ageKeygen).toHaveBeenCalledTimes(1);
  });
});

describe('D3 durable publication index', () => {
  it('publishes canonical exact inventories and coalesces identical concurrent retries across store instances', async () => {
    const authority = await fixture(); const identity = await testD3Identity(undefined, authority); const value = publication(testD3BackupEvidence(identity));
    const a = new DurableD3PublicationStore(authority); const b = new DurableD3PublicationStore(authority); await expect(a.load(authority.operationId)).resolves.toBeNull();
    await Promise.all([a.persist(value), b.persist(value), a.persist(value)]); expect(await b.load(authority.operationId)).toEqual(value);
    const changed = publication({ ...testD3BackupEvidence(identity), manifestSha256: digest('different') }); await expect(b.persist(changed)).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_PUBLICATION_CONFLICT' });
  });
  it('ignores uncommitted temp bytes and accepts the exact committed index after restart', async () => {
    const authority = await fixture(); const value = publication(testD3BackupEvidence(await testD3Identity(undefined, authority))); const store = new DurableD3PublicationStore(authority);
    await mkdir(`${authority.evidenceRoot}/publications`, { recursive: true, mode: 0o700 }); await writeFile(`${authority.evidenceRoot}/publications/ignored.tmp`, 'partial', { mode: 0o600 });
    expect(await store.load(authority.operationId)).toBeNull(); await store.persist(value); expect(await new DurableD3PublicationStore(authority).load(authority.operationId)).toEqual(value);
  });
  it('recovers a crash after exclusive link but rejects an unrelated hardlink', async () => {
    const authority = await fixture(); const value = publication(testD3BackupEvidence(await testD3Identity(undefined, authority))); const store = new DurableD3PublicationStore(authority); await store.persist(value);
    const path = `${authority.evidenceRoot}/publications/${authority.operationId}.json`;
    await link(path, `${path}.12345678-1234-4123-8123-123456789abc.tmp`); expect(await new DurableD3PublicationStore(authority).load(authority.operationId)).toEqual(value);
    await link(path, `${authority.evidenceRoot}/publications/unrelated.json`); await expect(store.load(authority.operationId)).rejects.toThrow();
  });
  it.each(['malformed', 'noncanonical', 'symlink', 'mode', 'inventory', 'foreign'] as const)('rejects %s index state', async (fault) => {
    const authority = await fixture(); const value = publication(testD3BackupEvidence(await testD3Identity(undefined, authority))); const store = new DurableD3PublicationStore(authority); await store.persist(value);
    const path = `${authority.evidenceRoot}/publications/${authority.operationId}.json`;
    if (fault === 'malformed') await writeFile(path, '{');
    if (fault === 'noncanonical') await writeFile(path, JSON.stringify(value, null, 2));
    if (fault === 'symlink') { await unlink(path); await symlink('/etc/passwd', path); }
    if (fault === 'mode') await chmod(path, 0o644);
    if (fault === 'inventory') await writeFile(path, canonicalJson({ ...value, artifacts: value.artifacts.slice(1) }));
    if (fault === 'foreign') await writeFile(path, canonicalJson({ ...value, repositoryId: 'd3000000-0000-4000-8000-000000000099' }));
    await expect(store.load(authority.operationId)).rejects.toThrow();
  });
  it('reserves the broker identity, requires archive reverification on retry/reload and rejects forged key identity', async () => {
    const authority = await fixture(); const identity = await testD3Identity(undefined, authority); const evidence = testD3BackupEvidence(identity); const store = new DurableD3PublicationStore(authority);
    const reserveOperationBackup = vi.fn(async () => ({ runId: evidence.runId })); const runBrokeredV2Backup = vi.fn(async () => evidence); const verifier = { revalidate: vi.fn(async () => evidence) };
    const backup = new FixedD3Backup({ reserveOperationBackup, runBrokeredV2Backup }, store, authority, identity, verifier);
    const request = { operationId: authority.operationId, siteId: authority.siteId, releaseId: 'release-03' as const, sourceSealSha256: evidence.sourceSealSha256 };
    await backup.execute(request); await backup.execute(request); expect(reserveOperationBackup).toHaveBeenCalledTimes(1); expect(runBrokeredV2Backup).toHaveBeenCalledTimes(1);
    await expect(requestFromD3Publication({ ...request, authority, identity, verifier, store, recoveryKeyFile: authority.keyPath })).resolves.toMatchObject({ backupRunId: evidence.runId });
    verifier.revalidate.mockResolvedValue({ ...evidence, capsuleSha256: digest('tampered') });
    await expect(requestFromD3Publication({ ...request, authority, identity, verifier, store, recoveryKeyFile: authority.keyPath })).rejects.toThrow();
    await expect(new FixedD3Backup({ reserveOperationBackup, runBrokeredV2Backup }, store, authority, { ...identity }, verifier).execute(request)).rejects.toThrow();
  });
});
