import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { runDevelopmentD2Cli } from '../controlled-recovery-e2e-run';
import { digest } from '../../src/recovery/controlled-docker/contracts';
import { PACKET_C_E2E_STAGES, type PacketCE2EStage } from '../../src/recovery/controlled-docker/controlled-recovery-e2e-harness';
import { DEVELOPMENT_READINESS_ACTIVATION_PATH, developmentReadinessActivationSchema, type DevelopmentFileStat, type DevelopmentReadinessSystem } from './controlled-recovery-readiness';
import { DEVELOPMENT_D2_ACTIVATION_PATH, DevelopmentD2HarnessBoundary, developmentD2ActivationSchema, loadDevelopmentD2Activation, loadDevelopmentD2Inputs,
  verifyDevelopmentD2Assets, type DevelopmentD2Journal, type DevelopmentD2StageDriver, type DevelopmentD2StageReceipt } from './controlled-recovery-d2';

type EffectStage = Exclude<PacketCE2EStage, 'READINESS'>;
const hash = (value = 'a') => value.repeat(64);
async function activations() { const d1 = developmentReadinessActivationSchema.parse(JSON.parse(await readFile(DEVELOPMENT_READINESS_ACTIVATION_PATH, 'utf8')));
  const d2 = developmentD2ActivationSchema.parse(JSON.parse(await readFile(DEVELOPMENT_D2_ACTIVATION_PATH, 'utf8'))); const socket = file('socket');
  const daemon = { ID: 'd2-daemon', Name: 'dev', Driver: 'overlay2', ServerVersion: d1.docker.expected_server_version, DockerRootDir: d1.docker.expected_root_dir, SecurityOptions: ['name=seccomp'] };
  d1.docker.expected_socket_sha256 = digest(socket); d1.docker.expected_daemon_sha256 = digest({ id: daemon.ID, name: daemon.Name, driver: daemon.Driver,
    serverVersion: daemon.ServerVersion, rootDir: daemon.DockerRootDir, securityOptions: daemon.SecurityOptions }); return { d1, d2, daemon }; }
function file(kind: DevelopmentFileStat['kind'] = 'file'): DevelopmentFileStat { return { kind, uid: 1000, gid: 1000, mode: 0o755, dev: '1', ino: kind === 'socket' ? '2' : '3', size: '1' }; }
function system(value: Awaited<ReturnType<typeof activations>>, lowMemory = false): DevelopmentReadinessSystem { return {
  readText: async (path) => path === '/proc/meminfo' ? `MemAvailable: ${lowMemory ? '1' : '4194304'} kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n` : 'some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n',
  fileStat: async (path) => path === value.d1.docker.socket_path ? file('socket') : file(), fileSystemStat: async () => ({ availableBytes: '9999999999', availableInodes: '999999' }),
  inspectDockerContext: async () => Buffer.from(JSON.stringify([{ Name: value.d1.docker.context, Endpoints: { docker: { Host: value.d1.docker.endpoint, SkipTLSVerify: false } } }])),
  inspectDockerDaemon: async () => Buffer.from(JSON.stringify(value.daemon)), inspectDockerImages: async () => Buffer.from(JSON.stringify(value.d1.docker.images.map((image) => ({ Id: image.image_id, RepoDigests: [image.repo_digest] })))),
  listRunningDockerContainers: async () => Buffer.alloc(0), }; }
function receipt(stage: EffectStage, cleanup = true): DevelopmentD2StageReceipt { return { stage, evidenceSha256: digest(stage),
  ...(stage === 'CLEANUP_EXACT_OWNED_RESOURCES' && cleanup ? { ownedResourceIdsSha256: hash('b') } : {}), sourceTargetBeforeSha256: hash(), sourceTargetAfterSha256: hash(),
  peakMemoryBytes: '1000', hostSwapUsedBytes: '0', durationMs: '1' }; }
class MemoryJournal implements DevelopmentD2Journal { values: DevelopmentD2StageReceipt[] = []; async completed() { return this.values; } async append(value: DevelopmentD2StageReceipt) { this.values.push(value); } }

