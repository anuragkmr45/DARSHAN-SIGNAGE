import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, statfs } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';

const sha = z.string().regex(/^[a-f0-9]{64}$/); const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
const absolute = z.string().startsWith('/').max(512); const safe = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
export const developmentReadinessActivationSchema = z.object({
  format: z.literal('darshan-controlled-recovery-development-readiness-v1'), mode: z.literal('READ_ONLY_TINY_D1'), non_production: z.literal(true),
  site_id: safe,
  artifacts: z.object({ server: absolute, cms: absolute, player: absolute }).strict(), firefox_executable: absolute,
  paths: z.object({ workspace: absolute, target: absolute }).strict(),
  resources: z.object({ host_reserve_bytes: decimal, required_workspace_bytes: decimal, required_workspace_inodes: decimal,
    required_target_bytes: decimal, required_target_inodes: decimal, maximum_swap_used_bytes: decimal,
    maximum_memory_pressure_avg10: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/), production_minimum_ram_bytes: decimal,
    serial_stage_peaks: z.array(z.object({ stage: safe, bytes: decimal }).strict()).min(1).max(32), }).strict(),
  docker: z.object({ executable: absolute, config_directory: absolute, context: safe, endpoint: z.literal('unix:///var/run/docker.sock'),
    socket_path: z.literal('/var/run/docker.sock'), expected_socket_sha256: sha, expected_daemon_sha256: sha,
    expected_server_version: safe, expected_root_dir: absolute,
    images: z.array(z.object({ role: z.enum(['postgres', 'minio', 'valkey']), reference: z.string().min(1).max(512), image_id: z.string().regex(/^sha256:[a-f0-9]{64}$/), repo_digest: z.string().regex(/^[^@\s]+@sha256:[a-f0-9]{64}$/) }).strict()).length(3),
  }).strict(),
}).strict();
export type DevelopmentReadinessActivation = z.infer<typeof developmentReadinessActivationSchema>;

export const DEVELOPMENT_READINESS_ACTIVATION_PATH = fileURLToPath(new URL('../../../deploy/development/controlled-recovery/tiny-readiness.activation.json', import.meta.url));

