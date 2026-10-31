import { constants } from 'node:fs';
import { open, readlink } from 'node:fs/promises';
import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import { D3_BROKER_ENTRY, D3_BROKER_NODE, type D3BrokerInventory } from './controlled-recovery-d3-broker-enrollment';
import type { D3BrokerAuthority } from './controlled-recovery-d3-broker-prerequisites';
import { brokerFailure, fixedD3BrokerPlan, parseD3BrokerStartTicks, type D3BrokerProcessIdentity, type D3BrokerScope } from './controlled-recovery-d3-broker-process';
import type { D3BrokerProfile } from './controlled-recovery-d3-broker-profile';

export interface D3BrokerProcessObservation { identity: D3BrokerProcessIdentity; phase: 'ACTIVATOR' | 'NODE'; listeners: { main: boolean; recovery: boolean }; }
export interface D3BrokerHost { owner(): Promise<{ ownerPid: number; ownerStartTicks: string }>; observe(pid: number, authority: D3BrokerAuthority): Promise<D3BrokerProcessObservation | null>; now(): number; pause(): Promise<void>; }
export function parseD3BrokerEnvironment(bytes: Buffer, pid: number, expected: Readonly<Record<string, string>>) {
  const text = bytes.toString('utf8'); if (!Buffer.from(text).equals(bytes) || !Number.isSafeInteger(pid) || pid < 1) throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_ENV_UNVERIFIED');
  const entries = text.split('\0').filter(Boolean).map((row) => { const at = row.indexOf('='); if (at < 1) throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_ENV_UNVERIFIED'); return [row.slice(0, at), row.slice(at + 1)]; }); if (new Set(entries.map(([key]) => key)).size !== entries.length) throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_ENV_UNVERIFIED');
  const env = Object.fromEntries(entries), listenPidfdId: string | null = Object.hasOwn(env, 'LISTEN_PIDFDID') ? env.LISTEN_PIDFDID! : null;
  if (listenPidfdId !== null && (!/^[1-9][0-9]{0,19}$/.test(listenPidfdId) || BigInt(listenPidfdId) > 18446744073709551615n)) throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_ENV_UNVERIFIED'); delete env.LISTEN_PIDFDID;
  if (digest(env) !== digest({ ...expected, LISTEN_PID: String(pid), LISTEN_FDS: '2', LISTEN_FDNAMES: 'backup:recovery' })) throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_ENV_UNVERIFIED'); return listenPidfdId;
}
async function bounded(path: string, maximum: number) { const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { const chunks: Buffer[] = []; let count = 0; for (;;) { const part = Buffer.alloc(Math.min(65536, maximum + 1 - count)); const read = await handle.read(part, 0, part.length, null); if (!read.bytesRead) break; count += read.bytesRead; if (count > maximum) throw brokerFailure(); chunks.push(part.subarray(0, read.bytesRead)); } return Buffer.concat(chunks); } finally { await handle.close(); } }
export function parseD3BrokerFdTable(text: string, links: { main: string; recovery: string }, paths: { main: string; recovery: string }) {
  const result = { main: false, recovery: false }; for (const role of ['main', 'recovery'] as const) { const inode = /^socket:\[([1-9][0-9]*)\]$/.exec(links[role])?.[1]; if (!inode) throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_FD_UNVERIFIED'); const rows = text.trim().split('\n').slice(1).map((line) => line.trim().split(/\s+/)).filter((row) => row[6] === inode || row[7] === paths[role]);
    if (rows.length !== 1 || rows[0]![6] !== inode || rows[0]![7] !== paths[role] || rows[0]![3] !== '00010000' || rows[0]![4] !== '0001' || rows[0]![5] !== '01' || rows[0]!.length !== 8) throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_FD_UNVERIFIED'); result[role] = true; }
  if (links.main === links.recovery) throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_FD_UNVERIFIED'); return result;
}
/** Linux read-only PID/start/executable/argv/environment/FD observer. It never signals a recorded PID. */
export class LinuxD3BrokerHost implements D3BrokerHost {
  constructor(private readonly profile: D3BrokerProfile, private readonly inventory: D3BrokerInventory, private readonly scope: D3BrokerScope) {}
  async owner() { return { ownerPid: process.pid, ownerStartTicks: parseD3BrokerStartTicks((await bounded(`/proc/${process.pid}/stat`, 65536)).toString('utf8'), process.pid) }; }
  now() { return Date.now(); }
  pause() { return new Promise<void>((resolve) => setTimeout(resolve, 50)); }
  async observe(pid: number, authority: D3BrokerAuthority): Promise<D3BrokerProcessObservation | null> { if (!Number.isSafeInteger(pid) || pid < 1) throw brokerFailure();
    try { const stat = (await bounded(`/proc/${pid}/stat`, 65536)).toString('utf8'), startTicks = parseD3BrokerStartTicks(stat, pid), executable = await readlink(`/proc/${pid}/exe`), plan = fixedD3BrokerPlan(this.profile, authority), argv = (await bounded(`/proc/${pid}/cmdline`, 65536)).toString('utf8').split('\0').filter(Boolean);
      const status = (await bounded(`/proc/${pid}/status`, 65536)).toString('utf8'); for (const field of ['Uid', 'Gid']) if (!new RegExp(`^${field}:\\s+1000\\s+1000\\s+1000\\s+1000$`, 'm').test(status)) throw brokerFailure();
      const node = executable === D3_BROKER_NODE; if (node ? digest(argv) !== digest([D3_BROKER_NODE, D3_BROKER_ENTRY]) : executable !== this.profile.activator || digest(argv) !== digest([plan.executable, ...plan.argv])) throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_EXEC_UNVERIFIED');
      const scope = await this.scope.verify({ pid, startTicks }); const executableSha256 = this.inventory.files.find(({ path }) => path === executable)?.sha256, moduleSha256 = this.inventory.files.find(({ path }) => path === D3_BROKER_ENTRY)?.sha256; if (!executableSha256 || !moduleSha256) throw brokerFailure();
      let listeners = { main: false, recovery: false }, listenPidfdId: string | null = null; if (node) {
        listenPidfdId = parseD3BrokerEnvironment(await bounded(`/proc/${pid}/environ`, 65536), pid, plan.env);
        listeners = parseD3BrokerFdTable((await bounded(`/proc/${pid}/net/unix`, 2097152)).toString('utf8'), { main: await readlink(`/proc/${pid}/fd/3`), recovery: await readlink(`/proc/${pid}/fd/4`) }, { main: this.profile.main_socket, recovery: this.profile.recovery_socket });
      }
      if (parseD3BrokerStartTicks((await bounded(`/proc/${pid}/stat`, 65536)).toString('utf8'), pid) !== startTicks || await readlink(`/proc/${pid}/exe`) !== executable) throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_PROCESS_IDENTITY_UNVERIFIED');
      return { identity: { pid, startTicks, executableSha256, moduleSha256, scopeSha256: scope.scopeSha256, listenPidfdId }, phase: node ? 'NODE' : 'ACTIVATOR', listeners };
    } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null; if (cause instanceof ControlledRecoveryError) throw cause; throw brokerFailure('CONTROLLED_RECOVERY_D3_BROKER_PROCESS_IDENTITY_UNVERIFIED'); }
  }
}