describe('Activation Packet D2 static stage executor', () => {
  it('loads the exact disabled machine activation, verifies enrolled assets and fixed caps', async () => { const value = await loadDevelopmentD2Activation(); await expect(verifyDevelopmentD2Assets(value)).resolves.toBeUndefined();
    expect(value).toMatchObject({ enabled: false, non_production: true, docker: { public_ports: false }, dataset: { maximum_bytes: '33554432' }, retain_on_failure: true, cleanup_requires_evidence: true, firefox_untouched: true });
    expect(Object.fromEntries(value.resources.map(({ role, memory_bytes }) => [role, memory_bytes]))).toEqual({ postgres: '268435456', minio: '402653184', valkey: '100663296', api: '402653184', worker: '805306368', cms: '67108864', browser: '536870912', player: '805306368', controller: '201326592' });
    await expect(loadDevelopmentD2Inputs()).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D2_NOT_ACTIVATED' });
  });

  it('rechecks D1 readiness before every effect, enforces order, crashes once and resumes exact observed truth', async () => { const values = await activations(); const journal = new MemoryJournal();
    const attempts = new Map<EffectStage, number>(); const observed = new Map<EffectStage, DevelopmentD2StageReceipt>();
    const driver: DevelopmentD2StageDriver = { observe: async (stage) => observed.get(stage) ?? null, execute: async (stage) => { attempts.set(stage, (attempts.get(stage) ?? 0) + 1);
        if (stage === 'PREPARE_WITH_ONE_INTERRUPTION' && attempts.get(stage) === 1) throw new Error('controlled-interruption'); const value = receipt(stage); observed.set(stage, value); return value; } };
    const readinessSystem = system(values); const readSpy = vi.spyOn(readinessSystem, 'readText'); const boundary = new DevelopmentD2HarnessBoundary(values.d2, values.d1, readinessSystem, driver, journal);
    await expect(boundary.execute('API_VALIDATION')).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D2_STAGE_ORDER_INVALID' });
    for (const stage of ['SEED_REPRESENTATIVE_DATA', 'CREATE_ENCRYPTED_BACKUP', 'STOP_SOURCE_APPLICATION'] as EffectStage[]) await boundary.execute(stage);
    await expect(boundary.execute('PREPARE_WITH_ONE_INTERRUPTION')).rejects.toThrow('controlled-interruption'); await boundary.execute('PREPARE_WITH_ONE_INTERRUPTION');
    const before = attempts.get('PREPARE_WITH_ONE_INTERRUPTION'); await boundary.execute('PREPARE_WITH_ONE_INTERRUPTION'); expect(attempts.get('PREPARE_WITH_ONE_INTERRUPTION')).toBe(before);
    expect(readSpy.mock.calls.filter(([path]) => path === '/proc/meminfo').length).toBeGreaterThanOrEqual(7); expect(journal.values).toHaveLength(4);
  });

  it('fails pressure before effects, retains failure state, and requires exact cleanup ownership evidence', async () => { const values = await activations(); const execute = vi.fn(async (stage: EffectStage) => receipt(stage, false));
    const blocked = new DevelopmentD2HarnessBoundary(values.d2, values.d1, system(values, true), { observe: async () => null, execute }, new MemoryJournal());
    await expect(blocked.execute('SEED_REPRESENTATIVE_DATA')).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D2_READINESS_FAILED' }); expect(execute).not.toHaveBeenCalled();
    const journal = new MemoryJournal(); const boundary = new DevelopmentD2HarnessBoundary(values.d2, values.d1, system(values), { observe: async () => null, execute }, journal);
    for (const stage of PACKET_C_E2E_STAGES.slice(1, -1) as EffectStage[]) await boundary.execute(stage);
    await expect(boundary.execute('CLEANUP_EXACT_OWNED_RESOURCES')).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D2_CLEANUP_UNPROVEN' });
    expect(journal.values.some(({ stage }) => stage === 'CLEANUP_EXACT_OWNED_RESOURCES')).toBe(false);
  });

  it('keeps CLI confirmation exact and report secret-free', async () => { const loadBoundary = vi.fn(); const output = { stdout: vi.fn(), stderr: vi.fn() };
    await expect(runDevelopmentD2Cli(['run', '--confirm', 'wrong'], { loadBoundary }, output)).resolves.toBe(3); expect(loadBoundary).not.toHaveBeenCalled();
    loadBoundary.mockRejectedValueOnce(Object.assign(new Error('disabled'), { code: 'CONTROLLED_RECOVERY_D2_NOT_ACTIVATED' }));
    await expect(runDevelopmentD2Cli(['run', '--confirm', 'RUN_TINY_DISPOSABLE_PACKET_C'], { loadBoundary }, output)).resolves.toBe(5); expect(output.stdout).not.toHaveBeenCalled();
    const values = await activations(); const journal = new MemoryJournal(); const boundary = new DevelopmentD2HarnessBoundary(values.d2, values.d1, system(values), { observe: async () => null, execute: async (stage) => receipt(stage) }, journal);
    const report = await boundary.report(); expect(JSON.stringify(report)).not.toMatch(/\/home\/|password|token|secret|sha256:/i); expect(report.completedStages).toEqual([]);
  });
});
