import test from 'node:test';
import assert from 'node:assert/strict';
import { AdmissionController } from '../src/controller.js';

const input = (overrides = {}) => ({
  id: 'admission-1', run_id: 'run-1', generation: 1, participant_id: 'participant-1', role: 'presenter',
  lease_ms: 10_000, window_remaining_ms: 60_000, audio: { microphone: false, screen_share_audio: false }, ...overrides,
});
function fixture(options = {}) {
  let now = 0;
  const removed = [];
  const isolated = [];
  const controller = new AdmissionController({
    adapter: { removeParticipant: async (...args) => { removed.push(args); } },
    isolate: async (reason) => { isolated.push(reason); }, signalUrl: 'ws://127.0.0.1:18780', now: () => now,
    ...options,
  });
  return { controller, removed, isolated, advance: (ms) => { now += ms; } };
}
const rejects = (fn, code) => assert.throws(fn, (error) => error.code === code);

test('tickets are single-use, reject arbitrary JWTs and cannot replace a live identity', () => {
  const { controller } = fixture();
  const created = controller.create(input());
  const entry = controller.consumeTicket(created.ticket);
  controller.setConnection(entry, { destroy() {} });
  rejects(() => controller.consumeTicket(created.ticket), 'INVALID_TICKET');
  rejects(() => controller.consumeTicket('eyJ.fake.jwt'), 'INVALID_TICKET');
  rejects(() => controller.issueTicket(created.admission_id, 1), 'PARTICIPANT_STILL_CONNECTED');
  rejects(() => controller.create(input({ id: 'second' })), 'PARTICIPANT_IDENTITY_ALREADY_USED');
});

test('concurrent upgrade attempts consume one ticket exactly once', async () => {
  const { controller } = fixture();
  const { ticket } = controller.create(input());
  const attempts = await Promise.allSettled(Array.from({ length: 20 }, async () => controller.consumeTicket(ticket)));
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((result) => result.status === 'rejected').length, 19);
});

test('lease expiry removes established SFU participant even without signaling failure', async () => {
  const { controller, advance, removed } = fixture();
  const created = controller.create(input());
  const entry = controller.consumeTicket(created.ticket);
  let closed = 0;
  controller.setConnection(entry, { destroy() { closed += 1; } });
  advance(10_000);
  await controller.sweep();
  assert.equal(removed.length, 1);
  assert.equal(closed, 1);
  assert.equal(entry.state, 'REVOKED');
  rejects(() => controller.renew(entry.id, { generation: 1, lease_ms: 1000, window_remaining_ms: 60_000 }), 'ADMISSION_EXPIRED');
});

test('renewal preserves the original schedule boundary despite longer incoming authority', async () => {
  const { controller, advance, removed } = fixture();
  controller.create(input({ window_remaining_ms: 12_000 }));
  advance(6000);
  const renewed = controller.renew('admission-1', { generation: 1, lease_ms: 10_000, window_remaining_ms: 999_999 });
  assert.equal(renewed.lease_ms, 6000);
  assert.equal(renewed.window_remaining_ms, 6000);
  assert.equal(renewed.enforcement_starts_in_ms, 3000);
  advance(3000);
  await controller.sweep();
  assert.equal(removed.length, 1);
});

test('cleanup reserve begins early enough to complete failed removal and isolation within original lease', async () => {
  let now = 0;
  let actualRemovalAt;
  let isolatedAt;
  const controller = new AdmissionController({
    now: () => now, signalUrl: 'ws://127.0.0.1',
    adapter: { removeParticipant: async () => {
      actualRemovalAt = now;
      now += 2000; // Management timeout before forced node isolation.
      throw new Error('unreachable');
    } },
    isolate: async () => { now += 500; isolatedAt = now; },
  });
  const admitted = controller.create(input());
  assert.equal(admitted.requested_lease_ms, 10_000);
  assert.equal(admitted.lease_ms, 10_000);
  assert.equal(admitted.cleanup_budget_ms, 3000);
  assert.equal(admitted.enforcement_starts_in_ms, 7000);
  const entry = controller.consumeTicket(admitted.ticket);
  controller.setConnection(entry, { destroy() {} });
  now = 7100; // Includes the 100 ms sweep tolerance.
  const removing = controller.sweep();
  assert.throws(() => controller.renew(entry.id, { generation: 1, lease_ms: 10_000, window_remaining_ms: 60_000 }));
  await removing;
  assert.equal(actualRemovalAt, 7100);
  assert.equal(isolatedAt, 9600);
  assert.ok(isolatedAt <= 10_000);
});

