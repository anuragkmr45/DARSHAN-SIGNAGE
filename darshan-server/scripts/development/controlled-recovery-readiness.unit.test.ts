import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { runDevelopmentReadinessCli } from '../controlled-recovery-e2e-readiness';
import { digest } from '../../src/recovery/controlled-docker/contracts';
import { DEVELOPMENT_READINESS_ACTIVATION_PATH, developmentReadinessActivationSchema, loadDevelopmentReadinessActivation,
  observeDevelopmentReadiness, type DevelopmentFileStat, type DevelopmentReadinessActivation, type DevelopmentReadinessSystem } from './controlled-recovery-readiness';

async function activation(): Promise<DevelopmentReadinessActivation> {
  const value = developmentReadinessActivationSchema.parse(JSON.parse(await readFile(DEVELOPMENT_READINESS_ACTIVATION_PATH, 'utf8')));
  const socket = file('socket'); const daemon = { ID: 'daemon-d1', Name: 'development-host', Driver: 'overlay2', ServerVersion: '27.5.1', DockerRootDir: '/var/lib/docker', SecurityOptions: ['name=seccomp'] };
  value.docker.expected_socket_sha256 = digest(socket); value.docker.expected_server_version = daemon.ServerVersion; value.docker.expected_root_dir = daemon.DockerRootDir;
  value.docker.expected_daemon_sha256 = digest({ id: daemon.ID, name: daemon.Name, driver: daemon.Driver, serverVersion: daemon.ServerVersion, rootDir: daemon.DockerRootDir, securityOptions: daemon.SecurityOptions }); return value;
}
function file(kind: DevelopmentFileStat['kind'] = 'file', mode = 0o755): DevelopmentFileStat { return { kind, uid: 1000, gid: 1000, mode, dev: '1', ino: kind === 'socket' ? '2' : '3', size: '10' }; }
function system(value: DevelopmentReadinessActivation, overrides: Partial<DevelopmentReadinessSystem> = {}): DevelopmentReadinessSystem {
  const daemon = { ID: 'daemon-d1', Name: 'development-host', Driver: 'overlay2', ServerVersion: '27.5.1', DockerRootDir: '/var/lib/docker', SecurityOptions: ['name=seccomp'] };
  return { readText: async (path) => path === '/proc/meminfo' ? 'MemAvailable: 3145728 kB\nSwapTotal: 262144 kB\nSwapFree: 262144 kB\n' : 'some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n',
    fileStat: async (path) => path === value.docker.socket_path ? file('socket') : file(),
    fileSystemStat: async () => ({ availableBytes: '8589934592', availableInodes: '100000' }),
    inspectDockerContext: async () => Buffer.from(JSON.stringify([{ Name: value.docker.context, Endpoints: { docker: { Host: value.docker.endpoint, SkipTLSVerify: false } } }])),
    inspectDockerDaemon: async () => Buffer.from(JSON.stringify(daemon)),
    inspectDockerImages: async () => Buffer.from(JSON.stringify(value.docker.images.map((image) => ({ Id: image.image_id, RepoDigests: [image.repo_digest] })))),
    listRunningDockerContainers: async () => Buffer.alloc(0), ...overrides };
}

