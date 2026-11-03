import { constants, openSync, closeSync, fstatSync, lstatSync, readSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export class MediaConfigurationError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export const configurationError = code => new MediaConfigurationError(code);

/** Read only bounded regular files; never expose an OS error containing private paths. */
export function readProtectedFile(filename, { privateFile = false, maxBytes = 65_536 } = {}) {
  let descriptor;
  try {
    if (!path.isAbsolute(filename ?? '')) throw new Error();
    let current = path.parse(filename).root;
    for (const part of filename.slice(current.length).split(path.sep).slice(0, -1)) {
      current = path.join(current, part); if (lstatSync(current).isSymbolicLink()) throw new Error();
    }
    descriptor = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(descriptor);
    const permitted = stat => stat.isFile() && stat.nlink === 1 && (stat.uid === process.getuid() || stat.uid === 0)
      && (privateFile ? (stat.mode & 0o077) === 0 : (stat.mode & 0o022) === 0)
      && Number.isSafeInteger(stat.ino) && Number.isSafeInteger(stat.dev) && stat.size > 0 && stat.size <= maxBytes;
    if (!permitted(before)) throw new Error();
    const data = Buffer.alloc(maxBytes + 1);
    const count = readSync(descriptor, data, 0, data.length, 0);
    const after = fstatSync(descriptor), named = lstatSync(filename);
    if (count !== before.size || count > maxBytes || !permitted(after) || !permitted(named) || named.isSymbolicLink()
      || after.dev !== before.dev || after.ino !== before.ino || named.dev !== before.dev || named.ino !== before.ino
      || after.size !== before.size || named.size !== before.size || after.mtimeMs !== before.mtimeMs || named.mtimeMs !== before.mtimeMs) throw new Error();
    return { data: data.subarray(0, count), identity: `${before.dev}:${before.ino}:${before.uid}:${before.mode}` };
  } catch { throw configurationError('PROTECTED_FILE_UNAVAILABLE'); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const validUuid = value => typeof value === 'string' && uuid.test(value);
const snapshot = filename => {
  try {
    const file = readProtectedFile(filename, { privateFile: true, maxBytes: 4096 });
    const value = JSON.parse(file.data.toString('utf8'));
    if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'authority_secret,epoch_id,version'
      || value.version !== 1 || !validUuid(value.epoch_id) || typeof value.authority_secret !== 'string'
      || !/^[A-Za-z0-9_-]{43}$/.test(value.authority_secret)
      || Buffer.from(value.authority_secret, 'base64url').length !== 32
      || Buffer.from(value.authority_secret, 'base64url').toString('base64url') !== value.authority_secret) throw new Error();
    return { identity: file.identity, hash: createHash('sha256').update(file.data).digest('hex'),
      epochId: value.epoch_id.toLowerCase(), secret: value.authority_secret };
  } catch { throw configurationError('AUTHORITY_FILE_INVALID'); }
};

/** Secrets remain in this closure, absent from JSON/inspectable enumerable state. */
export function pinAuthorityFile(filename) {
  const initial = snapshot(filename);
  const assertUnchanged = () => {
    const current = snapshot(filename);
    if (current.identity !== initial.identity || current.hash !== initial.hash) throw configurationError('AUTHORITY_FILE_CHANGED');
  };
  return Object.freeze({ epochId: initial.epochId, assertUnchanged,
    withSecret: use => { assertUnchanged(); return use(initial.secret); } });
}
