import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest } from '../../src/recovery/controlled-docker/contracts';
import { type D3OperationAuthority } from './controlled-recovery-d3-authority';
import { FixedD3Docker, fixedD3SourceDockerPlan, type D3DockerExecution, type D3SourceDockerPlan } from './controlled-recovery-d3-docker';
import { fixedD3SourceBackupProfile } from './controlled-recovery-d3-source-profile';
import { DurableD3SourceState, type D3SourceResourceRole } from './controlled-recovery-d3-source-state';
import { FixedD3SourceServices, type D3SourceHealthProbes, type D3SourceLayoutReceipt } from './controlled-recovery-d3-source-services';
import { testD3Operation } from './controlled-recovery-d3.test-support';
import { developmentD2ActivationSchema } from './controlled-recovery-d2';
import d2Json from '../../../deploy/development/controlled-recovery/tiny-e2e-d2.activation.json';

export const sourceD2 = developmentD2ActivationSchema.parse(d2Json);
export const sourceProfile = fixedD3SourceBackupProfile(testD3Operation.ownerUid, testD3Operation.ownerGid);
export const sourceLayout: D3SourceLayoutReceipt = { evidenceSha256: digest('layout'), retainedSecretsSha256: digest('retained-secrets'), caSha256: digest('ca'),
  certificates: { postgres: digest('pg-cert'), minio: digest('minio-cert'), valkey: digest('valkey-cert') }, protectedModesVerified: true, exclusiveRetainedSecretsVerified: true };
