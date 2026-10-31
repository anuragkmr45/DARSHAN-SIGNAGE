import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import type { D3OwnedResource } from './controlled-recovery-d3-effects';
import type { DevelopmentD2Activation } from './controlled-recovery-d2';
import { parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { posix } from 'node:path';
import { d3SourceBackupProfileSchema, type D3SourceBackupProfile } from './controlled-recovery-d3-source-profile';
import { D3_SOURCE_RESOURCE_NAMES, type D3SourceResource, type D3SourceResourceRole } from './controlled-recovery-d3-source-state';
import { assertD3SourceProcessSuccess, d3ProcessDiagnostic, d3SourceFailure } from './controlled-recovery-d3-source-process';

export interface D3DockerExecution { executeFixed(input: { executable: string; argv: readonly string[]; env: Readonly<Record<string, string>>; timeoutMs: number; maximumOutputBytes: number; signal?: AbortSignal }): Promise<{ exitCode: number; stdout: Uint8Array; stderr: Uint8Array }>; }
export interface D3PostgresImageMetadata { id: string; entrypoint: readonly string[]; volumes: readonly string[]; defaultUser: string; postgresUid: '70'; postgresGid: '70'; }
const env = Object.freeze({ PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C' });
function exactId(value: string): string { if (!/^[a-f0-9]{12,64}$/.test(value)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_RESOURCE_ID_INVALID', 'D3 Docker ID is invalid.'); return value; }
function sourceInvalid() { return new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_DOCKER_IDENTITY_INVALID', 'Source Docker identity, ownership, isolation, or configuration differs.'); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw sourceInvalid(); return value as Record<string, unknown>; }
function same(left: unknown, right: unknown) { return digest(left) === digest(right); }
const empty = (value: unknown) => value === null || value === undefined || same(value, []) || same(value, {});
export interface D3SourceDockerObservation { resource: D3SourceResource; running: boolean; exitCode: number | null; health: string | null; ip: string | null; consumers: string[]; createdUnstarted: boolean; }
export function d3CapabilitiesMatch(observed: unknown, planned: readonly string[]): boolean {
  const values = observed == null ? [] : observed; if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !/^(?:CAP_)?[A-Z][A-Z0-9_]*$/.test(value))) return false;
  const normalized = values.map((value: string) => value.replace(/^CAP_/, '').toUpperCase()); return new Set(normalized).size === normalized.length && same(normalized.sort(), [...planned].sort());
}
export interface D3SourceDockerInventory { observed: D3SourceDockerObservation[]; subnetCollision: boolean; volumeConsumers: Array<{ containerId: string; volumeName: string; running: boolean }>; }
export interface D3SourceDockerPlan { role: D3SourceResourceRole; kind: D3SourceResource['kind']; name: string; configurationSha256: string; labels: Record<string, string>;
  argv: string[]; image?: string; command?: string[]; entrypoint?: string; user?: string; network?: string; ip?: string; memory?: string; pids?: number; nanoCpus?: string;
  mounts?: Array<{ type: 'volume' | 'bind'; source: string; destination: string; readonly: boolean }>; tmpfs?: Record<string, string>; capAdd?: string[]; environment?: string[]; }
export function fixedD3SourceDockerPlan(activation: DevelopmentD2Activation, profile: D3SourceBackupProfile, role: D3SourceResourceRole, configurationSha256: string): D3SourceDockerPlan {
  d3SourceBackupProfileSchema.parse(profile); if (!/^[a-f0-9]{64}$/.test(configurationSha256) || !(role in D3_SOURCE_RESOURCE_NAMES)) throw sourceInvalid();
  const name = D3_SOURCE_RESOURCE_NAMES[role]; const labels = { 'com.darshan.d3.operation': activation.operation_id, 'com.darshan.d3.site': 'tiny-d1-development', 'com.darshan.d3.role': role, 'com.darshan.d3.configuration-sha256': configurationSha256 };
  const labelArgs = Object.entries(labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]);
  if (role === 'network') return { role, name, kind: 'network', configurationSha256, labels, argv: ['network', 'create', '--driver', 'bridge', '--internal', '--subnet', profile.network.subnet, '--gateway', profile.network.gateway, ...labelArgs, name] };
  if (role.endsWith('-volume')) return { role, name, kind: 'volume', configurationSha256, labels, argv: ['volume', 'create', '--driver', 'local', ...labelArgs, name] };
  const service = role === 'postgres-init' ? 'postgres' : role; const resource = activation.resources.find((value) => value.role === service); const image = activation.images.find((value) => value.role === service);
  if (!resource || !image || !['postgres', 'minio', 'valkey'].includes(service)) throw sourceInvalid();
  const root = profile.work_root; const mounts: NonNullable<D3SourceDockerPlan['mounts']> = [];
  let user: string; let entrypoint: string; let command: string[]; let environment: string[] = []; let tmpfs: Record<string, string> = {}; let capAdd: string[] = [];
  const bind = (source: string, destination: string) => mounts.push({ type: 'bind', source, destination, readonly: true });
  if (role === 'postgres-init') {
    user = '0:0'; entrypoint = '/usr/local/bin/docker-entrypoint.sh'; command = ['postgres', '-c', 'listen_addresses=', '-c', 'password_encryption=scram-sha-256'];
    capAdd = ['CHOWN', 'FOWNER', 'DAC_OVERRIDE', 'SETUID', 'SETGID']; environment = [`PGDATA=${profile.postgres.data_directory}`, 'POSTGRES_USER=darshan', 'POSTGRES_DB=darshan', 'POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password'];
    mounts.push({ type: 'volume', source: profile.postgres.volume, destination: '/var/lib/postgresql/data', readonly: false }); bind(`${root}/secrets/postgres-password`, '/run/secrets/postgres-password');
    tmpfs = { '/run/postgresql': 'rw,noexec,nosuid,nodev,size=16m,mode=0700' };
  } else if (role === 'postgres') {
    user = '70:70'; entrypoint = '/usr/local/bin/postgres'; const tls = profile.postgres.tls_directory; environment = [`PGDATA=${profile.postgres.data_directory}`];
    command = ['-c', 'listen_addresses=*', '-c', 'password_encryption=scram-sha-256', '-c', 'ssl=on', '-c', 'ssl_min_protocol_version=TLSv1.2', '-c', `ssl_cert_file=${tls}/server.crt`, '-c', `ssl_key_file=${tls}/server.key`, '-c', `ssl_ca_file=${tls}/ca.crt`, '-c', `hba_file=${tls}/pg_hba.conf`];
    mounts.push({ type: 'volume', source: profile.postgres.volume, destination: '/var/lib/postgresql/data', readonly: false }); tmpfs = { '/run/postgresql': 'rw,noexec,nosuid,nodev,size=16m,uid=70,gid=70,mode=0700' };
  } else if (role === 'minio') {
    user = `${profile.minio.user}:${profile.minio.group}`; entrypoint = '/usr/bin/minio'; command = ['--config-dir', '/tmp/minio-config', 'server', '/data', '--certs-dir', '/data/.d3-config/tls', '--address', ':9000'];
    environment = ['MINIO_ROOT_USER_FILE=/data/.d3-config/secrets/minio-access-key', 'MINIO_ROOT_PASSWORD_FILE=/data/.d3-config/secrets/minio-secret-key', 'MINIO_BROWSER=off', 'HOME=/tmp'];
    mounts.push({ type: 'volume', source: profile.minio.volume, destination: '/data', readonly: false });
    tmpfs = { '/tmp': `rw,noexec,nosuid,nodev,size=32m,uid=${profile.minio.user},gid=${profile.minio.group},mode=0700` };
  } else {
    user = `${profile.valkey.user}:${profile.valkey.group}`; entrypoint = '/usr/local/bin/valkey-server';
    command = ['/data/.d3-config/valkey.conf', '--port', '0', '--tls-port', '6379', '--tls-cert-file', '/data/.d3-config/tls/server.crt', '--tls-key-file', '/data/.d3-config/tls/server.key', '--tls-ca-cert-file', '/data/.d3-config/tls/ca.crt', '--tls-auth-clients', 'no', '--aclfile', '/data/.d3-config/users.acl', '--dir', '/data', '--appendonly', 'yes', '--appendfsync', 'always', '--maxmemory', '33554432', '--maxmemory-policy', 'noeviction'];
    mounts.push({ type: 'volume', source: profile.valkey.volume, destination: '/data', readonly: false });
  }
  const network = role === 'postgres-init' ? 'none' : profile.network.name; const ip = role === 'postgres-init' ? undefined : profile[service as 'postgres' | 'minio' | 'valkey'].ip;
  const argv = ['container', 'create', '--pull=never', '--name', name, '--cidfile', `${profile.state_root}/cids/${role}.cid`, '--network', network, ...(ip ? ['--ip', ip] : []), ...labelArgs, '--user', user,
    '--memory', resource.memory_bytes, '--cpus', String(Number(resource.nano_cpus) / 1_000_000_000), '--pids-limit', String(resource.pids_limit), '--read-only', '--cap-drop', 'ALL',
    ...capAdd.flatMap((value) => ['--cap-add', value]), '--security-opt', 'no-new-privileges=true', '--restart', 'no',
    ...mounts.flatMap((mount) => ['--mount', `type=${mount.type},src=${mount.source},dst=${mount.destination}${mount.readonly ? ',readonly' : ''}`]),
    ...Object.entries(tmpfs).flatMap(([destination, value]) => ['--tmpfs', `${destination}:${value}`]), ...environment.flatMap((value) => ['--env', value]),
    ...(role === 'postgres-init' ? ['--health-cmd', 'pg_isready -U darshan -d darshan', '--health-interval', '2s', '--health-timeout', '2s', '--health-retries', '30'] : []), '--entrypoint', entrypoint, image.image_id, ...command];
  return { role, name, kind: 'container', configurationSha256, labels, argv, image: image.image_id, command, entrypoint, user, network, ...(ip ? { ip } : {}), memory: resource.memory_bytes, pids: resource.pids_limit, nanoCpus: resource.nano_cpus, mounts, tmpfs, capAdd, environment };
}
export function sourceObservation(raw: unknown, plan: D3SourceDockerPlan, profile: D3SourceBackupProfile): D3SourceDockerObservation {
  const value = object(raw); const labels = object(plan.kind === 'container' ? object(value.Config).Labels : value.Labels);
  if (Object.entries(plan.labels).some(([key, expected]) => labels[key] !== expected) || Object.keys(labels).some((key) => key.startsWith('com.darshan.') && !(key in plan.labels))) throw sourceInvalid();
  let normalized: unknown; let id: string; let running = false; let exitCode: number | null = null; let health: string | null = null; let ip: string | null = null; let consumers: string[] = []; let createdUnstarted = false;
  if (plan.kind === 'network') {
    id = String(value.Id); const ipam = object(value.IPAM); const networks = ipam.Config;
    if (value.Name !== plan.name || value.Driver !== 'bridge' || value.Internal !== true || value.EnableIPv6 !== false || value.Attachable !== false || value.Ingress !== false ||
        !empty(value.Options) || !same(networks, [{ Subnet: profile.network.subnet, Gateway: profile.network.gateway }])) throw sourceInvalid();
    consumers = Object.keys(object(value.Containers ?? {})); if (consumers.some((entry) => !/^[a-f0-9]{64}$/.test(entry))) throw sourceInvalid();
    normalized = { id, name: value.Name, driver: value.Driver, internal: value.Internal, ipam: networks, labels: plan.labels };
  } else if (plan.kind === 'volume') {
    if (value.Name !== plan.name || value.Driver !== 'local' || value.Scope !== 'local' || !empty(value.Options) || value.Mountpoint !== `/var/lib/docker/volumes/${plan.name}/_data` || typeof value.CreatedAt !== 'string' || !Number.isFinite(Date.parse(value.CreatedAt))) throw sourceInvalid();
    normalized = { name: value.Name, driver: value.Driver, scope: value.Scope, mountpoint: value.Mountpoint, createdAt: value.CreatedAt, labels: plan.labels }; id = digest(normalized);
  } else {
    id = String(value.Id); const config = object(value.Config); const host = object(value.HostConfig); const state = object(value.State); const settings = object(value.NetworkSettings); const restart = object(host.RestartPolicy);
    if (value.Name !== `/${plan.name}` || value.Image !== plan.image || config.Image !== plan.image || config.User !== plan.user || !same(config.Entrypoint, [plan.entrypoint]) || !same(config.Cmd, plan.command) ||
        host.NetworkMode !== plan.network || host.ReadonlyRootfs !== true || host.Privileged !== false || host.PublishAllPorts !== false || host.AutoRemove !== false ||
        !empty(host.PortBindings) || !empty(host.Binds) || !empty(host.Devices) || !empty(host.DeviceRequests) || !empty(host.DeviceCgroupRules) || !empty(host.GroupAdd) || !empty(host.Sysctls) || !empty(host.VolumesFrom) || !empty(host.Links) || !empty(host.ExtraHosts) ||
        Boolean(host.CgroupParent) || host.CgroupnsMode === 'host' || host.OomKillDisable === true || Boolean(host.CpusetCpus) || Boolean(host.CpusetMems) || Boolean(host.CpuQuota) || Boolean(host.CpuPeriod) ||
        Boolean(host.PidMode) || Boolean(host.UTSMode) || (host.IpcMode !== undefined && host.IpcMode !== 'private') || Boolean(host.UsernsMode) ||
        restart.Name !== 'no' || restart.MaximumRetryCount !== 0 || host.Memory !== Number(plan.memory) || host.NanoCpus !== Number(plan.nanoCpus) || host.PidsLimit !== plan.pids ||
        !d3CapabilitiesMatch(host.CapDrop, ['ALL']) || !d3CapabilitiesMatch(host.CapAdd, plan.capAdd!) || !same(host.SecurityOpt, ['no-new-privileges=true']) || !same(host.Tmpfs ?? {}, plan.tmpfs)) throw sourceInvalid();
    if (!Array.isArray(config.Env) || plan.environment!.some((entry) => !(config.Env as unknown[]).includes(entry))) throw sourceInvalid();
    const mounts = value.Mounts; if (!Array.isArray(mounts)) throw sourceInvalid();
    const observedMounts = mounts.map((rawMount) => { const mount = object(rawMount); if (!['volume', 'bind'].includes(String(mount.Type)) || typeof mount.RW !== 'boolean') throw sourceInvalid(); return { type: mount.Type, source: mount.Type === 'volume' ? mount.Name : mount.Source, destination: mount.Destination, readonly: !mount.RW }; });
    const sortMounts = (entries: unknown[]) => [...entries].sort((a, b) => String(object(a).destination).localeCompare(String(object(b).destination)));
    if (!same(sortMounts(observedMounts), sortMounts(plan.mounts!))) throw sourceInvalid();
    const networks = object(settings.Networks); if (!same(Object.keys(networks), [plan.network])) throw sourceInvalid(); const attached = object(networks[plan.network!]);
    running = state.Running === true; if (typeof state.Running !== 'boolean' || !Number.isInteger(state.ExitCode) || Number(state.ExitCode) < 0 || Number(state.ExitCode) > 255) throw sourceInvalid(); exitCode = Number(state.ExitCode);
    createdUnstarted = !running && exitCode === 0 && state.Status === 'created' && state.Pid === 0 && state.Dead === false && state.Restarting === false && state.OOMKilled === false && value.RestartCount === 0 && state.StartedAt === '0001-01-01T00:00:00Z' && state.FinishedAt === '0001-01-01T00:00:00Z';
    health = state.Health ? String(object(state.Health).Status) : null; ip = String(attached.IPAddress ?? '') || null;
    if (plan.ip && ((running && ip !== plan.ip) || (!running && ip !== null && ip !== plan.ip))) throw sourceInvalid();
    normalized = { id, image: value.Image, user: config.User, entrypoint: config.Entrypoint, command: config.Cmd, labels: plan.labels, mounts: sortMounts(observedMounts), network: plan.network,
      memory: host.Memory, cpus: host.NanoCpus, pids: host.PidsLimit, capAdd: plan.capAdd, tmpfs: plan.tmpfs, environment: plan.environment };
  }
  if (!/^[a-f0-9]{64}$/.test(id)) throw sourceInvalid();
  return { resource: { kind: plan.kind, role: plan.role, name: plan.name, id, configurationSha256: plan.configurationSha256, identitySha256: digest(normalized), retired: false }, running, exitCode, health, ip, consumers, createdUnstarted };
}
export class FixedD3Docker {
  constructor(private readonly activation: DevelopmentD2Activation, private readonly executor: D3DockerExecution, private readonly docker = '/usr/bin/docker') {
    if (docker !== '/usr/bin/docker') throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_DOCKER_EXECUTABLE_INVALID', 'Only the fixed Docker executable is allowed.'); }
  private async call(args: readonly string[], timeoutMs = 60_000, signal?: AbortSignal) {
    if (signal?.aborted) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED', 'The fixed source operation was cancelled before dispatch.');
    try { const result = await this.executor.executeFixed({ executable: this.docker,
      argv: ['--config', '/home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/docker-config', '--context', 'default', ...args], env, timeoutMs, maximumOutputBytes: 2 * 1024 * 1024, ...(signal ? { signal } : {}) });
      assertD3SourceProcessSuccess({ executable: '/usr/bin/docker', argv: args, timeoutMs, maximumOutputBytes: 2 * 1024 * 1024 }, result); return result;
    } catch (cause) { if (cause instanceof ControlledRecoveryError) throw cause;
      throw d3SourceFailure(signal?.aborted ? 'CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED' : 'CONTROLLED_RECOVERY_D3_DOCKER_FAILED',
        d3ProcessDiagnostic({ executable: '/usr/bin/docker', argv: args, timeoutMs }, signal?.aborted ? 'CANCELLED' : 'UNKNOWN')); }
  }
  inspectExactResources() { return this.call(['container', 'inspect', ...this.activation.resources.map(({ name }) => name)]); }
  listAllContainers() { return this.call(['container', 'ls', '--all', '--no-trunc', '--format', '{{json .}}']); }
  assertPostgresImageMetadata(value: D3PostgresImageMetadata) { const image = this.activation.images.find(({ role }) => role === 'postgres')!;
    if (value.id !== image.image_id || JSON.stringify(value.entrypoint) !== JSON.stringify(['/usr/local/bin/docker-entrypoint.sh']) || !value.volumes.includes('/var/lib/postgresql/data') || value.defaultUser !== '' || value.postgresUid !== '70' || value.postgresGid !== '70')
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_POSTGRES_IMAGE_CHANGED', 'PostgreSQL image metadata differs from the enrolled PG16 initialization contract.'); return digest(value); }
  createPostgresInit(metadata: D3PostgresImageMetadata) { this.assertPostgresImageMetadata(metadata); const resource = this.activation.resources.find(({ role }) => role === 'postgres')!;
    const image = this.activation.images.find(({ role }) => role === 'postgres')!; const root = '/home/hexmon/Desktop/DARSHAN-SIGNAGE/.controlled-recovery-d3';
    return this.call(['container', 'create', '--name', `${resource.name}-init`, '--network', 'none', '--label', `com.darshan.d3.operation=${this.activation.operation_id}`, '--label', 'com.darshan.d3.role=postgres-init',
      '--memory', resource.memory_bytes, '--cpus', String(Number(resource.nano_cpus) / 1_000_000_000), '--pids-limit', String(resource.pids_limit), '--read-only', '--cap-drop', 'ALL',
      '--cap-add', 'CHOWN', '--cap-add', 'FOWNER', '--cap-add', 'DAC_OVERRIDE', '--cap-add', 'SETUID', '--cap-add', 'SETGID', '--security-opt', 'no-new-privileges=true',
      '--env', 'POSTGRES_USER=darshan', '--env', 'POSTGRES_DB=darshan', '--env', 'POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password',
      '--mount', `type=bind,src=${root}/secrets/postgres-password,dst=/run/secrets/postgres-password,readonly`, '--mount', `type=volume,src=${this.activation.docker.postgres_volume},dst=/var/lib/postgresql/data`,
      '--tmpfs', '/run/postgresql:rw,noexec,nosuid,size=16m', '--health-cmd', 'pg_isready -U darshan -d darshan', '--health-interval', '2s', '--health-timeout', '2s', '--health-retries', '30',
      image.image_id, 'postgres', '-c', 'listen_addresses=']); }
  createPostgresRuntime(metadata: D3PostgresImageMetadata) { this.assertPostgresImageMetadata(metadata); const resource = this.activation.resources.find(({ role }) => role === 'postgres')!;
    const image = this.activation.images.find(({ role }) => role === 'postgres')!;
    return this.call(['container', 'create', '--name', resource.name, '--network', this.activation.docker.network, '--label', `com.darshan.d3.operation=${this.activation.operation_id}`, '--label', 'com.darshan.d3.role=postgres',
      '--memory', resource.memory_bytes, '--cpus', String(Number(resource.nano_cpus) / 1_000_000_000), '--pids-limit', String(resource.pids_limit), '--user', '70:70', '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges=true', '--entrypoint', 'postgres', '--mount', `type=volume,src=${this.activation.docker.postgres_volume},dst=/var/lib/postgresql/data`,
      '--tmpfs', '/run/postgresql:rw,noexec,nosuid,size=16m,uid=70,gid=70', '--health-cmd', 'pg_isready -U darshan -d darshan', '--health-interval', '2s', '--health-timeout', '2s', '--health-retries', '30', image.image_id]); }
  inspectPostgresHealth(id: string) { return this.call(['container', 'inspect', '--format', '{{json .State.Health}}', exactId(id)]); }
  async createBase(role: 'postgres' | 'minio' | 'valkey') { if (role === 'postgres') throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_POSTGRES_PHASE_REQUIRED', 'PostgreSQL requires the enrolled init then numeric runtime phases.');
    const resource = this.activation.resources.find((value) => value.role === role)!; const image = this.activation.images.find((value) => value.role === role)!;
    const mount = role === 'minio' ? `${this.activation.docker.minio_volume}:/data` : `${this.activation.docker.valkey_volume}:/data`;
    return this.call(['container', 'create', '--name', resource.name, '--network', this.activation.docker.network, '--label', `com.darshan.d3.operation=${this.activation.operation_id}`,
      '--label', `com.darshan.d3.role=${role}`, '--memory', resource.memory_bytes, '--cpus', String(Number(resource.nano_cpus) / 1_000_000_000), '--pids-limit', String(resource.pids_limit),
      '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges=true', '--mount', `type=volume,src=${mount.split(':')[0]},dst=${mount.split(':')[1]}`,
      image.image_id, ...(role === 'minio' ? ['server', '/data'] : role === 'valkey' ? ['valkey-server', '--appendonly', 'yes'] : [])]); }
  startExact(id: string, signal?: AbortSignal) { return this.call(['container', 'start', exactId(id)], 60_000, signal); }
  stopExact(id: string) { return this.call(['container', 'stop', '--time', '30', exactId(id)]); }
  removeExact(id: string) { return this.call(['container', 'rm', exactId(id)]); }
  private async sourceJson(args: readonly string[], timeoutMs = 2_000): Promise<unknown> {
    const result = await this.call(args, timeoutMs); try { return parseStrictJson(Buffer.from(result.stdout), 2 * 1024 * 1024); } catch { throw sourceInvalid(); }
  }
  private async sourceLines(args: readonly string[]): Promise<Record<string, unknown>[]> {
    const result = await this.call(args, 2_000); try { const lines = Buffer.from(result.stdout).toString('utf8').trim().split('\n').filter(Boolean); if (lines.length > 256) throw sourceInvalid();
      return lines.map((line) => object(parseStrictJson(Buffer.from(line), 64 * 1024))); } catch { throw sourceInvalid(); }
  }
  sourcePlan(profile: D3SourceBackupProfile, role: D3SourceResourceRole, configurationSha256: string) { return fixedD3SourceDockerPlan(this.activation, profile, role, configurationSha256); }
  async inspectSourceResource(profile: D3SourceBackupProfile, role: D3SourceResourceRole, configurationSha256: string): Promise<D3SourceDockerObservation> {
    const plan = this.sourcePlan(profile, role, configurationSha256); const value = await this.sourceJson([plan.kind, 'inspect', plan.name]);
    if (!Array.isArray(value) || value.length !== 1) throw sourceInvalid(); try { return sourceObservation(value[0], plan, profile); } catch { throw sourceInvalid(); }
  }
  async createSourceResource(profile: D3SourceBackupProfile, role: D3SourceResourceRole, configurationSha256: string, signal?: AbortSignal): Promise<D3SourceDockerObservation> {
    const plan = this.sourcePlan(profile, role, configurationSha256); const result = await this.call(plan.argv, 60_000, signal); const created = Buffer.from(result.stdout).toString('utf8').trim();
    if (plan.kind === 'volume' ? created !== plan.name : !/^[a-f0-9]{64}$/.test(created)) throw sourceInvalid();
    // Settle the returned identity even when cancellation raced creation, so its owner can durably retain the exact ID.
    const observed = await this.inspectSourceResource(profile, role, configurationSha256); if (plan.kind !== 'volume' && observed.resource.id !== created) throw sourceInvalid(); return observed;
  }
  async inspectSourceInventory(profile: D3SourceBackupProfile, configurations: Readonly<Record<D3SourceResourceRole, string>> | null): Promise<D3SourceDockerInventory> {
    const networkRows = await this.sourceLines(['network', 'ls', '--no-trunc', '--format', '{{json .}}']); const volumeRows = await this.sourceLines(['volume', 'ls', '--format', '{{json .}}']);
    const containerRows = await this.sourceLines(['container', 'ls', '--all', '--no-trunc', '--format', '{{json .}}']); const observed: D3SourceDockerObservation[] = [];
    for (const role of Object.keys(D3_SOURCE_RESOURCE_NAMES) as D3SourceResourceRole[]) { const kind = role === 'network' ? 'network' : role.endsWith('-volume') ? 'volume' : 'container'; const name = D3_SOURCE_RESOURCE_NAMES[role];
      const rows = kind === 'network' ? networkRows : kind === 'volume' ? volumeRows : containerRows; const matches = rows.filter((row) => (kind === 'container' ? row.Names : row.Name) === name);
      if (matches.length > 1 || matches.length && !configurations) throw sourceInvalid(); if (!matches.length) continue; const value = await this.inspectSourceResource(profile, role, configurations![role]);
      if (kind !== 'volume' && value.resource.id !== matches[0]!.ID) throw sourceInvalid(); observed.push(value);
    }
    const networkIds = networkRows.map((row) => String(row.ID)); if (networkIds.some((id) => !/^[a-f0-9]{64}$/.test(id)) || new Set(networkIds).size !== networkIds.length) throw sourceInvalid(); let subnetCollision = false;
    if (networkIds.length) {
      const allNetworks = await this.sourceJson(['network', 'inspect', ...networkIds]); if (!Array.isArray(allNetworks) || allNetworks.length !== networkIds.length) throw sourceInvalid();
      const owned = observed.find(({ resource }) => resource.role === 'network')?.resource.id;
      if (new Set(allNetworks.map((raw) => object(raw).Id)).size !== networkIds.length) throw sourceInvalid();
      for (const raw of allNetworks) { const value = object(raw); if (!networkIds.includes(String(value.Id))) throw sourceInvalid(); if (value.Id === owned) continue; const configs = object(value.IPAM).Config ?? [];
        if (!Array.isArray(configs)) throw sourceInvalid(); for (const config of configs) { const subnet = object(config).Subnet; if (typeof subnet !== 'string') throw sourceInvalid(); if (!subnet.includes(':') && d3Ipv4SubnetsOverlap(profile.network.subnet, subnet)) subnetCollision = true; } }
    }
    const volumeConsumers: D3SourceDockerInventory['volumeConsumers'] = []; const containerIds = containerRows.map((row) => String(row.ID));
    if (containerIds.some((id) => !/^[a-f0-9]{64}$/.test(id)) || new Set(containerIds).size !== containerIds.length) throw sourceInvalid();
    if (containerIds.length) {
      // All listed containers, including stopped and differently named/networked ones, can retain a named-volume mount.
      const allContainers = await this.sourceJson(['container', 'inspect', ...containerIds]);
      if (!Array.isArray(allContainers) || allContainers.length !== containerIds.length || new Set(allContainers.map((raw) => object(raw).Id)).size !== containerIds.length) throw sourceInvalid();
      const volumes = [profile.postgres.volume, profile.minio.volume, profile.valkey.volume];
      for (const raw of allContainers) { const value = object(raw); const containerId = String(value.Id); const running = object(value.State).Running;
        if (!containerIds.includes(containerId) || typeof running !== 'boolean' || !Array.isArray(value.Mounts)) throw sourceInvalid();
        for (const rawMount of value.Mounts) { const mount = object(rawMount);
          if (!['volume', 'bind', 'tmpfs'].includes(String(mount.Type)) || (mount.Type === 'volume' && typeof mount.Name !== 'string') || (mount.Type === 'bind' && (typeof mount.Source !== 'string' || !mount.Source.startsWith('/')))) throw sourceInvalid();
          for (const volumeName of volumes) { const dataRoot = `/var/lib/docker/volumes/${volumeName}/_data`; const source = posix.normalize(String(mount.Source ?? ''));
            const bindsSourceVolume = mount.Type === 'bind' && (source === dataRoot || source.startsWith(`${dataRoot}/`) || dataRoot.startsWith(`${source}/`) || source === '/');
            if ((mount.Type === 'volume' && mount.Name === volumeName) || bindsSourceVolume) volumeConsumers.push({ containerId, volumeName, running }); }
        }
      }
    }
    return { observed, subnetCollision, volumeConsumers };
  }
  async joinExactSourceContainer(id: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw sourceInvalid(); const result = await this.call(['container', 'wait', id], 120_000); if (Buffer.from(result.stdout).toString('utf8').trim() !== '0') throw sourceInvalid();
  }
  bridgeIpEvidence(resources: readonly D3OwnedResource[], bridgeIps: Readonly<Record<string, string>>) { if (Object.keys(bridgeIps).some((role) => !resources.some((value) => value.role === role)) || Object.values(bridgeIps).some((ip) => !/^172\.(?:1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}$/.test(ip)))
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_BRIDGE_IDENTITY_INVALID', 'D3 bridge IP identity is invalid.'); return digest(bridgeIps); }
}

export function d3Ipv4SubnetsOverlap(left: string, right: string): boolean {
  const range = (cidr: string) => { const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(cidr); if (!match) throw sourceInvalid(); const octets = match.slice(1, 5).map(Number); const prefix = Number(match[5]);
    if (octets.some((part) => part > 255) || prefix > 32) throw sourceInvalid(); const value = octets.reduce((sum, part) => sum * 256 + part, 0); const size = 2 ** (32 - prefix); const start = Math.floor(value / size) * size; return { start, end: start + size - 1 }; };
  const a = range(left); const b = range(right); return a.start <= b.end && b.start <= a.end;
}
