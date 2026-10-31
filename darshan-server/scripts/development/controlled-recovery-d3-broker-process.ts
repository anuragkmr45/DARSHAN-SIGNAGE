import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import { D3_ROOT } from './controlled-recovery-d3-authority';
import { D3_BROKER_NODE, D3_BROKER_ENTRY } from './controlled-recovery-d3-broker-enrollment';
import { d3BrokerAuthoritySchema, type D3BrokerAuthority } from './controlled-recovery-d3-broker-prerequisites';
import { d3BrokerProfileSchema, type D3BrokerProfile } from './controlled-recovery-d3-broker-profile';

export const brokerFailure = (code = 'CONTROLLED_RECOVERY_D3_BROKER_UNVERIFIED') => new ControlledRecoveryError(code, 'The fixed broker process, scope, sockets or protocol authority requires review.');
export interface D3BrokerProcessIdentity { pid: number; startTicks: string; executableSha256: string; moduleSha256: string; scopeSha256: string; listenPidfdId: string | null; }
export interface D3BrokerScope { verify(child?: Pick<D3BrokerProcessIdentity, 'pid' | 'startTicks'>): Promise<{ scopeSha256: string }>; }
export interface D3BrokerScopeSnapshot { transient: boolean; delegated: boolean; unit: string; invocationId: string; cgroup: string; currentCgroup: string; controllerMemory: string; controllerPids: number; controllerCpu: string; memory: string; pids: number; cpu: string; controllerIdentity: string; groupIdentity: string; processes: number[]; }
/** Pure admission contract. A real enrolled scope inspector must supply this observation; no creation/adoption. */
export function validateD3BrokerScope(profile: D3BrokerProfile, value: D3BrokerScopeSnapshot, controllerPid: number, childPid?: number) {
  if (!value.transient || !value.delegated || value.unit !== profile.scope_requirement.split('/').at(-2) || !/^[a-f0-9]{32}$/.test(value.invocationId) || value.cgroup !== profile.scope_requirement || value.currentCgroup !== value.cgroup || value.controllerMemory !== profile.controller_memory_max || value.controllerPids !== profile.controller_pids_max || value.controllerCpu !== profile.controller_cpu_max || value.memory !== profile.broker_memory_max || value.pids !== profile.broker_pids_max || value.cpu !== profile.broker_cpu_max || !/^[1-9][0-9]*:[1-9][0-9]*$/.test(value.controllerIdentity) || !/^[1-9][0-9]*:[1-9][0-9]*$/.test(value.groupIdentity) || new Set(value.processes).size !== value.processes.length || digest([...value.processes].sort((a, b) => a - b)) !== digest([controllerPid, ...(childPid ? [childPid] : [])].sort((a, b) => a - b))) throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_SCOPE_UNVERIFIED');
  return { scopeSha256: digest({ ...value, processes: undefined, currentCgroup: undefined }) };
}
/** No scope is currently enrolled. This concrete installed guard cannot create a unit/cgroup or fall back. */
export class UnenrolledD3BrokerScope implements D3BrokerScope { async verify(): Promise<never> { throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_SCOPE_NOT_ENROLLED'); } }
export function parseD3BrokerStartTicks(bytes: string, pid: number) { const at = bytes.lastIndexOf(') '); if (!Number.isSafeInteger(pid) || pid < 1 || !bytes.startsWith(`${pid} (`) || at < 3) throw brokerFailure(); const value = bytes.slice(at + 2).trim().split(/\s+/)[19]; if (!value || !/^[1-9][0-9]*$/.test(value)) throw brokerFailure(); return value; }
export async function brokerStartTicks(pid: number) { try { return parseD3BrokerStartTicks(await readFile(`/proc/${pid}/stat`, 'utf8'), pid); } catch { throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_PROCESS_IDENTITY_UNVERIFIED'); } }
export const D3_BROKER_FORWARD_ENV_NAMES = Object.freeze(['LANG', 'LC_ALL', 'NODE_ENV', 'BACKUP_BROKER_MAIN_LISTEN_FD', 'BACKUP_BROKER_RECOVERY_LISTEN_FD', 'BACKUP_BROKER_SOCKET_PATH', 'BACKUP_BROKER_RECOVERY_SOCKET_PATH', 'BACKUP_BROKER_HELPER_VERSION', 'BACKUP_BROKER_POLICY_TRUST_PATH', 'BACKUP_BROKER_POLICY_PATH', 'BACKUP_BROKER_CAPSULE_PATH', 'BACKUP_BROKER_MANIFEST_KEYRING_PATH', 'BACKUP_BROKER_MANIFEST_ACTIVE_KEY_ID', 'BACKUP_BROKER_MANIFEST_PRIVATE_KEY_PATH', 'BACKUP_REPOSITORY_ROOT', 'BACKUP_REPOSITORY_DEVICE_ID', 'BACKUP_REPOSITORY_OWNER_UID', 'BACKUP_REPOSITORY_OWNER_GID', 'BACKUP_REPOSITORY_MIN_FREE_BYTES', 'BACKUP_BROKER_SPOOL_ROOT', 'BACKUP_BROKER_SPOOL_OWNER_UID', 'BACKUP_BROKER_SPOOL_OWNER_GID', 'BACKUP_BROKER_SOCKET_UID', 'BACKUP_BROKER_SOCKET_GID']);
export function fixedD3BrokerPlan(profile: D3BrokerProfile, authority: D3BrokerAuthority) {
  d3BrokerProfileSchema.parse(profile); d3BrokerAuthoritySchema.parse(authority); if (authority.brokerProfileSha256 !== digest(profile) || authority.dependencyInventorySha256 !== profile.inventory_sha256) throw brokerFailure();
  if (authority.spoolRoot !== undefined && authority.spoolRoot !== `${D3_ROOT}/capture/spool`) throw brokerFailure();
  const env = Object.freeze({ HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C', NODE_ENV: 'production',
    BACKUP_BROKER_MAIN_LISTEN_FD: '3', BACKUP_BROKER_RECOVERY_LISTEN_FD: '4', BACKUP_BROKER_SOCKET_PATH: profile.main_socket, BACKUP_BROKER_RECOVERY_SOCKET_PATH: profile.recovery_socket, BACKUP_BROKER_HELPER_VERSION: profile.helper_version,
    BACKUP_BROKER_POLICY_TRUST_PATH: `${D3_ROOT}/capsule/public/policy-trust.json`, BACKUP_BROKER_POLICY_PATH: `${D3_ROOT}/capsule/output/policy.json`, BACKUP_BROKER_CAPSULE_PATH: `${D3_ROOT}/capsule/output/configuration.tar.age`,
    BACKUP_BROKER_MANIFEST_KEYRING_PATH: `${D3_ROOT}/capsule/public/manifest-keyring.json`, BACKUP_BROKER_MANIFEST_ACTIVE_KEY_ID: authority.manifestKeyId, BACKUP_BROKER_MANIFEST_PRIVATE_KEY_PATH: `${D3_ROOT}/capsule/private/authorities/manifest.key`,
    BACKUP_REPOSITORY_ROOT: `${D3_ROOT}/repository/tiny-d1-development/backup-repository`, BACKUP_REPOSITORY_DEVICE_ID: authority.rootDevice, BACKUP_REPOSITORY_OWNER_UID: '1000', BACKUP_REPOSITORY_OWNER_GID: '1000', BACKUP_REPOSITORY_MIN_FREE_BYTES: profile.minimum_repository_free_bytes,
    BACKUP_BROKER_SPOOL_ROOT: authority.spoolRoot ?? `${D3_ROOT}/spool`, BACKUP_BROKER_SPOOL_OWNER_UID: '1000', BACKUP_BROKER_SPOOL_OWNER_GID: '1000', BACKUP_BROKER_SOCKET_UID: '1000', BACKUP_BROKER_SOCKET_GID: '1000' });
  if (digest(Object.keys(env).filter((name) => name !== 'HOME').sort()) !== digest([...D3_BROKER_FORWARD_ENV_NAMES].sort())) throw brokerFailure();
  return Object.freeze({ executable: profile.activator, argv: Object.freeze(['--now', `--listen=${profile.main_socket}`, `--listen=${profile.recovery_socket}`, '--fdname=backup:recovery', ...D3_BROKER_FORWARD_ENV_NAMES.map((name) => `--setenv=${name}`), D3_BROKER_NODE, D3_BROKER_ENTRY]), cwd: `${D3_ROOT}/runtime-empty`, env, umask: 0o077 });
}
export interface D3OwnedBrokerProcess { readonly pid: number; readonly closed: Promise<void>; failure(): string | null; terminateAndJoin(): Promise<void>; }
export type D3BrokerSpawn = (executable: string, argv: readonly string[], options: SpawnOptions) => ChildProcess;
/** Direct spawn only. Scope and exact filesystem/dependency admission are required before calling this transport. */
export class DirectD3BrokerProcess {
  constructor(private readonly profile: D3BrokerProfile, private readonly spawnProcess: D3BrokerSpawn = spawn) {}
  start(authority: D3BrokerAuthority, signal?: AbortSignal): D3OwnedBrokerProcess {
    if (signal?.aborted) throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_CANCELLED'); const plan = fixedD3BrokerPlan(this.profile, authority); let child: ChildProcess; const old = process.umask(plan.umask);
    try { child = this.spawnProcess(plan.executable, plan.argv, { cwd: plan.cwd, env: plan.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch (cause) { if (cause instanceof ControlledRecoveryError && cause.code.includes('UNCERTAIN')) throw cause; throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_SPAWN_FAILED'); } finally { process.umask(old); }
    let reason: string | null = null, joined = false, bytes = 0, closing: Promise<void> | null = null; let complete!: () => void;
    const closed = new Promise<void>((resolve) => { complete = resolve; });
    const fail = (code: string) => { if (code.endsWith('UNCERTAIN')) reason = code; else reason ??= code; };
    child.on('error', () => fail('CONTROLLED_RECOVERY_D3_BROKER_SPAWN_FAILED'));
    const collect = (part: Buffer) => { bytes += part.length; if (bytes > this.profile.maximum_output_bytes) { fail('CONTROLLED_RECOVERY_D3_BROKER_OUTPUT_LIMIT'); void terminateAndJoin().catch(() => undefined); } };
    child.stdout?.on('data', collect); child.stderr?.on('data', collect);
    const abort = () => { fail('CONTROLLED_RECOVERY_D3_BROKER_CANCELLED'); void terminateAndJoin().catch(() => undefined); };
    child.once('close', (code: number | null) => { if (!closing) fail(code === 0 ? 'CONTROLLED_RECOVERY_D3_BROKER_PROCESS_EXITED' : 'CONTROLLED_RECOVERY_D3_BROKER_PROCESS_NONZERO'); joined = true; signal?.removeEventListener('abort', abort); complete(); });
    const terminateAndJoin = () => closing ??= (async () => { if (joined) return; const kill = (sig: NodeJS.Signals) => { if (!joined && child.exitCode === null && child.signalCode === null) child.kill(sig); };
      // Own ChildProcess handle only. No process.kill(recordedPid) and no cross-process restart signalling.
      kill('SIGTERM'); const escalate = setTimeout(() => kill('SIGKILL'), this.profile.stop_grace_ms);
      let timer: ReturnType<typeof setTimeout> | undefined; try { await Promise.race([closed, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { fail('CONTROLLED_RECOVERY_D3_BROKER_PROCESS_SETTLEMENT_UNCERTAIN'); reject(brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_PROCESS_SETTLEMENT_UNCERTAIN')); }, this.profile.join_timeout_ms); })]); }
      finally { clearTimeout(escalate); clearTimeout(timer); } })();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    if (!child.pid || !Number.isSafeInteger(child.pid)) { fail('CONTROLLED_RECOVERY_D3_BROKER_SPAWN_FAILED'); void terminateAndJoin().catch(() => undefined); throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_PROCESS_SETTLEMENT_UNCERTAIN'); }
    return { pid: child.pid, closed, failure: () => reason, terminateAndJoin };
  }
}