export async function loadDevelopmentReadinessActivation(): Promise<DevelopmentReadinessActivation> {
  const handle = await open(DEVELOPMENT_READINESS_ACTIVATION_PATH, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const metadata = await handle.stat(); const expectedUid = process.getuid?.();
    if (!metadata.isFile() || metadata.nlink !== 1 || expectedUid === undefined || metadata.uid !== expectedUid || (metadata.mode & 0o777) !== 0o664 || metadata.size > 256 * 1024) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D1_ACTIVATION_UNSAFE', 'Fixed development readiness activation ownership, type, link count, mode, or size differs.');
    }
    const bytes = await handle.readFile(); const value = developmentReadinessActivationSchema.parse(parseStrictJson(bytes, 256 * 1024));
    if (!canonicalJson(value).equals(bytes)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D1_ACTIVATION_INVALID', 'Fixed development readiness activation is not canonical JSON.');
    return value;
  } catch (cause) { if (cause instanceof ControlledRecoveryError) throw cause;
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D1_ACTIVATION_INVALID', 'Fixed development readiness activation is invalid.', { cause }); }
  finally { await handle.close(); }
}

export interface DevelopmentFileStat { kind: 'file' | 'directory' | 'socket' | 'other'; uid: number; gid: number; mode: number; dev: string; ino: string; size: string }
export interface DevelopmentFileSystemStat { availableBytes: string; availableInodes: string }
export interface DevelopmentReadinessSystem {
  readText(path: '/proc/meminfo' | '/proc/pressure/memory'): Promise<string>;
  fileStat(path: string): Promise<DevelopmentFileStat>;
  fileSystemStat(path: string): Promise<DevelopmentFileSystemStat>;
  inspectDockerContext(): Promise<Uint8Array>;
  inspectDockerDaemon(): Promise<Uint8Array>;
  inspectDockerImages(): Promise<Uint8Array>;
  listRunningDockerContainers(): Promise<Uint8Array>;
}

function nodeStat(value: Awaited<ReturnType<typeof lstat>>): DevelopmentFileStat { return { kind: value.isFile() ? 'file' : value.isDirectory() ? 'directory' : value.isSocket() ? 'socket' : 'other',
  uid: Number(value.uid), gid: Number(value.gid), mode: Number(value.mode) & 0o777, dev: value.dev.toString(), ino: value.ino.toString(), size: value.size.toString() }; }
function fixedDockerCall(activation: DevelopmentReadinessActivation, args: readonly string[]): Promise<Uint8Array> {
  return new Promise((resolve, reject) => execFile(activation.docker.executable, ['--config', activation.docker.config_directory, '--context', activation.docker.context, ...args],
    { encoding: 'buffer', timeout: 15_000, maxBuffer: 2 * 1024 * 1024, env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C' } },
    (error, stdout) => error ? reject(error) : resolve(Buffer.from(stdout))));
}
export function createDevelopmentReadinessSystem(activation: DevelopmentReadinessActivation): DevelopmentReadinessSystem {
  return { readText: async (path) => open(path, constants.O_RDONLY | constants.O_NOFOLLOW).then(async (handle) => { try { return await handle.readFile('utf8'); } finally { await handle.close(); } }),
    fileStat: async (path) => nodeStat(await lstat(path, { bigint: false })),
    fileSystemStat: async (path) => { const value = await statfs(path, { bigint: true }); return { availableBytes: (value.bavail * value.bsize).toString(), availableInodes: value.ffree.toString() }; },
    inspectDockerContext: () => fixedDockerCall(activation, ['context', 'inspect', activation.docker.context]),
    inspectDockerDaemon: () => fixedDockerCall(activation, ['info', '--format', '{{json .}}']),
    inspectDockerImages: () => fixedDockerCall(activation, ['image', 'inspect', ...activation.docker.images.map(({ reference }) => reference)]),
    listRunningDockerContainers: () => fixedDockerCall(activation, ['container', 'ls', '--format', '{{json .}}']),
  };
}

const contextSchema = z.array(z.object({ Name: z.string(), Endpoints: z.object({ docker: z.object({ Host: z.string(), SkipTLSVerify: z.boolean().optional() }).passthrough() }).passthrough() }).passthrough()).length(1);
const daemonSchema = z.object({ ID: z.string(), Name: z.string(), Driver: z.string(), ServerVersion: z.string(), DockerRootDir: z.string(), SecurityOptions: z.array(z.string()) }).passthrough();
const imageSchema = z.array(z.object({ Id: z.string(), RepoDigests: z.array(z.string()) }).passthrough()).max(16);
function strictJson(bytes: Uint8Array): unknown { return parseStrictJson(bytes, 2 * 1024 * 1024); }
function meminfo(text: string, key: string): bigint { const match = new RegExp(`^${key}:\\s+([0-9]+) kB$`, 'm').exec(text); if (!match) throw new Error('meminfo'); return BigInt(match[1]) * 1024n; }
function pressureMicros(text: string): bigint | null { const match = /^some\s+[^\n]*avg10=([0-9]+(?:\.[0-9]+)?)/m.exec(text); return match ? BigInt(Math.round(Number(match[1]) * 10_000)) : null; }
function thresholdMicros(value: string): bigint { return BigInt(Math.round(Number(value) * 10_000)); }
function addCode(codes: Set<string>, code: string): void { codes.add(code); }

export interface DevelopmentReadinessReport {
  format: 'darshan-controlled-recovery-development-readiness-report-v1'; status: 'READY' | 'NOT_READY'; nonProduction: true;
  productionTopologySatisfied: false; splitHostSatisfied: false; rtoSatisfied: false; runAvailable: false; codes: string[];
  projectedSerialPeak: { stage: string; bytes: string; hostReserveBytes: string; requiredAvailableBytes: string; productionMinimumRamBytes: string };
  memory: { availableBytes: string; swapUsedBytes: string; pressureAvg10Micros: string | null };
  workspace: { availableBytes: string; availableInodes: string }; target: { availableBytes: string; availableInodes: string };
  docker: { observed: boolean; runningContainers: string; evidenceSha256: string | null; imagesEvidenceSha256: string | null };
  artifacts: { server: boolean; cms: boolean; player: boolean; firefoxPresent: boolean; firefoxUntouched: true };
  activationSha256: string; evidenceSha256: string;
}

export async function observeDevelopmentReadiness(activation: DevelopmentReadinessActivation,
  system: DevelopmentReadinessSystem = createDevelopmentReadinessSystem(activation)): Promise<DevelopmentReadinessReport> {
  const codes = new Set<string>(); const peaks = activation.resources.serial_stage_peaks.map((stage) => ({ ...stage, value: BigInt(stage.bytes) }));
  const peak = peaks.reduce((left, right) => right.value > left.value ? right : left); const reserve = BigInt(activation.resources.host_reserve_bytes);
  let available = 0n; let swapUsed = 0n; let pressure: bigint | null = null;
  try { const memory = await system.readText('/proc/meminfo'); available = meminfo(memory, 'MemAvailable'); swapUsed = meminfo(memory, 'SwapTotal') - meminfo(memory, 'SwapFree');
    if (available < peak.value + reserve) addCode(codes, 'CONTROLLED_RECOVERY_D1_RAM_OR_RESERVE_INSUFFICIENT');
    if (swapUsed > BigInt(activation.resources.maximum_swap_used_bytes)) addCode(codes, 'CONTROLLED_RECOVERY_D1_SWAP_USE_UNSAFE');
  } catch { addCode(codes, 'CONTROLLED_RECOVERY_D1_MEMORY_OBSERVATION_FAILED'); }
  try { pressure = pressureMicros(await system.readText('/proc/pressure/memory')); if (pressure !== null && pressure > thresholdMicros(activation.resources.maximum_memory_pressure_avg10)) addCode(codes, 'CONTROLLED_RECOVERY_D1_SWAP_PRESSURE_UNSAFE'); }
  catch { pressure = null; }
  const emptyFs = { availableBytes: '0', availableInodes: '0' }; let workspace = emptyFs; let target = emptyFs;
  try { workspace = await system.fileSystemStat(activation.paths.workspace); if (BigInt(workspace.availableBytes) < BigInt(activation.resources.required_workspace_bytes)) addCode(codes, 'CONTROLLED_RECOVERY_D1_WORKSPACE_BYTES_INSUFFICIENT');
    if (BigInt(workspace.availableInodes) < BigInt(activation.resources.required_workspace_inodes)) addCode(codes, 'CONTROLLED_RECOVERY_D1_WORKSPACE_INODES_INSUFFICIENT'); }
  catch { addCode(codes, 'CONTROLLED_RECOVERY_D1_WORKSPACE_UNAVAILABLE'); }
  try { target = await system.fileSystemStat(activation.paths.target); if (BigInt(target.availableBytes) < BigInt(activation.resources.required_target_bytes)) addCode(codes, 'CONTROLLED_RECOVERY_D1_TARGET_BYTES_INSUFFICIENT');
    if (BigInt(target.availableInodes) < BigInt(activation.resources.required_target_inodes)) addCode(codes, 'CONTROLLED_RECOVERY_D1_TARGET_INODES_INSUFFICIENT'); }
  catch { addCode(codes, 'CONTROLLED_RECOVERY_D1_TARGET_UNAVAILABLE'); }
  let dockerObserved = false; let runningContainers = '0'; let dockerEvidence: string | null = null; let imagesEvidence: string | null = null;
  try { const socket = await system.fileStat(activation.docker.socket_path); const socketIdentity = digest(socket);
    if (socket.kind !== 'socket' || socketIdentity !== activation.docker.expected_socket_sha256) { addCode(codes, 'CONTROLLED_RECOVERY_D1_DOCKER_SOCKET_CHANGED');
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D1_DOCKER_SOCKET_CHANGED', 'Fixed local Docker socket identity differs.'); }
    const context = contextSchema.parse(strictJson(await system.inspectDockerContext()))[0];
    if (context.Name !== activation.docker.context || context.Endpoints.docker.Host !== activation.docker.endpoint || context.Endpoints.docker.SkipTLSVerify === true) {
      addCode(codes, 'CONTROLLED_RECOVERY_D1_DOCKER_CONTEXT_CHANGED'); throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D1_DOCKER_CONTEXT_CHANGED', 'Fixed Docker context is not the enrolled local Unix endpoint.'); }
    const daemon = daemonSchema.parse(strictJson(await system.inspectDockerDaemon())); const daemonIdentity = digest({ id: daemon.ID, name: daemon.Name, driver: daemon.Driver,
      serverVersion: daemon.ServerVersion, rootDir: daemon.DockerRootDir, securityOptions: [...daemon.SecurityOptions].sort() });
    if (daemonIdentity !== activation.docker.expected_daemon_sha256 || daemon.ServerVersion !== activation.docker.expected_server_version || daemon.DockerRootDir !== activation.docker.expected_root_dir) addCode(codes, 'CONTROLLED_RECOVERY_D1_DOCKER_DAEMON_CHANGED');
    const images = imageSchema.parse(strictJson(await system.inspectDockerImages()));
    if (activation.docker.images.some((expected) => !images.some((image) => image.Id === expected.image_id && image.RepoDigests.includes(expected.repo_digest)))) addCode(codes, 'CONTROLLED_RECOVERY_D1_IMAGE_MISSING_OR_CHANGED');
    imagesEvidence = digest(images.map(({ Id, RepoDigests }) => ({ Id, RepoDigests: [...RepoDigests].sort() })).sort((a, b) => a.Id.localeCompare(b.Id)));
    const lines = Buffer.from(await system.listRunningDockerContainers()).toString('utf8').trim().split('\n').filter(Boolean); runningContainers = lines.length.toString();
    for (const line of lines) parseStrictJson(Buffer.from(line), 64 * 1024);
    if (lines.length !== 0) addCode(codes, 'CONTROLLED_RECOVERY_D1_FOREIGN_RUNNING_WORKLOAD');
    dockerEvidence = digest({ socketIdentity, daemonIdentity, context: digest(context) }); dockerObserved = true;
  } catch { addCode(codes, 'CONTROLLED_RECOVERY_D1_DOCKER_OBSERVATION_FAILED'); }
  const availability = async (path: string, executable = false) => { try { const value = await system.fileStat(path); return value.kind === 'file' && (!executable || (value.mode & 0o111) !== 0); } catch { return false; } };
  const [server, cms, player, firefoxPresent] = await Promise.all([availability(activation.artifacts.server), availability(activation.artifacts.cms), availability(activation.artifacts.player), availability(activation.firefox_executable, true)]);
  if (!server || !cms || !player) addCode(codes, 'CONTROLLED_RECOVERY_D1_APPLICATION_ARTIFACT_MISSING'); if (!firefoxPresent) addCode(codes, 'CONTROLLED_RECOVERY_D1_FIREFOX_MISSING');
  const core = { format: 'darshan-controlled-recovery-development-readiness-report-v1' as const, status: codes.size === 0 ? 'READY' as const : 'NOT_READY' as const,
    nonProduction: true as const, productionTopologySatisfied: false as const, splitHostSatisfied: false as const, rtoSatisfied: false as const, runAvailable: false as const,
    codes: [...codes].sort(), projectedSerialPeak: { stage: peak.stage, bytes: peak.bytes, hostReserveBytes: reserve.toString(), requiredAvailableBytes: (peak.value + reserve).toString(), productionMinimumRamBytes: activation.resources.production_minimum_ram_bytes },
    memory: { availableBytes: available.toString(), swapUsedBytes: swapUsed.toString(), pressureAvg10Micros: pressure?.toString() ?? null }, workspace, target,
    docker: { observed: dockerObserved, runningContainers, evidenceSha256: dockerEvidence, imagesEvidenceSha256: imagesEvidence },
    artifacts: { server, cms, player, firefoxPresent, firefoxUntouched: true as const }, activationSha256: digest(activation) };
  return { ...core, evidenceSha256: digest(core) };
}