test('cleanup reserve also caps schedule boundary and tiny windows never join', async () => {
  const { controller, advance, removed } = fixture();
  rejects(() => controller.create(input({ lease_ms: 3000 })), 'LEASE_TOO_SHORT');
  rejects(() => controller.create(input({ window_remaining_ms: 3000 })), 'AUTHORITY_WINDOW_TOO_SHORT');
  const created = controller.create(input({ window_remaining_ms: 5000 }));
  assert.equal(created.lease_ms, 5000);
  assert.equal(created.enforcement_starts_in_ms, 2000);
  advance(2000);
  await controller.sweep();
  assert.equal(removed.length, 1);
  rejects(() => controller.consumeTicket(created.ticket), 'INVALID_TICKET');
});

test('join settlement plus failed removal and node kill still fit inside full lease', async () => {
  let now = 0;
  let killedAt;
  const controller = new AdmissionController({ now: () => now, signalUrl: 'ws://127.0.0.1',
    adapter: { removeParticipant: async () => { now += 1500; throw new Error('management deadline'); } },
    isolate: async () => { now += 500; killedAt = now; },
  });
  const created = controller.create(input());
  const entry = controller.consumeTicket(created.ticket);
  let settle;
  controller.registerPendingJoin(entry, {
    settled: new Promise((resolve) => { settle = resolve; }), closeClient() {}, abort() {},
  });
  now = 7100;
  const removing = controller.sweep();
  now += 500;
  settle('CONFIRMED');
  await removing;
  assert.equal(killedAt, 9600);
  assert.ok(killedAt <= created.lease_ms);
});

test('a renewal that shortens remaining schedule below cleanup budget revokes immediately', async () => {
  const { controller } = fixture();
  controller.create(input());
  rejects(() => controller.renew('admission-1', { generation: 1, lease_ms: 10_000, window_remaining_ms: 2000 }), 'ADMISSION_EXPIRED');
  assert.equal(controller.get('admission-1').state, 'REMOVING');
  rejects(() => controller.issueTicket('admission-1', 1), 'ADMISSION_EXPIRED');
});

test('revocation during token preparation rejects the late connection and never reopens', async () => {
  const { controller } = fixture();
  const { ticket } = controller.create(input());
  const entry = controller.consumeTicket(ticket);
  await controller.revoke(entry.id);
  rejects(() => controller.setConnection(entry, { destroy() {} }), 'ADMISSION_EXPIRED');
  rejects(() => controller.issueTicket(entry.id, 1), 'ADMISSION_EXPIRED');
});

test('reconnect ticket waits for confirmed prior SFU removal', async () => {
  let finishRemoval;
  const { controller } = fixture({ adapter: { removeParticipant: () => new Promise((resolve) => { finishRemoval = resolve; }) } });
  const { ticket } = controller.create(input());
  const entry = controller.consumeTicket(ticket);
  controller.setConnection(entry, { destroy() {} });
  const cleanup = controller.disconnect(entry.id);
  rejects(() => controller.issueTicket(entry.id, 1), 'PARTICIPANT_STILL_CONNECTED');
  finishRemoval();
  await cleanup;
  const replacement = controller.issueTicket(entry.id, 1);
  assert.ok(replacement.ticket);
  rejects(() => controller.issueTicket(entry.id, 2), 'STALE_GENERATION');
});

test('removal failure isolates every room and denies new admission, even if isolation hook fails', async () => {
  const { controller, isolated } = fixture({ adapter: { removeParticipant: async () => { throw new Error('private-url-secret'); } } });
  controller.create(input());
  controller.create(input({ id: 'receiver', participant_id: 'receiver', role: 'receiver' }));
  await controller.revoke('admission-1');
  assert.deepEqual(isolated, ['PARTICIPANT_REMOVAL_FAILED']);
  assert.equal(controller.health().status, 'isolated');
  assert.equal(controller.health().isolation_complete, true);
  rejects(() => controller.create(input({ id: 'new', run_id: 'new', participant_id: 'new' })), 'MEDIA_NODE_ISOLATED');

  const failure = fixture({ adapter: { removeParticipant: async () => { throw new Error(); } }, isolate: async () => { throw new Error(); } });
  failure.controller.create(input());
  await failure.controller.revoke('admission-1');
  assert.equal(failure.controller.health().isolation_complete, false);
  assert.equal(failure.controller.health().status, 'isolated');
});

