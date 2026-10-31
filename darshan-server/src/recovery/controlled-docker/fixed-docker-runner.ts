import { dirname } from 'node:path';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../backups/backup-broker-protocol';
import { ControlledRecoveryError, digest } from './contracts';
import type { ControlledRecoveryActivation } from './activation';
import { verifyOwnedFreshTargets, type ObservedTargetResource, type RecoveryTargetSpecification } from './docker-targets';

export interface FixedDockerExecutionRequest {
  executable: string;
  argv: readonly string[];
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
  stdoutMaxBytes: number;
  stderrMaxBytes: number;
  signal?: AbortSignal;
}

export interface FixedDockerExecutionResult { exitCode: number; stdout: Uint8Array; stderr: Uint8Array }
export interface FixedDockerExecutor { execute(request: FixedDockerExecutionRequest): Promise<FixedDockerExecutionResult> }

const forbiddenAmbient = /^(DOCKER_HOST|DOCKER_CONTEXT|DOCKER_CONFIG|DOCKER_CERT_PATH|DOCKER_TLS_VERIFY|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|DOCKER_AUTH_CONFIG|DOCKER_CLI_PLUGIN_EXTRA_DIRS)$/i;

export function fixedDockerEnvironment(ambient: NodeJS.ProcessEnv): Readonly<Record<string, string>> {
  const substituted = Object.entries(ambient).find(([key, value]) => forbiddenAmbient.test(key) && value);
  if (substituted) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DOCKER_AMBIENT_REJECTED', 'Ambient Docker, proxy, plugin, or authentication-helper substitution is forbidden.');
  return Object.freeze({ PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C' });
}

const transcriptSchema = z.object({
  format: z.literal('darshan-fixed-docker-inspect-v1'),
  daemon_identity_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  context: z.literal('darshan-controlled-recovery'),
  endpoint: z.literal('unix:///var/run/docker.sock'),
  resources: z.array(z.object({
    kind: z.enum(['network', 'volume', 'container']), name: z.string().min(1).max(255), id: z.string().min(1).max(255),
    labels: z.record(z.string()), image: z.string().optional(),
    mounts: z.array(z.object({ volumeName: z.string(), destination: z.string(), readOnly: z.boolean() }).strict()).optional(),
    networks: z.array(z.string()).optional(), consumers: z.array(z.string()).optional(), configurationSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }).strict()).max(32),
}).strict();

const foundationTranscriptSchema = z.object({
  format: z.literal('darshan-fixed-docker-foundation-v1'),
  daemon_identity_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  context: z.literal('darshan-controlled-recovery'),
  endpoint: z.literal('unix:///var/run/docker.sock'),
  images: z.array(z.object({ reference: z.string(), image_id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    repo_digests: z.array(z.string()), user: z.string(), entrypoint: z.array(z.string()), command: z.array(z.string()) }).strict()).length(4),
}).strict();

const dockerContextSchema = z.array(z.object({ Name: z.string(), Endpoints: z.object({ docker: z.object({ Host: z.string(), SkipTLSVerify: z.boolean().optional() }).passthrough() }).passthrough() }).passthrough()).length(1);
const dockerInfoSchema = z.object({ ID: z.string().min(1).max(256), Name: z.string().min(1).max(256), Driver: z.string().min(1).max(128),
  ServerVersion: z.string().min(1).max(128), SecurityOptions: z.array(z.string().max(512)).max(64) }).passthrough();
const dockerImageSchema = z.array(z.object({ Id: z.string().regex(/^sha256:[a-f0-9]{64}$/), RepoDigests: z.array(z.string()),
  Config: z.object({ User: z.string(), Entrypoint: z.array(z.string()).nullable(), Cmd: z.array(z.string()).nullable() }).passthrough() }).passthrough()).max(16);

function strictDockerJson(bytes: Uint8Array, maximum = 2 * 1024 * 1024): unknown {
  try { return parseStrictJson(bytes, maximum); } catch (cause) { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DOCKER_OUTPUT_INVALID', 'Docker JSON output is malformed or oversized.', { cause }); }
}

export function verifyRealDockerContext(bytes: Uint8Array, activation: ControlledRecoveryActivation): void {
  const context = dockerContextSchema.parse(strictDockerJson(bytes))[0];
  if (context.Name !== activation.docker.context || context.Endpoints.docker.Host !== activation.docker.endpoint || context.Endpoints.docker.SkipTLSVerify === true)
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DOCKER_DAEMON_CHANGED', 'Docker context is not the exact enrolled local Unix endpoint.');
}

export function verifyRealDockerDaemon(bytes: Uint8Array, activation: ControlledRecoveryActivation): void {
  const info = dockerInfoSchema.parse(strictDockerJson(bytes)); const identity = digest({ id: info.ID, name: info.Name, driver: info.Driver,
    serverVersion: info.ServerVersion, securityOptions: [...info.SecurityOptions].sort() });
  if (identity !== activation.docker.daemon_identity_sha256) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DOCKER_DAEMON_CHANGED', 'Docker daemon identity differs from activation.');
}

export function verifyRealDockerImages(bytes: Uint8Array, activation: ControlledRecoveryActivation): void {
  const images = dockerImageSchema.parse(strictDockerJson(bytes)); const expected = Object.values(activation.resources);
  if (images.length !== expected.length || expected.some((role) => !images.some((image) => image.RepoDigests.includes(role.image) &&
    image.Config.User === role.user && JSON.stringify(image.Config.Entrypoint ?? []) === JSON.stringify(role.entrypoint) &&
    JSON.stringify(image.Config.Cmd ?? []) === JSON.stringify(role.command)))) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DOCKER_IMAGE_CHANGED', 'Preloaded Docker image/runtime identity differs.');
}

function expectedTargetNames(specification: RecoveryTargetSpecification): string[] { return [specification.names.network, specification.names.postgresVolume,
  specification.names.minioVolume, specification.names.postgresContainer, specification.names.minioContainer]; }

export function parseRealDockerTargetInspection(input: { stdout: Uint8Array; stderr: Uint8Array; exitCode: number;
  specification: RecoveryTargetSpecification }): readonly ObservedTargetResource[] {
  const raw = z.array(z.record(z.unknown())).max(16).parse(strictDockerJson(input.stdout));
  const containers = raw.filter((value) => value.Config && value.NetworkSettings);
  const resources: ObservedTargetResource[] = raw.map((value) => {
    const rawLabels = ((value.Labels ?? (value.Config as Record<string, unknown> | undefined)?.Labels) ?? {}) as Record<string, string>;
    const labels = { ...rawLabels }; const configurationSha256 = labels['com.darshan.configuration-sha256']; delete labels['com.darshan.configuration-sha256'];
    if (value.Config && value.NetworkSettings) { const config = value.Config as Record<string, unknown>;
      const hostConfig = (value.HostConfig ?? {}) as Record<string, unknown>;
      const rawMounts = z.array(z.object({ Type: z.string(), Name: z.string().optional(), Destination: z.string(), RW: z.boolean() }).passthrough()).max(16).parse(value.Mounts ?? []);
      const binds = z.array(z.string()).max(16).parse(hostConfig.Binds ?? []); const tmpfs = z.record(z.unknown()).parse(hostConfig.Tmpfs ?? {});
      if (binds.length !== 0 || Object.keys(tmpfs).length !== 0 || rawMounts.some((mount) => mount.Type !== 'volume' || !mount.Name)) {
        throw new ControlledRecoveryError('CONTROLLED_RECOVERY_TARGET_CONFIGURATION_CHANGED', 'Container has an unexpected bind, tmpfs, image, cluster, or other non-volume mount.');
      }
      const mounts = rawMounts.map((mount) => ({ volumeName: mount.Name!, destination: mount.Destination, readOnly: mount.RW === false }));
      const networks = Object.keys((((value.NetworkSettings as Record<string, unknown>).Networks ?? {}) as Record<string, unknown>));
      return { kind: 'container' as const, name: String(value.Name).replace(/^\//, ''), id: String(value.Id), labels,
        image: String(config.Image), mounts, networks, consumers: [], configurationSha256 };
    }
    if (value.Containers !== undefined) { const consumers = Object.values((value.Containers ?? {}) as Record<string, Record<string, unknown>>).map((entry) => String(entry.Name));
      return { kind: 'network' as const, name: String(value.Name), id: String(value.Id), labels, consumers }; }
    const name = String(value.Name); const consumers = containers.filter((container) => ((container.Mounts ?? []) as Array<Record<string, unknown>>).some((mount) => mount.Type === 'volume' && mount.Name === name)).map((container) => String(container.Name).replace(/^\//, ''));
    return { kind: 'volume' as const, name, id: String(value.Name), labels, consumers };
  });
  const observedNames = new Set(resources.map((resource) => resource.name)); const missing = expectedTargetNames(input.specification).filter((name) => !observedNames.has(name));
  const stderr = Buffer.from(input.stderr).toString('utf8'); const accounted = missing.every((name) => stderr.split('\n').some((line) => line.includes(name) && /No such (?:object|container|network|volume)/i.test(line)));
  if (input.exitCode !== 0 && (!accounted || missing.length === 0)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DOCKER_COMMAND_FAILED', 'Docker inspection failed without an exact absent-resource explanation.');
  if (resources.length === 0 && missing.length === 5 && accounted) return [];
  if (missing.length) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_TARGET_PARTIAL', 'Recovery target set is partially present or ambiguous.');
  verifyOwnedFreshTargets(input.specification, resources); return resources;
}

export function parseAndVerifyDockerFoundationTranscript(bytes: Uint8Array, activation: ControlledRecoveryActivation): void {
  let transcript;
  try { transcript = foundationTranscriptSchema.parse(parseStrictJson(bytes, 2 * 1024 * 1024)); }
  catch (cause) { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DOCKER_TRANSCRIPT_INVALID', 'Docker foundation transcript is malformed or oversized.', { cause }); }
  if (transcript.daemon_identity_sha256 !== activation.docker.daemon_identity_sha256 || transcript.context !== activation.docker.context ||
      transcript.endpoint !== activation.docker.endpoint) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DOCKER_DAEMON_CHANGED', 'Docker daemon/context/endpoint identity differs from activation.');
  const expected = Object.values(activation.resources).sort((left, right) => left.image.localeCompare(right.image));
  const observed = [...transcript.images].sort((left, right) => left.reference.localeCompare(right.reference));
  if (expected.length !== observed.length || expected.some((role, index) => {
    const image = observed[index];
    return image.reference !== role.image || !image.repo_digests.includes(role.image) || image.user !== role.user ||
      JSON.stringify(image.entrypoint) !== JSON.stringify(role.entrypoint) || JSON.stringify(image.command) !== JSON.stringify(role.command);
  })) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DOCKER_IMAGE_CHANGED', 'Preloaded image digest or fixed runtime configuration differs from activation.');
}

export function parseAndVerifyFixedDockerTranscript(input: {
  bytes: Uint8Array;
  activation: ControlledRecoveryActivation;
  specification: RecoveryTargetSpecification;
}): readonly ObservedTargetResource[] {
  let transcript;
  try { transcript = transcriptSchema.parse(parseStrictJson(input.bytes, 2 * 1024 * 1024)); }
  catch (cause) { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DOCKER_TRANSCRIPT_INVALID', 'Fixed Docker inspection transcript is malformed or oversized.', { cause }); }
  if (transcript.daemon_identity_sha256 !== input.activation.docker.daemon_identity_sha256 ||
      transcript.context !== input.activation.docker.context || transcript.endpoint !== input.activation.docker.endpoint) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DOCKER_DAEMON_CHANGED', 'Docker daemon/context/endpoint identity differs from activation.');
  }
  verifyOwnedFreshTargets(input.specification, transcript.resources);
  return transcript.resources;
}

function safeId(value: string): string {
  if (!/^[a-f0-9]{12,64}$/.test(value)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_TARGET_FOREIGN', 'Exact Docker resource ID is invalid.');
  return value;
}
function safeVolumeName(value: string): string {
  if (!/^darshan-recovery-(?:pg|minio)-[a-f0-9]{16}-g[1-9][0-9]*$/.test(value)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_TARGET_FOREIGN', 'Exact Docker volume name is invalid.');
  return value;
}

export class FixedDockerRunner {
  private readonly env: Readonly<Record<string, string>>;
  constructor(private readonly activation: ControlledRecoveryActivation, private readonly executor: FixedDockerExecutor,
    ambientEnvironment: NodeJS.ProcessEnv = process.env) {
    this.env = fixedDockerEnvironment(ambientEnvironment);
  }

  private async execute(argv: readonly string[], signal?: AbortSignal, allowNonzero = false): Promise<FixedDockerExecutionResult> {
    if (argv.some((argument) => /(?:^|\s)(?:pull|build|prune|compose|ssh)(?:$|\s)/i.test(argument) || argument === '-v' || argument === '--volumes')) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DOCKER_COMMAND_FORBIDDEN', 'Docker command is outside the fixed runner contract.');
    }
    const result = await this.executor.execute({ executable: this.activation.docker.executable.path,
      argv: ['--config', dirname(this.activation.docker.config_identity.path), '--context', this.activation.docker.context, ...argv],
      env: this.env, timeoutMs: this.activation.limits.command_timeout_ms, stdoutMaxBytes: this.activation.limits.stdout_max_bytes,
      stderrMaxBytes: this.activation.limits.stderr_max_bytes, signal });
    if (result.stdout.byteLength > this.activation.limits.stdout_max_bytes || result.stderr.byteLength > this.activation.limits.stderr_max_bytes) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DOCKER_OUTPUT_LIMIT', 'Docker command output exceeded the activation bound.');
    }
    if (result.exitCode !== 0 && !allowNonzero) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DOCKER_COMMAND_FAILED', 'Fixed Docker command failed.');
    return result;
  }

  private async verifyDaemonIdentity(signal?: AbortSignal): Promise<void> {
    const context = await this.execute(['context', 'inspect', this.activation.docker.context], signal); verifyRealDockerContext(context.stdout, this.activation);
    const info = await this.execute(['info', '--format', '{{json .}}'], signal); verifyRealDockerDaemon(info.stdout, this.activation);
  }

  async verifyFoundation(signal?: AbortSignal): Promise<void> {
    await this.verifyDaemonIdentity(signal);
    const images = Object.values(this.activation.resources).map((role) => role.image);
    const result = await this.execute(['image', 'inspect', ...images], signal); verifyRealDockerImages(result.stdout, this.activation);
  }

  async inspectTargets(specification: RecoveryTargetSpecification, signal?: AbortSignal): Promise<readonly ObservedTargetResource[]> {
    await this.verifyDaemonIdentity(signal);
    const result = await this.execute(['inspect', specification.names.network, specification.names.postgresVolume, specification.names.minioVolume,
      specification.names.postgresContainer, specification.names.minioContainer], signal, true);
    return parseRealDockerTargetInspection({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, specification });
  }

  async createNetwork(specification: RecoveryTargetSpecification, signal?: AbortSignal): Promise<void> {
    await this.execute(['network', 'create', ...Object.entries(specification.labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]), specification.names.network], signal);
  }

  async createVolume(specification: RecoveryTargetSpecification, role: 'postgres' | 'minio', signal?: AbortSignal): Promise<void> {
    const name = role === 'postgres' ? specification.names.postgresVolume : specification.names.minioVolume;
    await this.execute(['volume', 'create', ...Object.entries(specification.labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]), name], signal);
  }

  async createContainer(specification: RecoveryTargetSpecification, role: 'postgres' | 'minio', signal?: AbortSignal): Promise<void> {
    const resource = this.activation.resources[role]; const postgres = role === 'postgres';
    const name = postgres ? specification.names.postgresContainer : specification.names.minioContainer;
    const volume = postgres ? specification.names.postgresVolume : specification.names.minioVolume;
    const destination = postgres ? '/var/lib/postgresql/data' : '/data';
    const configurationSha256 = postgres ? specification.containerConfigurationSha256.postgres : specification.containerConfigurationSha256.minio;
    if (resource.image !== (postgres ? specification.images.postgres : specification.images.minio)) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ACTIVATION_IDENTITY_MISMATCH', 'Activated image differs from the approved target specification.');
    }
    const labels = { ...specification.labels, 'com.darshan.configuration-sha256': configurationSha256 };
    await this.execute(['container', 'create', '--name', name, '--network', specification.names.network,
      '--mount', `type=volume,src=${volume},dst=${destination}`, '--user', resource.user, '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges=true', '--memory', resource.memory_bytes, '--cpus', String(Number(resource.nano_cpus) / 1_000_000_000),
      '--pids-limit', String(resource.pids_limit), '--entrypoint', resource.entrypoint[0],
      ...Object.entries(labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]), resource.image, ...resource.command], signal);
  }

  async startContainer(exactContainerId: string, signal?: AbortSignal): Promise<void> {
    await this.execute(['container', 'start', safeId(exactContainerId)], signal);
  }

  async stopContainer(exactContainerId: string, signal?: AbortSignal): Promise<void> {
    await this.execute(['container', 'stop', '--time', '30', safeId(exactContainerId)], signal);
  }

  async joinNetwork(exactNetworkId: string, exactContainerId: string, signal?: AbortSignal): Promise<void> {
    await this.execute(['network', 'connect', safeId(exactNetworkId), safeId(exactContainerId)], signal);
  }

  async resetOwnedDatabase(exactContainerId: string, exactVolumeId: string, signal?: AbortSignal): Promise<void> {
    await this.execute(['container', 'rm', '--force', safeId(exactContainerId)], signal);
    await this.execute(['volume', 'rm', safeVolumeName(exactVolumeId)], signal);
  }

  async importDatabase(input: { specification: RecoveryTargetSpecification; dumpPath: string; exactNetworkId: string; signal?: AbortSignal }): Promise<void> {
    if (!input.dumpPath.startsWith('/')) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DATABASE_FOREIGN', 'Database dump path must be fixed and absolute.');
    const role = this.activation.resources.importer;
    await this.execute(['container', 'run', '--rm', '--network', safeId(input.exactNetworkId), '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges=true', '--user', role.user, '--memory', role.memory_bytes, '--pids-limit', String(role.pids_limit),
      '--mount', `type=bind,src=${input.dumpPath},dst=/input/database.sql,readonly`, role.image, ...role.command], input.signal);
  }

  async validateRecoveredData(input: { exactNetworkId: string; contractPath: string; signal?: AbortSignal }): Promise<void> {
    if (!input.contractPath.startsWith('/')) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_VALIDATION_FAILED', 'Validation contract path must be fixed and absolute.');
    const role = this.activation.resources.validator;
    await this.execute(['container', 'run', '--rm', '--network', safeId(input.exactNetworkId), '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges=true', '--user', role.user, '--memory', role.memory_bytes, '--pids-limit', String(role.pids_limit),
      '--mount', `type=bind,src=${input.contractPath},dst=/input/validation.json,readonly`, role.image, ...role.command], input.signal);
  }

  static transcriptDigest(resources: readonly ObservedTargetResource[]): string {
    return digest(canonicalJson(resources));
  }
}