export function sourceRaw(plan: D3SourceDockerPlan): Record<string, any> {
  const id = digest(`source-${plan.role}`);
  if (plan.kind === 'network') return { Id: id, Name: plan.name, Driver: 'bridge', Internal: true, EnableIPv6: false, Attachable: false, Ingress: false, Options: {}, Labels: plan.labels, IPAM: { Config: [{ Subnet: sourceProfile.network.subnet, Gateway: sourceProfile.network.gateway }] }, Containers: {} };
  if (plan.kind === 'volume') return { Name: plan.name, Driver: 'local', Scope: 'local', Options: null, Mountpoint: `/var/lib/docker/volumes/${plan.name}/_data`, CreatedAt: '2026-10-30T00:00:00Z', Labels: plan.labels };
  return { Id: id, Name: `/${plan.name}`, Image: plan.image, Config: { Image: plan.image, Labels: plan.labels, User: plan.user, Entrypoint: [plan.entrypoint], Cmd: plan.command, Env: plan.environment },
    HostConfig: { NetworkMode: plan.network, Memory: Number(plan.memory), NanoCpus: Number(plan.nanoCpus), PidsLimit: plan.pids, ReadonlyRootfs: true, Privileged: false, PublishAllPorts: false, AutoRemove: false,
      PortBindings: {}, Binds: null, Devices: [], DeviceRequests: null, VolumesFrom: null, Links: null, ExtraHosts: null, PidMode: '', UTSMode: '', IpcMode: 'private', UsernsMode: '', RestartPolicy: { Name: 'no', MaximumRetryCount: 0 }, CapDrop: ['ALL'], CapAdd: plan.capAdd, SecurityOpt: ['no-new-privileges=true'], Tmpfs: plan.tmpfs },
    Mounts: plan.mounts!.map((mount) => ({ Type: mount.type, ...(mount.type === 'volume' ? { Name: mount.source } : { Source: mount.source }), Destination: mount.destination, RW: !mount.readonly })),
    RestartCount: 0, State: { Status: 'created', Running: false, ExitCode: 0, Pid: 0, Dead: false, Restarting: false, OOMKilled: false, StartedAt: '0001-01-01T00:00:00Z', FinishedAt: '0001-01-01T00:00:00Z', ...(plan.role === 'postgres-init' ? { Health: { Status: 'healthy' } } : {}) }, NetworkSettings: { Networks: { [plan.network!]: { IPAddress: '' } } }, _plan: plan };
}
export class FakeSourceDocker implements D3DockerExecution {
  readonly resources = new Map<D3SourceResourceRole, Record<string, any>>(); readonly calls: string[][] = []; readonly foreignConsumers: string[] = [];
  readonly foreignContainers = new Map<string, Record<string, any>>(); readonly signals: Array<AbortSignal | undefined> = [];
  foreignSubnet: string | null = null; failNext: ((args: readonly string[]) => boolean) | null = null; afterCreateFailure: D3SourceResourceRole | null = null;
  afterCreate: ((role: D3SourceResourceRole, input: Parameters<D3DockerExecution['executeFixed']>[0]) => Promise<void>) | null = null;
  beforeStart: ((id: string) => Promise<void>) | null = null;
  private list(kind: string): Array<[string, Record<string, any>]> { const owned = [...this.resources.entries()].filter(([, raw]) => (raw._plan?.kind ?? (raw.IPAM ? 'network' : raw.Mountpoint ? 'volume' : 'container')) === kind);
    return [...owned, ...(kind === 'container' ? [...this.foreignContainers.entries()] : [])]; }
  addForeignVolumeConsumer(volumeName: string, running: boolean, bind = false) {
    const id = digest(`foreign-${volumeName}-${running}-${bind}`); this.foreignContainers.set(id, { Id: id, Name: `/unrelated-volume-user-${id.slice(0, 12)}`, State: { Running: running },
      Mounts: [bind ? { Type: 'bind', Source: `/var/lib/docker/volumes/${volumeName}/_data`, Destination: '/foreign', RW: false } : { Type: 'volume', Name: volumeName, Destination: '/foreign', RW: false }],
      NetworkSettings: { Networks: { 'foreign-network': { IPAddress: '10.10.0.7' } } } }); return id;
  }
  async executeFixed(input: Parameters<D3DockerExecution['executeFixed']>[0]) {
    const args = input.argv.slice(4); this.calls.push([...args]); this.signals.push(input.signal); const result = (value: unknown, exitCode = 0) => ({ exitCode, stdout: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)), stderr: Buffer.from(exitCode ? 'PRIVATE PROBE CREDENTIALS' : '') });
    if (this.failNext?.(args)) { this.failNext = null; return result('', 17); }
    const [kind, action] = args;
    if (action === 'ls') {
      const rows = this.list(kind!).map(([, raw]) => ({ ID: raw.Id, Name: raw.Name?.replace(/^\//, ''), Names: raw.Name?.replace(/^\//, '') }));
      if (kind === 'network' && this.foreignSubnet) rows.push({ ID: digest('foreign-network'), Name: 'foreign-network', Names: 'foreign-network' });
      return result(rows.map((row) => JSON.stringify(row)).join('\n'));
    }
    if (action === 'inspect') {
      const selected = args.slice(2).map((name) => {
        if (name === digest('foreign-network') && this.foreignSubnet) return { Id: name, Name: 'foreign-network', IPAM: { Config: [{ Subnet: this.foreignSubnet }] } };
        const found = this.list(kind!).find(([, raw]) => raw.Id === name || raw.Name === name || raw.Name === `/${name}`)?.[1];
        if (found?.IPAM) { found.Containers = Object.fromEntries([...this.list('container').filter(([, raw]) => raw.State.Running && raw._plan?.network === sourceProfile.network.name).map(([, raw]) => raw.Id), ...this.foreignConsumers].map((id) => [id, {}])); }
        return found;
      });
      if (selected.some((raw) => !raw)) return result('', 1); return result(selected);
    }
    if (action === 'create') {
      const label = args.find((part) => part.startsWith('com.darshan.d3.role='))!; const role = label.split('=')[1] as D3SourceResourceRole;
      const configuration = args.find((part) => part.startsWith('com.darshan.d3.configuration-sha256='))!.split('=')[1]!;
      const plan = fixedD3SourceDockerPlan(sourceD2, sourceProfile, role, configuration); const raw = sourceRaw(plan); this.resources.set(role, raw);
      if (this.afterCreateFailure === role) { this.afterCreateFailure = null; return result('', 19); }
      await this.afterCreate?.(role, input);
      return result(plan.kind === 'volume' ? plan.name : raw.Id);
    }
    const id = args.at(-1)!; const found = this.list('container').find(([, raw]) => raw.Id === id);
    if (!found) return result('', 1); const [role, raw] = found; if (!this.resources.has(role as D3SourceResourceRole)) return result('', 1);
    if (action === 'start') { await this.beforeStart?.(id); raw.State.Status = 'running'; raw.State.StartedAt = '2026-10-30T00:00:00Z'; raw.State.Pid = 1; raw.State.Running = true; raw.NetworkSettings.Networks[raw._plan.network].IPAddress = raw._plan.ip ?? ''; return result(id); }
    if (action === 'stop') { raw.State.Running = false; raw.State.Status = 'exited'; raw.State.Pid = 0; raw.State.FinishedAt = '2026-10-30T00:00:01Z'; raw.State.ExitCode = 0; return result(id); }
    if (action === 'wait') return result(String(raw.State.ExitCode));
    if (action === 'rm') { this.resources.delete(role as D3SourceResourceRole); return result(id); }
    return result('', 1);
  }
}

export async function sourceFixture(enrolledProfileSha256?: string) {
  const root = await mkdtemp(join(tmpdir(), 'darshan-d3-source-')); const authority = { ...testD3Operation, root } as D3OperationAuthority; const profileSha256 = enrolledProfileSha256 ?? digest({ profile: sourceProfile, caps: sourceD2.resources, images: sourceD2.images });
  const state = new DurableD3SourceState(authority, profileSha256); const api = new FakeSourceDocker(); const docker = new FixedD3Docker(sourceD2, api); let now = 0;
  const checks: string[] = []; let rejectedProbe: string | null = null;
  const base = (role: keyof D3SourceLayoutReceipt['certificates']) => ({ authenticated: rejectedProbe !== 'auth', tlsVerified: rejectedProbe !== 'tls', plaintextRejected: rejectedProbe !== 'plaintext', unauthenticatedRejected: rejectedProbe !== 'unauthenticated', peerCertificateSha256: rejectedProbe === 'peer' ? digest('foreign-cert') : sourceLayout.certificates[role], evidenceSha256: digest(`probe-${role}`) });
  const probes: D3SourceHealthProbes = { postgresTlsSelect: async () => { checks.push('postgres'); return { ...base('postgres'), result: '1', database: 'darshan', user: 'darshan', serverMajor: 16 }; },
    minioTlsS3: async () => { checks.push('minio'); return { ...base('minio'), operation: 'LIST_BUCKETS', success: true }; }, valkeyTlsPing: async () => { checks.push('valkey'); return { ...base('valkey'), reply: 'PONG', aclUser: 'd3-source' }; } };
  const admissions: string[] = []; const volumes = { verifyRetained: async () => ({ evidenceSha256: digest('materialized') }), prepare: async () => ({ postgresOwner: '70:70' as const, minioOwner: `${sourceProfile.minio.user}:${sourceProfile.minio.group}`, valkeyOwner: `${sourceProfile.valkey.user}:${sourceProfile.valkey.group}`, directoryMode: '0700' as const, fileMode: '0600' as const, postgresTlsAndScramVerified: true as const, evidenceSha256: digest('materialized') }) };
  const services = new FixedD3SourceServices(sourceD2, sourceProfile, sourceLayout, docker, state, { assert: async ({ phase }) => { admissions.push(phase); } }, volumes, probes, { now: () => now, wait: async (milliseconds) => { now += milliseconds; } });
  return { root, authority, state, api, docker, services, probes, checks, admissions, rejectProbe: (value: string) => { rejectedProbe = value; }, cleanup: () => rm(root, { recursive: true, force: true }) };
}