test('one presenter, 25 receivers, and ten occupied rooms are enforced synchronously', () => {
  const { controller } = fixture();
  controller.create(input());
  rejects(() => controller.create(input({ id: 'presenter-2', participant_id: 'presenter-2' })), 'PRESENTER_ALREADY_ADMITTED');
  for (let index = 0; index < 25; index += 1) controller.create(input({ id: `receiver-${index}`, participant_id: `receiver-${index}`, role: 'receiver' }));
  rejects(() => controller.create(input({ id: 'receiver-26', participant_id: 'receiver-26', role: 'receiver' })), 'RECEIVER_CAPACITY_EXCEEDED');
  for (let index = 2; index <= 10; index += 1) controller.create(input({ id: `run-${index}`, run_id: `run-${index}`, participant_id: `presenter-${index}` }));
  rejects(() => controller.create(input({ id: 'run-11', run_id: 'run-11', participant_id: 'presenter-11' })), 'RUN_CAPACITY_EXCEEDED');
});

test('runtime slot is held during teardown and released only after confirmed removal', async () => {
  let finish;
  const { controller } = fixture({ maxRuns: 1, adapter: { removeParticipant: () => new Promise((resolve) => { finish = resolve; }) } });
  controller.create(input());
  const removing = controller.revoke('admission-1');
  rejects(() => controller.create(input({ id: 'next', run_id: 'next', participant_id: 'next' })), 'RUN_CAPACITY_EXCEEDED');
  finish();
  await removing;
  assert.ok(controller.create(input({ id: 'next', run_id: 'next', participant_id: 'next' })).ticket);
});

test('an unused ticket may be replaced but old tickets never recover', () => {
  const { controller } = fixture();
  const first = controller.create(input());
  const second = controller.issueTicket(first.admission_id, 1);
  rejects(() => controller.consumeTicket(first.ticket), 'INVALID_TICKET');
  assert.ok(controller.consumeTicket(second.ticket));
});

test('replacement run generation waits for teardown and permanently fences older generation', async () => {
  const { controller } = fixture();
  controller.create(input());
  rejects(() => controller.create(input({ id: 'next', participant_id: 'next', generation: 2 })), 'PRIOR_GENERATION_STILL_OCCUPIED');
  await controller.revoke('admission-1');
  controller.create(input({ id: 'next', participant_id: 'next', generation: 2 }));
  rejects(() => controller.create(input({ id: 'late', participant_id: 'late', generation: 1 })), 'STALE_GENERATION');
});

test('invalid input never extends or allocates authority', () => {
  const { controller } = fixture();
  rejects(() => controller.create(null), 'INVALID_INPUT');
  rejects(() => controller.create(input({ lease_ms: 10_001 })), 'INVALID_LEASE');
  rejects(() => controller.create(input({ generation: 0 })), 'INVALID_GENERATION');
  rejects(() => controller.create(input({ participant_id: 'email@example.org' })), 'INVALID_ID');
  assert.equal(controller.health().active_admissions, 0);
});

test('broken signaling disposal never prevents SFU removal or node isolation', async () => {
  const { controller, removed } = fixture();
  const entry = controller.consumeTicket(controller.create(input()).ticket);
  controller.setConnection(entry, { destroy() { throw new Error('broken socket'); } });
  await controller.revoke(entry.id);
  assert.equal(removed.length, 1);
  assert.equal(entry.state, 'REVOKED');

  const failure = fixture({ adapter: { removeParticipant: async () => { throw new Error(); } } });
  const second = failure.controller.consumeTicket(failure.controller.create(input()).ticket);
  failure.controller.setConnection(second, { destroy() { throw new Error('broken socket'); } });
  await failure.controller.revoke(second.id);
  assert.equal(failure.isolated.length, 1);
});
