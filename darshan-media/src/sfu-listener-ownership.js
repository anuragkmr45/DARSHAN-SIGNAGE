import { readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { endianness } from 'node:os';

const ownershipError = code => Object.assign(new Error(code), { code });
const defaults = { read: readFileSync, list: readdirSync, link: readlinkSync, platform: process.platform, byteOrder: endianness() };

export function readSfuProcessStartTicks(pid, read = readFileSync) {
  try {
    const stat = read(`/proc/${pid}/stat`, 'utf8');
    const startTicks = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19];
    if (!stat.startsWith(`${pid} (`) || !/^\d+$/.test(startTicks ?? '')) throw ownershipError('SFU_LISTENER_OWNERSHIP_UNAVAILABLE');
    return startTicks;
  } catch { throw ownershipError('SFU_LISTENER_OWNERSHIP_UNAVAILABLE'); }
}

/** Linux-only startup fence. A TCP response alone cannot identify the spawned SFU. */
export function ownsSfuListener({ pid, host, port, startTicks, allowWildcard = false }, overrides = {}) {
  const io = { ...defaults, ...overrides };
  if (io.platform !== 'linux') throw ownershipError('SFU_LISTENER_OWNERSHIP_UNAVAILABLE');
  if (!['LE', 'BE'].includes(io.byteOrder)) throw ownershipError('SFU_LISTENER_OWNERSHIP_UNAVAILABLE');
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(port) || port < 1 || port > 65535
    || !['127.0.0.1', '::1', '[::1]'].includes(host) || !/^\d+$/.test(startTicks ?? '')) throw ownershipError('SFU_LISTENER_OWNERSHIP_UNAVAILABLE');
  try {
    if (readSfuProcessStartTicks(pid, io.read) !== startTicks) throw ownershipError('SFU_PROCESS_IDENTITY_CHANGED');
    if (io.link(`/proc/${pid}/ns/net`) !== io.link('/proc/self/ns/net')) throw ownershipError('SFU_NETWORK_NAMESPACE_MISMATCH');
    const loopback4 = io.byteOrder === 'LE' ? '0100007F' : '7F000001';
    const loopback6 = io.byteOrder === 'LE' ? '00000000000000000000000001000000' : '00000000000000000000000000000001';
    const listeners = [];
    for (const [table, loopback] of [['tcp', loopback4], ['tcp6', loopback6]]) {
      let contents;
      try { contents = io.read(`/proc/${pid}/net/${table}`, 'utf8'); }
      catch (error) {
        // IPv6-disabled kernels may not register tcp6. This does not relax
        // the required IPv4 table, owned socket, namespace or stable PID proof.
        if (table === 'tcp6' && host === '127.0.0.1' && error.code === 'ENOENT') continue;
        throw error;
      }
      const lines = contents.trim().split('\n');
      if (!lines[0]?.includes('local_address') || !lines[0]?.includes('inode')) throw ownershipError('SFU_LISTENER_OWNERSHIP_UNAVAILABLE');
      for (const line of lines.slice(1)) {
        const fields = line.trim().split(/\s+/);
        if (fields[3] !== '0A') continue;
        const [address, encodedPort] = (fields[1] ?? '').split(':');
        if (!/^[0-9A-Fa-f]{4}$/.test(encodedPort ?? '')) throw ownershipError('SFU_LISTENER_OWNERSHIP_UNAVAILABLE');
        if (Number.parseInt(encodedPort, 16) !== port) continue;
        // LiveKit applies bind_addresses to its API and UDP mux together. The
        // container profile may therefore bind both on the bridge interface;
        // the API port must remain unpublished by the deployment. Keep this
        // exception explicit and retain exact process/socket ownership checks.
        const wildcard = table === 'tcp' ? '00000000' : '00000000000000000000000000000000';
        if (address?.toUpperCase() !== loopback && !(allowWildcard && address === wildcard))
          throw ownershipError('SFU_LISTENER_NOT_PRIVATE');
        if (!/^\d+$/.test(fields[9] ?? '')) throw ownershipError('SFU_LISTENER_OWNERSHIP_UNAVAILABLE');
        listeners.push({ table, inode: fields[9] });
      }
    }
    if (!listeners.length) return false;
    const sockets = new Set();
    for (const descriptor of io.list(`/proc/${pid}/fd`)) {
      let target;
      try { target = io.link(`/proc/${pid}/fd/${descriptor}`); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      const inode = /^socket:\[(\d+)\]$/.exec(target)?.[1];
      if (inode) sockets.add(inode);
    }
    if (listeners.some(listener => !sockets.has(listener.inode))) throw ownershipError('SFU_LISTENER_NOT_OWNED');
    if (readSfuProcessStartTicks(pid, io.read) !== startTicks) throw ownershipError('SFU_PROCESS_IDENTITY_CHANGED');
    // Go can expose one dual-stack IPv6 wildcard socket for an IPv4 caller.
    // The supervisor separately proves an IPv4 loopback connection succeeds.
    return listeners.some(listener => listener.table === (host === '127.0.0.1' ? 'tcp' : 'tcp6')
      || (allowWildcard && host === '127.0.0.1' && listener.table === 'tcp6'));
  } catch (error) {
    if (error.code?.startsWith('SFU_')) throw error;
    throw ownershipError('SFU_LISTENER_OWNERSHIP_UNAVAILABLE');
  }
}
