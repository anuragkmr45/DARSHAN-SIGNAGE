import test from 'node:test';
import assert from 'node:assert/strict';
import { ownsSfuListener, readSfuProcessStartTicks } from '../src/sfu-listener-ownership.js';

const target = { pid: 42, host: '127.0.0.1', port: 19781, startTicks: '12345' };
const table = (...rows) => `  sl  local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n${rows.join('\n')}\n`;
const listener = (address = '0100007F', inode = '9001') => `0: ${address}:4D45 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 ${inode} 1 0000000000000000 100 0 0 10 0`;
const stat = (start = '12345') => `42 (livekit (server)) S ${Array(18).fill('0').join(' ')} ${start} 0 0`;
const failure = expected => error => error.code === expected;
function fixture(tcp = table(listener()), tcp6 = table()) {
  const files = { '/proc/42/stat': stat(), '/proc/42/net/tcp': tcp, '/proc/42/net/tcp6': tcp6 };
  return { files, io: { platform: 'linux', byteOrder: 'LE',
    read: file => { if (!(file in files)) throw Object.assign(new Error(), { code: 'ENOENT' }); return files[file]; },
    list: () => ['7'], link: file => file.endsWith('/ns/net') ? 'net:[1001]' : 'socket:[9001]',
  } };
}

test('ownership requires the exact listening inode on the pinned SFU child and handles process names safely', () => {
  const { io } = fixture();
  assert.equal(readSfuProcessStartTicks(42, io.read), '12345');
  assert.equal(ownsSfuListener(target, io), true);
  assert.equal(ownsSfuListener(target, fixture(table()).io), false);
  assert.throws(() => ownsSfuListener(target, { ...io, link: file => file.endsWith('/ns/net') ? 'net:[1001]' : 'socket:[9999]' }), failure('SFU_LISTENER_NOT_OWNED'));
});

test('wildcard or non-loopback SFU listeners are rejected even when owned by the child', () => {
  for (const address of ['00000000', '0101A8C0']) {
    assert.throws(() => ownsSfuListener(target, fixture(table(listener(address))).io), failure('SFU_LISTENER_NOT_PRIVATE'));
  }
  assert.throws(() => ownsSfuListener(target, fixture(table(), table(listener('00000000000000000000000000000000'))).io), failure('SFU_LISTENER_NOT_PRIVATE'));
});

test('container wildcard exception still requires the pinned SFU socket and rejects specific non-loopback binds', () => {
  const wildcard = fixture(table(listener('00000000')));
  assert.equal(ownsSfuListener({ ...target, allowWildcard: true }, wildcard.io), true);
  assert.equal(ownsSfuListener({ ...target, allowWildcard: true },
    fixture(table(), table(listener('00000000000000000000000000000000'))).io), true);
  assert.throws(() => ownsSfuListener({ ...target, allowWildcard: true }, fixture(table(listener('0101A8C0'))).io), failure('SFU_LISTENER_NOT_PRIVATE'));
  assert.throws(() => ownsSfuListener({ ...target, allowWildcard: true }, { ...wildcard.io,
    link: file => file.endsWith('/ns/net') ? 'net:[1001]' : 'socket:[9999]' }), failure('SFU_LISTENER_NOT_OWNED'));
});

test('IPv6 loopback and native byte order are checked without admitting the wrong address family', () => {
  const ipv6 = fixture(table(), table(listener('00000000000000000000000001000000')));
  assert.equal(ownsSfuListener({ ...target, host: '[::1]' }, ipv6.io), true);
  assert.equal(ownsSfuListener(target, ipv6.io), false);
  const bigEndian = fixture(table(listener('7F000001')));
  assert.equal(ownsSfuListener(target, { ...bigEndian.io, byteOrder: 'BE' }), true);
});

test('PID identity or network namespace changes cannot validate a replacement endpoint', () => {
  const { io } = fixture();
  assert.throws(() => ownsSfuListener(target, { ...io, link: file => file === '/proc/42/ns/net' ? 'net:[2002]' : 'net:[1001]' }), failure('SFU_NETWORK_NAMESPACE_MISMATCH'));
  let reads = 0;
  assert.throws(() => ownsSfuListener(target, { ...io, read: file => file === '/proc/42/stat' ? stat(++reads === 1 ? '12345' : '67890') : io.read(file) }), failure('SFU_PROCESS_IDENTITY_CHANGED'));
});

test('unsupported platform, missing proc data and read-denied ownership proof all fail closed', () => {
  const { io } = fixture();
  assert.throws(() => ownsSfuListener(target, { ...io, platform: 'win32' }), failure('SFU_LISTENER_OWNERSHIP_UNAVAILABLE'));
  for (const errorCode of ['ENOENT', 'EACCES']) {
    assert.throws(() => ownsSfuListener(target, { ...io, read: () => { throw Object.assign(new Error('private path'), { code: errorCode }); } }), failure('SFU_LISTENER_OWNERSHIP_UNAVAILABLE'));
  }
  assert.throws(() => ownsSfuListener(target, { ...io, list: () => { throw Object.assign(new Error(), { code: 'EACCES' }); } }), failure('SFU_LISTENER_OWNERSHIP_UNAVAILABLE'));
  assert.throws(() => ownsSfuListener(target, { ...io, link: () => { throw Object.assign(new Error(), { code: 'EACCES' }); } }), failure('SFU_LISTENER_OWNERSHIP_UNAVAILABLE'));
});

test('absent tcp6 supports IPv4-only kernels while preserving exact owned IPv4 proof', () => {
  const missing = fixture(); delete missing.files['/proc/42/net/tcp6'];
  assert.equal(ownsSfuListener(target, missing.io), true);
  assert.throws(() => ownsSfuListener({ ...target, host: '::1' }, missing.io), failure('SFU_LISTENER_OWNERSHIP_UNAVAILABLE'));
  assert.throws(() => ownsSfuListener(target, { ...missing.io, link: file => file.endsWith('/ns/net') ? 'net:[1001]' : 'socket:[9999]' }), failure('SFU_LISTENER_NOT_OWNED'));
  assert.throws(() => ownsSfuListener(target, { ...missing.io, read: file => {
    if (file.endsWith('/tcp6')) throw Object.assign(new Error(), { code: 'EACCES' }); return missing.io.read(file);
  } }), failure('SFU_LISTENER_OWNERSHIP_UNAVAILABLE'));
  delete missing.files['/proc/42/net/tcp'];
  assert.throws(() => ownsSfuListener(target, missing.io), failure('SFU_LISTENER_OWNERSHIP_UNAVAILABLE'));
});

test('malformed existing kernel data and ambiguous listeners never establish readiness', () => {
  assert.throws(() => ownsSfuListener(target, fixture('malformed').io), failure('SFU_LISTENER_OWNERSHIP_UNAVAILABLE'));
  assert.throws(() => ownsSfuListener(target, fixture(table(listener()), 'malformed').io), failure('SFU_LISTENER_OWNERSHIP_UNAVAILABLE'));
  assert.throws(() => ownsSfuListener(target, fixture(table(listener(), listener('0100007F', '9002'))).io), failure('SFU_LISTENER_NOT_OWNED'));
});
