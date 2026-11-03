import * as fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { configurationError, validUuid } from './authority-file.js';

export const HOST_LEASE_MAX_AGE_MS = 1000;
const unescapeMount = value => value.replace(/\\([0-7]{3})/g, (_match, digits) => String.fromCharCode(parseInt(digits, 8)));
const contains = (mount, filename) => mount === '/' || filename === mount || filename.startsWith(`${mount}/`);

/** Bind mounts retain the underlying tmpfs type; require its per-mount RO flag. */
export function isReadOnlyTmpfs(filename, mountinfo) {
  let selected;
  for (const line of mountinfo.trim().split('\n')) {
    const fields = line.split(' '), separator = fields.indexOf('-');
    if (separator < 6 || fields.length < separator + 4 || !/^\d+$/.test(fields[0]) || !/^\d+$/.test(fields[1])) throw configurationError('HOST_LEASE_MOUNT_INVALID');
    const mount = unescapeMount(fields[4]);
    if (!path.isAbsolute(mount)) throw configurationError('HOST_LEASE_MOUNT_INVALID');
    const options = fields[5].split(','), permitted = fields[separator + 1] === 'tmpfs' && options.includes('ro') && !options.includes('rw');
    if (contains(mount, filename) && (!selected || mount.length > selected.mount.length)) selected = { mount, permitted };
    else if (selected && mount === selected.mount) selected.permitted &&= permitted; // Ambiguous stacked mounts must all meet the policy.
  }
  return Boolean(selected?.permitted);
}

/** Separate host-owned state. Media may read this mount, never write or mint it. */
export function readHostLeaseFile(filename, io = fs) {
  let descriptor;
  try {
    if (!path.isAbsolute(filename ?? '') || path.normalize(filename) !== filename) throw new Error();
    const directory = path.dirname(filename);
    let component = path.parse(directory).root;
    for (const part of ['', ...directory.slice(component.length).split(path.sep).filter(Boolean)]) {
      if (part) component = path.join(component, part);
      const entry = io.lstatSync(component);
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.uid !== 0 || (entry.mode & 0o022) !== 0) throw new Error();
    }
    if (io.statfsSync(directory).type !== 0x01021994 || !isReadOnlyTmpfs(filename, io.readFileSync('/proc/self/mountinfo', 'utf8'))) throw new Error();
    descriptor = io.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const before = io.fstatSync(descriptor);
    // Atomic replacement can unlink an already opened, still trusted inode.
    // Hardlinked files are rejected; neither named-inode equality nor ctime
    // equality is required across a legitimate host writer's atomic rename.
    const trusted = entry => entry.isFile() && entry.uid === 0 && [0, 1].includes(entry.nlink) && (entry.mode & 0o022) === 0 &&
      Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= 4096;
    if (!trusted(before)) throw new Error();
    const buffer = Buffer.alloc(4097), count = io.readSync(descriptor, buffer, 0, buffer.length, 0), after = io.fstatSync(descriptor);
    if (!trusted(after) || count !== before.size || count > 4096 || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error();
    const value = JSON.parse(buffer.subarray(0, count).toString('utf8'));
    if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'managed_instance_id,node_instance_id,ready,sequence,version' ||
      value.version !== 1 || value.ready !== true || !validUuid(value.node_instance_id) || !validUuid(value.managed_instance_id) ||
      !Number.isSafeInteger(value.sequence) || value.sequence <= 0) throw new Error();
    return value;
  } catch { throw configurationError('HOST_LEASE_UNAVAILABLE'); }
  finally { if (descriptor !== undefined) io.closeSync(descriptor); }
}

/** Freshness is observed locally; no host timestamp can extend a media lease. */
export function createHostReadiness({ file, nodeInstanceId, managedInstanceId, onInvalid, now = () => performance.now(), readLease = () => readHostLeaseFile(file) }) {
  if (!path.isAbsolute(file ?? '') || !validUuid(nodeInstanceId) || !validUuid(managedInstanceId) || typeof onInvalid !== 'function') throw configurationError('HOST_LEASE_CONFIGURATION_REQUIRED');
  let sequence, progressAt, lastCheck, armed = false, failed = false;
  const fail = () => { if (!failed) { failed = true; onInvalid('HOST_READINESS_LOST'); } return false; };
  return Object.freeze({
    check() {
      if (failed) return false;
      const current = now();
      if (!Number.isFinite(current) || current < 0) return armed ? fail() : false;
      if (armed && (current < lastCheck || current - lastCheck > HOST_LEASE_MAX_AGE_MS || current - progressAt > HOST_LEASE_MAX_AGE_MS)) return fail();
      lastCheck = current;
      let value;
      try { value = readLease(); } catch { if (armed) return fail(); sequence = undefined; return false; }
      if (value.version !== 1 || value.node_instance_id !== nodeInstanceId || value.managed_instance_id !== managedInstanceId || value.ready !== true || !Number.isSafeInteger(value.sequence) || value.sequence <= 0) {
        if (armed) return fail(); sequence = undefined; return false;
      }
      if (sequence === undefined || !armed && current - progressAt > HOST_LEASE_MAX_AGE_MS) { sequence = value.sequence; progressAt = current; return false; }
      if (value.sequence < sequence) { if (armed) return fail(); sequence = undefined; return false; }
      if (value.sequence > sequence) { sequence = value.sequence; progressAt = current; armed = true; }
      return armed;
    },
  });
}