describe('Activation Packet D1 read-only development readiness', () => {
  it('loads only the fixed canonical development activation and keeps it out of production activation', async () => {
    expect(DEVELOPMENT_READINESS_ACTIVATION_PATH).toMatch(/\/deploy\/development\/controlled-recovery\/tiny-readiness\.activation\.json$/);
    expect(loadDevelopmentReadinessActivation.length).toBe(0); await expect(loadDevelopmentReadinessActivation()).resolves.toMatchObject({ mode: 'READ_ONLY_TINY_D1', non_production: true });
    const example = JSON.parse(await readFile(new URL('../../../deploy/development/controlled-recovery/tiny-readiness.example.json', import.meta.url), 'utf8'));
    expect(developmentReadinessActivationSchema.parse(example)).toMatchObject({ mode: 'READ_ONLY_TINY_D1', non_production: true });
    expect(DEVELOPMENT_READINESS_ACTIVATION_PATH).not.toContain('/deploy/production/');
    const productionCli = await readFile(new URL('../../tsconfig.production-cli.json', import.meta.url), 'utf8');
    expect(productionCli).not.toContain('controlled-recovery-e2e-readiness');
    const source = await readFile(new URL('./controlled-recovery-readiness.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/process\.kill|SIG(?:TERM|KILL)|container',\s*'(?:start|stop|rm)|\bcompose\b|\bssh\b/);
  });

  it('passes exact safe observations while preserving non-production and serial-peak gates', async () => {
    const value = await activation(); const report = await observeDevelopmentReadiness(value, system(value));
    expect(report).toMatchObject({ status: 'READY', codes: [], nonProduction: true, productionTopologySatisfied: false, splitHostSatisfied: false, rtoSatisfied: false,
      runAvailable: false, projectedSerialPeak: { stage: 'API_PLAYER_PEAK', bytes: '2181038080', hostReserveBytes: '536870912', requiredAvailableBytes: '2717908992' }, artifacts: { firefoxUntouched: true } });
  });

  it.each([
    ['RAM/reserve', (value: DevelopmentReadinessActivation) => system(value, { readText: async (path) => path === '/proc/meminfo' ? 'MemAvailable: 1 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n' : 'some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n' }), 'CONTROLLED_RECOVERY_D1_RAM_OR_RESERVE_INSUFFICIENT'],
    ['swap use', (value: DevelopmentReadinessActivation) => system(value, { readText: async (path) => path === '/proc/meminfo' ? 'MemAvailable: 3145728 kB\nSwapTotal: 4194304 kB\nSwapFree: 0 kB\n' : 'some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n' }), 'CONTROLLED_RECOVERY_D1_SWAP_USE_UNSAFE'],
    ['recent pressure', (value: DevelopmentReadinessActivation) => system(value, { readText: async (path) => path === '/proc/meminfo' ? 'MemAvailable: 3145728 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n' : 'some avg10=9.00 avg60=0.00 avg300=0.00 total=0\n' }), 'CONTROLLED_RECOVERY_D1_SWAP_PRESSURE_UNSAFE'],
    ['disk bytes/inodes', (value: DevelopmentReadinessActivation) => system(value, { fileSystemStat: async () => ({ availableBytes: '1', availableInodes: '1' }) }), 'CONTROLLED_RECOVERY_D1_WORKSPACE_BYTES_INSUFFICIENT'],
    ['changed image', (value: DevelopmentReadinessActivation) => system(value, { inspectDockerImages: async () => Buffer.from('[]') }), 'CONTROLLED_RECOVERY_D1_IMAGE_MISSING_OR_CHANGED'],
    ['foreign running workload', (value: DevelopmentReadinessActivation) => system(value, { listRunningDockerContainers: async () => Buffer.from('{"ID":"foreign"}\n') }), 'CONTROLLED_RECOVERY_D1_FOREIGN_RUNNING_WORKLOAD'],
    ['context mismatch', (value: DevelopmentReadinessActivation) => system(value, { inspectDockerContext: async () => Buffer.from(JSON.stringify([{ Name: 'foreign', Endpoints: { docker: { Host: 'unix:///var/run/docker.sock' } } }])) }), 'CONTROLLED_RECOVERY_D1_DOCKER_CONTEXT_CHANGED'],
    ['daemon mismatch', (value: DevelopmentReadinessActivation) => system(value, { inspectDockerDaemon: async () => Buffer.from(JSON.stringify({ ID: 'foreign', Name: 'foreign', Driver: 'other', ServerVersion: '1', DockerRootDir: '/foreign', SecurityOptions: [] })) }), 'CONTROLLED_RECOVERY_D1_DOCKER_DAEMON_CHANGED'],
    ['Firefox missing', (value: DevelopmentReadinessActivation) => system(value, { fileStat: async (path) => { if (path === value.firefox_executable) throw new Error('missing'); return path === value.docker.socket_path ? file('socket') : file(); } }), 'CONTROLLED_RECOVERY_D1_FIREFOX_MISSING'],
  ] as const)('reports exact %s failure without effects', async (_label, makeSystem, code) => {
    const value = await activation(); const report = await observeDevelopmentReadiness(value, makeSystem(value)); expect(report.status).toBe('NOT_READY'); expect(report.codes).toContain(code);
  });

  it('keeps run unavailable and emits a secret-free bounded report', async () => {
    const value = await activation(); const report = await observeDevelopmentReadiness(value, system(value)); const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(/\/home\/|postgres:|minio\/minio|valkey\/valkey|sha256:[a-f0-9]{64}|password|token|secret/i);
    const loadActivation = vi.fn().mockResolvedValue(value); const observe = vi.fn().mockResolvedValue(report); const output = { stdout: vi.fn(), stderr: vi.fn() };
    await expect(runDevelopmentReadinessCli(['report'], { loadActivation, observe }, output)).resolves.toBe(0); expect(output.stdout).toHaveBeenCalledOnce();
    loadActivation.mockClear(); await expect(runDevelopmentReadinessCli(['readiness', '--path', '/tmp/override'], { loadActivation, observe }, output)).resolves.toBe(3); expect(loadActivation).not.toHaveBeenCalled();
    loadActivation.mockClear(); await expect(runDevelopmentReadinessCli(['run'], { loadActivation, observe }, output)).resolves.toBe(5);
    expect(loadActivation).not.toHaveBeenCalled(); expect(output.stderr.mock.calls.at(-1)?.[0]).toContain('CONTROLLED_RECOVERY_D1_RUN_UNAVAILABLE');
  });
});
