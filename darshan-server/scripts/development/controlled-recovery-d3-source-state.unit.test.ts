import { chmod, link, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/backups/backup-broker-protocol';
import { digest } from '../../src/recovery/controlled-docker/contracts';
import { D3_SOURCE_RESOURCE_NAMES, DurableD3SourceState, type D3SourceResource, type D3SourceResourceRole } from './controlled-recovery-d3-source-state';
import { D3_SOURCE_COMMANDS, D3_SOURCE_STAGES, d3SourceBackupProfileSchema } from './controlled-recovery-d3-source-profile';
import { parseD3SourceBackupCommand, loadInstalledD3SourceBackup } from './controlled-recovery-d3-source-backup';
import { sourceFixture, sourceProfile } from './controlled-recovery-d3-source.test-support';

const fixtures: Awaited<ReturnType<typeof sourceFixture>>[] = []; afterEach(async () => { await Promise.all(fixtures.splice(0).map((value) => value.cleanup())); });
async function fixture() { const value = await sourceFixture(); fixtures.push(value); return value; }
const inventory = (): D3SourceResource[] => Object.entries(D3_SOURCE_RESOURCE_NAMES).map(([key, name]) => { const role = key as D3SourceResourceRole; return { kind: role === 'network' ? 'network' : role.endsWith('-volume') ? 'volume' : 'container',
  role, name, id: digest(`id-${role}`), configurationSha256: digest(`config-${role}`), identitySha256: digest(`identity-${role}`), retired: role === 'postgres-init' }; });
async function retain(state: DurableD3SourceState) { for (const value of inventory()) { await state.reserveResource(value.role, value.configurationSha256); await state.recordCreated({ ...value, retired: false }); if (value.retired) await state.retireResource(value.role, digest('joined-and-absent')); } return (await state.resources()).resources; }

describe('D3 fixed source profile and command surface', () => {
  it('reserves only the five fixed commands and fixed eight-stage chain', async () => {
    expect(D3_SOURCE_COMMANDS.map((command) => parseD3SourceBackupCommand([command]))).toEqual(['prepare', 'capture', 'resume', 'status', 'stop']);
    for (const args of [[], ['prepare', '--endpoint=foreign'], ['capture', '/tmp/key'], ['sh'], ['status;id']]) expect(() => parseD3SourceBackupCommand(args)).toThrow();
    expect(D3_SOURCE_STAGES).toEqual(['LAYOUT_READY', 'SERVICES_READY', 'SCHEMA_READY', 'SEEDED_AND_SEALED', 'CAPSULE_READY', 'BACKUP_RESERVED', 'PUBLICATION_VERIFIED', 'SOURCE_STOPPED']);
    await expect(loadInstalledD3SourceBackup()).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_BACKUP_DEPENDENCIES_NOT_ENROLLED' });
  });
  it('pins protected paths, topology, TLS/auth, caps contract and a disabled source profile', () => {
    expect(sourceProfile).toMatchObject({ enabled: false, directory_mode: '0700', file_mode: '0600', network: { internal: true, subnet: '172.30.250.0/28' },
      postgres: { runtime_user: '70:70', password_encryption: 'scram-sha-256' }, minio: { browser: false, tls: true }, valkey: { plaintext_port: 0, acl_required: true, appendonly: true, maxmemory_bytes: '33554432' }, backup: { age_private_key_excluded: true } });
    for (const delta of [{ enabled: true }, { work_root: '/tmp/arbitrary' }, { commands: ['prepare', 'shell'] }, { network: { ...sourceProfile.network, internal: false } }, { extra: true }]) expect(() => d3SourceBackupProfileSchema.parse({ ...sourceProfile, ...delta })).toThrow();
  });
});

describe('D3 protected immutable source state', () => {
  it('publishes canonical stage/resource history and checks durable IDs before stages', async () => {
    const f = await fixture(); expect(await f.state.stages()).toEqual([]); const layout = await f.state.appendStage('LAYOUT_READY', digest('layout'), []);
    await expect(f.state.appendStage('SERVICES_READY', digest('services'), [])).rejects.toThrow(); const resources = await retain(f.state);
    const services = await f.state.appendStage('SERVICES_READY', digest('services'), resources); expect(services.previousReceiptSha256).toBe(layout.receiptSha256);
    expect((await new DurableD3SourceState(f.authority, f.state.profileSha256).stages()).map(({ stage }) => stage)).toEqual(['LAYOUT_READY', 'SERVICES_READY']);
    expect(await readFile(`${f.root}/source/state/stages/01-SERVICES_READY.json`)).toEqual(canonicalJson(services)); expect((await f.state.resources()).pendingRoles).toEqual([]);
  });
  it('makes identical concurrent publication idempotent and rejects a changed claim', async () => {
    const f = await fixture(); const other = new DurableD3SourceState(f.authority, f.state.profileSha256);
    await Promise.all([f.state.appendStage('LAYOUT_READY', digest('layout'), []), other.appendStage('LAYOUT_READY', digest('layout'), [])]);
    await expect(other.appendStage('LAYOUT_READY', digest('other'), [])).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_STATE_CONFLICT' });
  });
  it('preserves unresolved creation intents and refuses unbound created IDs or stage skipping', async () => {
    const f = await fixture(); const resource = inventory()[0]!;
    await expect(f.state.recordCreated(resource)).rejects.toThrow(); await f.state.reserveResource(resource.role, resource.configurationSha256);
    expect((await f.state.resources()).pendingRoles).toEqual(['network']); await expect(f.state.appendStage('SCHEMA_READY', digest('fake-ledger'), inventory())).rejects.toThrow();
    await f.state.recordCreated(resource); await expect(f.state.recordCreated({ ...resource, id: digest('foreign') })).rejects.toThrow();
  });
  it.each(['mode', 'symlink', 'foreign-operation', 'profile', 'digest', 'noncanonical'] as const)('rejects unsafe or foreign stage history: %s', async (fault) => {
    const f = await fixture(); const value = await f.state.appendStage('LAYOUT_READY', digest('layout'), []); const path = `${f.root}/source/state/stages/00-LAYOUT_READY.json`;
    if (fault === 'mode') await chmod(path, 0o644);
    if (fault === 'symlink') { await unlink(path); await symlink('/etc/passwd', path); }
    if (fault === 'foreign-operation') await writeFile(path, canonicalJson({ ...value, operationId: 'd2000000-0000-4000-8000-000000000099' }));
    if (fault === 'profile') await expect(new DurableD3SourceState(f.authority, digest('foreign-profile')).stages()).rejects.toThrow();
    if (fault === 'digest') await writeFile(path, canonicalJson({ ...value, evidenceSha256: digest('tampered') }));
    if (fault === 'noncanonical') await writeFile(path, JSON.stringify(value, null, 2));
    if (fault !== 'profile') await expect(f.state.stages()).rejects.toThrow();
  });
  it('recovers the exclusive-link crash window but refuses a chain gap and unknown stage file', async () => {
    const f = await fixture(); await f.state.appendStage('LAYOUT_READY', digest('layout'), []); const path = `${f.root}/source/state/stages/00-LAYOUT_READY.json`;
    await link(path, `${path}.12345678-1234-4123-8123-123456789abc.tmp`); expect((await f.state.stages()).length).toBe(1);
    const resources = await retain(f.state); await f.state.appendStage('SERVICES_READY', digest('services'), resources); await unlink(path); await expect(f.state.stages()).rejects.toThrow();
  });
  it('records a separate interruption stop without manufacturing the final successful stage', async () => {
    const f = await fixture(); await f.state.appendStage('LAYOUT_READY', digest('layout'), []); const resources = await retain(f.state); await f.state.appendStage('SERVICES_READY', digest('services'), resources);
    const stopped = await f.state.recordStopped(resources, digest('stopped')); expect(stopped.fromStage).toBe('SERVICES_READY'); expect((await f.state.stages()).at(-1)?.stage).toBe('SERVICES_READY');
    await expect(f.state.appendStage('SCHEMA_READY', digest('never'), resources)).rejects.toThrow(); await expect(f.state.recordStopped(resources, digest('different-stop'))).rejects.toThrow();
  });
  it('serializes effect commands across controller instances and never steals a live or stale command lock', async () => {
    const f = await fixture(); const other = new DurableD3SourceState(f.authority, f.state.profileSha256); let release!: () => void; let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; }); const pending = f.state.withCommandLock('prepare', async () => { started(); await new Promise<void>((resolve) => { release = resolve; }); }); await ready;
    expect(await other.commandInProgress()).toBe(true); await expect(other.withCommandLock('stop', async () => undefined)).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_COMMAND_BUSY' });
    release(); await pending; expect(await other.commandInProgress()).toBe(false);
  });
});
