import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { createHostReadiness, readHostLeaseFile, isReadOnlyTmpfs } from '../src/host-readiness.js';
import { AdmissionController } from '../src/controller.js';

const node = randomUUID(), managed = randomUUID();
const pulse = sequence => ({ version: 1, node_instance_id: node, managed_instance_id: managed, sequence, ready: true });
const mount = '20 1 0:4 / / rw - overlay overlay rw\n21 20 0:5 / /run ro - tmpfs tmpfs rw\n22 21 0:5 / /run/host\\040lease ro - tmpfs tmpfs rw';
function fixture() {
  let now = 0, value = pulse(1), failure;
  const invalid = [];
  const gate = createHostReadiness({ file: '/run/host lease/lease.json', nodeInstanceId: node, managedInstanceId: managed, now: () => now,
    readLease: () => { if (failure) throw new Error('Fixture unavailable'); return value; }, onInvalid: reason => invalid.push(reason) });
  return { gate, invalid, set: changed => { value = changed; }, advance: amount => { now += amount; }, unreadable: () => { failure = true; },
    arm: () => { assert.equal(gate.check(), false); now += 100; value = pulse(2); assert.equal(gate.check(), true); } };
}
test('read-only tmpfs proof uses the deepest component mount and decodes kernel octal path escapes', () => {
  assert.equal(isReadOnlyTmpfs('/run/host lease/lease.json', mount), true);
  assert.equal(isReadOnlyTmpfs('/run/host lease/lease.json', `${mount}\n23 22 8:1 / /run/host\\040lease rw - ext4 /dev/test rw`), false);
  assert.equal(isReadOnlyTmpfs('/runtime/lease.json', mount), false);
  assert.throws(() => isReadOnlyTmpfs('/run/lease.json', 'malformed'));
});
function fileFixture() {
  let value = pulse(1), statChanges = {}, dirChanges = {}, afterChanges = {}, mountinfo = mount;
  const metadata = () => ({ isFile: () => true, uid: 0, mode: 0o100644, nlink: 1, dev: 1, ino: 2, mtimeMs: 1, size: Buffer.byteLength(JSON.stringify(value)), ...statChanges });
  let reads = 0, openedFlags;
  const io = { lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false, uid: 0, mode: 0o40755, ...dirChanges }),
    statfsSync: () => ({ type: 0x01021994 }), readFileSync: () => mountinfo, openSync: (_file, flags) => { reads = 0; openedFlags = flags; return 10; },
    fstatSync: () => ({ ...metadata(), ...(reads++ ? afterChanges : {}) }), readSync: (_fd, buffer) => buffer.write(JSON.stringify(value)), closeSync: () => {} };
  return { io, flags: () => openedFlags, stat: changed => { statChanges = changed; }, directory: changed => { dirChanges = changed; }, after: changed => { afterChanges = changed; },
    data: changed => { value = changed; }, mount: changed => { mountinfo = changed; } };
}
test('host file requires root-owned nonwritable regular bounded bytes on an actual RO tmpfs mount and tolerates opened atomic-replace unlink', () => {
  const f = fileFixture(); assert.deepEqual(readHostLeaseFile('/run/host lease/lease.json', f.io), pulse(1));
  assert.ok(f.flags() & constants.O_NOFOLLOW); assert.ok(f.flags() & constants.O_NONBLOCK);
  f.after({ nlink: 0 }); assert.deepEqual(readHostLeaseFile('/run/host lease/lease.json', f.io), pulse(1)); f.after({});
  for (const changes of [{ uid: 1000 }, { mode: 0o100666 }, { nlink: 2 }, { size: 4097 }, { isFile: () => false }]) {
    f.stat(changes); assert.throws(() => readHostLeaseFile('/run/host lease/lease.json', f.io), error => error.code === 'HOST_LEASE_UNAVAILABLE');
  }
  f.stat({}); f.directory({ uid: 1000 }); assert.throws(() => readHostLeaseFile('/run/host lease/lease.json', f.io));
  f.directory({ mode: 0o40777 }); assert.throws(() => readHostLeaseFile('/run/host lease/lease.json', f.io));
  f.directory({ isSymbolicLink: () => true }); assert.throws(() => readHostLeaseFile('/run/host lease/lease.json', f.io));
  f.directory({}); f.mount(mount.replaceAll(' ro ', ' rw ')); assert.throws(() => readHostLeaseFile('/run/host lease/lease.json', f.io));
});
test('file mutation, invalid schema and readiness false cannot form host readiness', () => {
  const f = fileFixture(); f.after({ mtimeMs: 2 }); assert.throws(() => readHostLeaseFile('/run/host lease/lease.json', f.io)); f.after({});
  for (const changes of [{ version: 2 }, { ready: false }, { sequence: 0 }, { sequence: Number.MAX_SAFE_INTEGER + 1 }, { extra: true }, { node_instance_id: 'invalid' }]) {
    f.data({ ...pulse(1), ...changes }); assert.throws(() => readHostLeaseFile('/run/host lease/lease.json', f.io));
  }
});
test('startup waits for two advancing exact-boot pulses; static and old-boot files never arm', () => {
  const f = fixture(); assert.equal(f.gate.check(), false); f.advance(200); assert.equal(f.gate.check(), false);
  f.set({ ...pulse(2), node_instance_id: randomUUID() }); assert.equal(f.gate.check(), false);
  f.set(pulse(3)); assert.equal(f.gate.check(), false); f.advance(100); f.set(pulse(4)); assert.equal(f.gate.check(), true); assert.deepEqual(f.invalid, []);
});
for (const failure of ['stale', 'read', 'regression', 'wrong boot', 'wrong managed', 'clock gap', 'clock backwards']) {
  test(`armed ${failure} permanently isolates and cannot re-arm with new pulses`, () => {
    const f = fixture(); f.arm();
    if (failure === 'stale') { for (let count = 0; count < 11; count++) { f.advance(100); f.gate.check(); } }
    if (failure === 'read') f.unreadable();
    if (failure === 'regression') f.set(pulse(1));
    if (failure === 'wrong boot') f.set({ ...pulse(3), node_instance_id: randomUUID() });
    if (failure === 'wrong managed') f.set({ ...pulse(3), managed_instance_id: randomUUID() });
    if (failure === 'clock gap') { f.advance(1001); f.set(pulse(3)); }
    if (failure === 'clock backwards') f.advance(-1);
    assert.equal(f.gate.check(), false); f.set(pulse(100)); assert.equal(f.gate.check(), false); assert.deepEqual(f.invalid, ['HOST_READINESS_LOST']);
  });
}
test('backend grants fail closed without a gate, while explicit injected-strict protocol tests remain ungated', async () => {
  const options = { adapter: {}, isolate: async () => {}, signalUrl: 'wss://test.invalid', strictAuthority: { mode: 'backend', nodeInstanceId: node, authorityEpoch: randomUUID(), verifyAuthority: async () => { throw new Error('Must not call'); } } };
  const controller = new AdmissionController(options); assert.equal(controller.health().status, 'starting'); assert.equal(controller.health().accepting_new_runs, false);
  await assert.rejects(controller.createAuthorized({ id: 'id', run_id: 'run', generation: 1, operation_revision: 1, node_instance_id: node, authority_epoch: options.strictAuthority.authorityEpoch }), error => error.code === 'MEDIA_HOST_NOT_READY');
  const fixtureController = new AdmissionController({ ...options, strictAuthority: { ...options.strictAuthority, mode: 'strict-injected' } }); assert.equal(fixtureController.health().status, 'ready');
});
test('a delayed fresh Backend grant cannot publish after its independent host lease expires', async () => {
  let now = 0, value = pulse(1), resolveGrant, began;
  const started = new Promise(resolve => { began = resolve; }), pending = new Promise(resolve => { resolveGrant = resolve; });
  let controller;
  const gate = createHostReadiness({ file: '/run/host/lease.json', nodeInstanceId: node, managedInstanceId: managed, now: () => now, readLease: () => value,
    onInvalid: () => { void controller.isolateNode('HOST_READINESS_LOST'); } });
  gate.check(); now = 100; value = pulse(2); assert.equal(gate.check(), true);
  const epoch = randomUUID(); controller = new AdmissionController({ adapter: {}, isolate: async () => {}, signalUrl: 'wss://test.invalid', hostReadiness: gate,
    strictAuthority: { mode: 'backend', nodeInstanceId: node, authorityEpoch: epoch, verifyAuthority: request => { began(request); return pending; } } });
  const operation = controller.createAuthorized({ id: 'id', run_id: 'run', generation: 1, operation_revision: 1, node_instance_id: node, authority_epoch: epoch });
  const request = await started; now = 1200; value = pulse(3);
  resolveGrant({ ...request, allowed: true, participant_id: 'participant', role: 'receiver', audio: { microphone: false, screen_share_audio: false }, lease_ms: 10000, window_remaining_ms: 60000 });
  await assert.rejects(operation, error => ['MEDIA_HOST_NOT_READY', 'MEDIA_NODE_ISOLATED'].includes(error.code));
  assert.equal(controller.isolated, true); assert.equal(controller.admissions.size, 0); assert.equal(controller.tickets.size, 0);
});
test('host readiness loss denies signaling immediately but retains occupied capacity until independent isolation completes', async () => {
  let now = 0, value = pulse(1), controller, confirmDeath;
  const isolated = new Promise(resolve => { confirmDeath = resolve; });
  const gate = createHostReadiness({ file: '/run/host/lease.json', nodeInstanceId: node, managedInstanceId: managed, now: () => now,
    readLease: () => value, onInvalid: () => { void controller.isolateNode('HOST_READINESS_LOST'); } });
  gate.check(); now = 100; value = pulse(2); gate.check(); const epoch = randomUUID();
  controller = new AdmissionController({ adapter: {}, isolate: () => isolated, signalUrl: 'wss://test.invalid', hostReadiness: gate,
    strictAuthority: { mode: 'backend', nodeInstanceId: node, authorityEpoch: epoch, verifyAuthority: async request => ({ ...request, allowed: true,
      participant_id: 'participant', role: 'receiver', audio: { microphone: false, screen_share_audio: false }, lease_ms: 10000, window_remaining_ms: 60000 }) } });
  const admission = await controller.createAuthorized({ id: 'id', run_id: 'run', generation: 1, operation_revision: 1, node_instance_id: node, authority_epoch: epoch });
  now = 1200; value = pulse(3); assert.throws(() => controller.consumeTicket(admission.ticket), error => error.code === 'MEDIA_HOST_NOT_READY');
  assert.equal(controller.isolated, true); assert.equal(controller.occupiedAdmissions().length, 1); assert.equal(controller.runView('run', 1).teardown_confirmed, false);
  confirmDeath(); await controller.isolationPromise; assert.equal(controller.admissionView('id').teardown_confirmed, true); assert.equal(controller.occupiedAdmissions().length, 0);
  assert.equal(controller.runView('run', 1).teardown_confirmed, false); // A run-level revoke is still a separate explicit authority command.
});
