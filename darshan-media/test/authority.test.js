import test from 'node:test';
import assert from 'node:assert/strict';
import { AdmissionController } from '../src/controller.js';
import { start } from '../src/index.js';

const command = (revision = 1, changes = {}) => ({ id: 'admission-1', run_id: 'run-1', generation: 1,
  node_instance_id: 'node-instance-1', authority_epoch: 'external-epoch-1', operation_revision: revision, ...changes });
const grantFor = (request, changes = {}) => ({ id: request.id, run_id: request.run_id, generation: request.generation,
  node_instance_id: request.node_instance_id, authority_epoch: request.authority_epoch,
  operation_revision: request.operation_revision, nonce: request.nonce, allowed: true, participant_id: 'server-participant-1', role: 'receiver',
  audio: { microphone: false, screen_share_audio: false }, lease_ms: 10_000, window_remaining_ms: 60_000, ...changes });
const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const code = (expected) => (error) => error.code === expected;
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

function fixture(options = {}) {
  let now = 0;
  const checked = [], removed = [], isolated = [];
  const { verifyAuthority = async request => grantFor(request), verificationTimeoutMs, authorityMode, ...rest } = options;
  const controller = new AdmissionController({ adapter: { removeParticipant: async (...args) => { removed.push(args); } },
    isolate: async reason => { isolated.push(reason); }, signalUrl: 'wss://media.example.test', now: () => now,
    ...(authorityMode === 'backend' ? { hostReadiness: { check: () => true } } : {}), // Explicit fixture; real backend uses its protected RO host lease.
    ...rest,
    strictAuthority: { mode: authorityMode, nodeInstanceId: 'node-instance-1', authorityEpoch: 'external-epoch-1', verificationTimeoutMs,
      verifyAuthority: async request => { checked.push(request); return verifyAuthority(request); } },
  });
  return { controller, checked, removed, isolated, advance: ms => { now += ms; } };
}

test('strict mode grants only canonical backend policy and denies synchronous prototype bypasses', async () => {
  const { controller, checked } = fixture();
  assert.throws(() => controller.create(command()), code('STRICT_AUTHORITY_REQUIRED'));
  const admitted = await controller.createAuthorized(command(1, { participant_id: 'caller-presenter', role: 'presenter',
    audio: { microphone: true, screen_share_audio: true }, lease_ms: 999_999 }));
  const entry = controller.get(admitted.admission_id);
  assert.equal(entry.participantId, 'server-participant-1');
  assert.equal(entry.role, 'receiver');
  assert.deepEqual(entry.audio, { microphone: false, screen_share_audio: false });
  assert.equal(checked[0].participant_id, undefined);
  assert.equal(checked[0].role, undefined);
  assert.ok(Object.isFrozen(checked[0]));
  assert.equal(admitted.node_instance_id, 'node-instance-1');
  assert.equal(admitted.authority_epoch, 'external-epoch-1');
  assert.throws(() => controller.renew(entry.id, { generation: 1 }), code('STRICT_AUTHORITY_REQUIRED'));
  assert.throws(() => controller.issueTicket(entry.id, 1), code('STRICT_AUTHORITY_REQUIRED'));
});

test('foreign node or epoch commands cannot allocate revision state or install revocation tombstones', async () => {
  for (const wrong of [{ node_instance_id: 'old-node' }, { authority_epoch: 'old-epoch' }]) {
    const { controller, checked } = fixture();
    const expected = wrong.node_instance_id ? 'MEDIA_NODE_INSTANCE_MISMATCH' : 'AUTHORITY_EPOCH_MISMATCH';
    await assert.rejects(controller.createAuthorized(command(99, wrong)), code(expected));
    await assert.rejects(controller.revokeAuthorized('admission-1', command(99, wrong)), code(expected));
    await assert.rejects(controller.revokeRunAuthorized('run-1', command(99, wrong)), code(expected));
    assert.equal(controller.health().tracked_entries, 0);
    assert.equal(checked.length, 0);
    assert.ok((await controller.createAuthorized(command())).ticket);
  }
});

test('unknown admission revocation is permanent, observable and idempotent without a ticket', async () => {
  const { controller, checked } = fixture();
  const stopped = await controller.revokeAuthorized('admission-1', command(2));
  assert.equal(stopped.teardown_confirmed, true);
  assert.equal(stopped.teardown_reason, 'ADMISSION_NEVER_CREATED');
  assert.equal(stopped.ticket, undefined);
  assert.equal(stopped.protocol_version, 1); assert.equal(stopped.run_id, 'run-1'); assert.equal(stopped.generation, 1);
  assert.deepEqual(await controller.revokeAuthorized('admission-1', command(2)), stopped);
  assert.equal(controller.admissionView('admission-1').teardown_confirmed, true);
  await assert.rejects(controller.createAuthorized(command(3)), code('ADMISSION_REVOKED'));
  assert.equal(checked.length, 0);
});

test('unknown exact-run revocation fences that generation and lower generations without touching its replacement', async () => {
  const { controller } = fixture();
  assert.equal((await controller.revokeRunAuthorized('run-1', command(2))).teardown_confirmed, true);
  await assert.rejects(controller.createAuthorized(command(3)), code('RUN_REVOKED'));
  const replacement = await controller.createAuthorized(command(1, { id: 'replacement', generation: 2 }));
  const entry = controller.consumeTicket(replacement.ticket);
  controller.setConnection(entry, { destroy() {} });
  await controller.revokeRunAuthorized('run-1', command(2));
  assert.equal(entry.state, 'CONNECTED');
  await assert.rejects(controller.createAuthorized(command(1, { id: 'old-late', generation: 1 })), code('RUN_REVOKED'));
});

for (const target of ['admission', 'run']) {
  test(`${target} stop before the first fresh verification completes prevents a delayed create`, async () => {
    const verification = pending(), started = pending();
    const { controller } = fixture({ verifyAuthority: request => { started.resolve(request); return verification.promise; } });
    const attempt = controller.createAuthorized(command()).catch(error => error);
    const request = await started.promise;
    const stopped = target === 'admission' ? await controller.revokeAuthorized('admission-1', command(2))
      : await controller.revokeRunAuthorized('run-1', command(2));
    assert.equal(stopped.teardown_confirmed, true);
    verification.resolve(grantFor(request));
    assert.equal((await attempt).code, 'AUTHORITY_CHECK_CANCELLED');
    assert.equal(controller.admissions.size, 0);
    assert.equal(controller.tickets.size, 0);
    assert.equal(controller.pendingAuthorityChecks.size, 0);
  });
}

test('same or older revision grants never rotate a ticket or replace a live connection', async () => {
  const { controller, checked, advance } = fixture();
  const first = await controller.createAuthorized(command());
  await assert.rejects(controller.createAuthorized(command()), code('STALE_OPERATION'));
  await assert.rejects(controller.issueTicketAuthorized('admission-1', command()), code('STALE_OPERATION'));
  assert.equal(checked.length, 1);
  const entry = controller.consumeTicket(first.ticket);
  controller.setConnection(entry, { destroy() {} });
  const originalDeadline = entry.deadline;
  advance(1000);
  await assert.rejects(controller.issueTicketAuthorized(entry.id, command(2)), code('PARTICIPANT_STILL_CONNECTED'));
  assert.equal(entry.state, 'CONNECTED');
  assert.equal(entry.deadline, originalDeadline);
  assert.equal(controller.tickets.size, 0);
});

test('a newer pending grant cancels the older check and its late result cannot extend the newer lease', async () => {
  const older = pending(), started = pending();
  const { controller, advance } = fixture({ verifyAuthority: request => {
    if (request.operation_revision === 2) { started.resolve(request); return older.promise; }
    return grantFor(request);
  } });
  await controller.createAuthorized(command());
  const oldRenew = controller.renewAuthorized('admission-1', command(2)).catch(error => error);
  const request = await started.promise;
  advance(1000);
  await controller.renewAuthorized('admission-1', command(3));
  const deadline = controller.get('admission-1').deadline;
  advance(1000);
  older.resolve(grantFor(request));
  assert.equal((await oldRenew).code, 'AUTHORITY_CHECK_CANCELLED');
  assert.equal(controller.get('admission-1').deadline, deadline);
  await assert.rejects(controller.renewAuthorized('admission-1', command(2)), code('STALE_OPERATION'));
});

test('fresh-verification latency consumes both the lease and approved-window budget', async () => {
  let advance;
  const runtime = fixture({ verifyAuthority: async request => { advance(2500); return grantFor(request, { window_remaining_ms: 8000 }); } });
  advance = runtime.advance;
  const admitted = await runtime.controller.createAuthorized(command());
  assert.equal(admitted.lease_ms, 5500);
  assert.equal(admitted.window_remaining_ms, 5500);
  assert.equal(admitted.enforcement_starts_in_ms, 2500);
  advance(2500);
  await runtime.controller.sweep();
  assert.equal(runtime.removed.length, 1);
  assert.equal(runtime.controller.admissionView('admission-1').teardown_confirmed, true);
});

test('a fresh check that consumes the safety budget never publishes a ticket', async () => {
  let advance;
  const runtime = fixture({ verifyAuthority: async request => { advance(7000); return grantFor(request); } });
  advance = runtime.advance;
  await assert.rejects(runtime.controller.createAuthorized(command()), code('AUTHORITY_CHECK_EXPIRED'));
  assert.equal(runtime.controller.admissions.size, 0);
  assert.equal(runtime.controller.tickets.size, 0);
});

test('fresh renewal cannot revive authority whose old cleanup boundary passed during the check', async () => {
  const verification = pending(), started = pending();
  const { controller, advance } = fixture({ verifyAuthority: request => {
    if (request.action === 'RENEW') { started.resolve(request); return verification.promise; }
    return grantFor(request);
  } });
  await controller.createAuthorized(command());
  advance(6000);
  const renewing = controller.renewAuthorized('admission-1', command(2));
  const request = await started.promise;
  advance(2000);
  verification.resolve(grantFor(request));
  await assert.rejects(renewing, code('ADMISSION_EXPIRED'));
  assert.ok(controller.get('admission-1').deadline <= 10_000);
  await controller.sweep();
  assert.equal(controller.get('admission-1').state, 'REVOKED');
});

test('every strict reconnect ticket needs a fresh current check and explicit denial removes old authority', async () => {
  let deny = false;
  const { controller, checked } = fixture({ verifyAuthority: request => grantFor(request, deny ? { allowed: false } : {}) });
  const first = await controller.createAuthorized(command());
  const second = await controller.issueTicketAuthorized('admission-1', command(2));
  assert.deepEqual(checked.map(request => request.action), ['CREATE', 'TICKET']);
  assert.throws(() => controller.consumeTicket(first.ticket), code('INVALID_TICKET'));
  deny = true;
  await assert.rejects(controller.issueTicketAuthorized('admission-1', command(3)), code('AUTHORITY_DENIED'));
  assert.throws(() => controller.consumeTicket(second.ticket), code('INVALID_TICKET'));
  assert.equal(controller.admissionView('admission-1').teardown_confirmed, true);
});

test('fresh check nonce, epoch, operation and canonical policy mismatches cannot allocate authority', async () => {
  for (const changes of [{ nonce: 'replayed-nonce' }, { authority_epoch: 'old-epoch' }, { operation_revision: 999 },
    { generation: 2 }, { role: 'administrator' }, { participant_id: 'email@example.test' }, { lease_ms: 10_001 }]) {
    const { controller } = fixture({ verifyAuthority: request => grantFor(request, changes) });
    await assert.rejects(controller.createAuthorized(command()));
    assert.equal(controller.admissions.size, 0);
    assert.equal(controller.tickets.size, 0);
  }
});

test('CREATE, RENEW and TICKET require an explicit boolean allow decision', async () => {
  for (const action of ['CREATE', 'RENEW', 'TICKET']) {
    for (const allowed of [undefined, null, 0, 1, 'false', 'true']) {
      let malformed = false;
      const { controller, advance } = fixture({ verifyAuthority: request => grantFor(request, malformed ? { allowed } : {}) });
      if (action !== 'CREATE') await controller.createAuthorized(command());
      const entry = controller.admissions.get('admission-1');
      const originalDeadline = entry?.deadline;
      const originalTicket = entry?.ticketHash;
      advance(1000);
      malformed = true;
      const attempt = action === 'CREATE' ? controller.createAuthorized(command())
        : action === 'RENEW' ? controller.renewAuthorized('admission-1', command(2)) : controller.issueTicketAuthorized('admission-1', command(2));
      await assert.rejects(attempt, code('AUTHORITY_RESPONSE_INVALID'));
      if (action === 'CREATE') assert.equal(controller.admissions.size, 0);
      else {
        assert.equal(entry.deadline, originalDeadline);
        assert.equal(entry.ticketHash, originalTicket);
      }
    }
  }
});

test('hung fresh checks abort within their bounded timeout without allocating a grant', async () => {
  let signal;
  const { controller } = fixture({ verificationTimeoutMs: 20, verifyAuthority: request => {
    signal = request.signal; return new Promise(() => {});
  } });
  await assert.rejects(controller.createAuthorized(command()), code('AUTHORITY_CHECK_TIMEOUT'));
  assert.equal(signal.aborted, true);
  assert.equal(controller.pendingAuthorityChecks.size, 0);
  assert.equal(controller.tickets.size, 0);
});

test('run teardown remains unconfirmed and occupied while SFU removal is pending', async () => {
  const removal = pending();
  const { controller } = fixture({ adapter: { removeParticipant: () => removal.promise } });
  await controller.createAuthorized(command());
  const stopping = controller.revokeRunAuthorized('run-1', command(2));
  assert.equal(controller.runView('run-1', 1).teardown_confirmed, false);
  assert.equal(controller.admissionView('admission-1').teardown_confirmed, false);
  assert.equal(controller.health().occupied_runs, 1);
  removal.resolve();
  assert.equal((await stopping).teardown_confirmed, true);
  assert.equal(controller.health().occupied_runs, 0);
});

test('logical REVOKED cannot report teardown or release capacity until isolation actually completes', async () => {
  const isolation = pending();
  const { controller } = fixture({ adapter: { removeParticipant: async () => { throw new Error('management unreachable'); } }, isolate: () => isolation.promise });
  await controller.createAuthorized(command());
  const stopping = controller.revokeRunAuthorized('run-1', command(2));
  await nextTurn();
  assert.equal(controller.get('admission-1').state, 'REVOKED');
  assert.equal(controller.admissionView('admission-1').teardown_confirmed, false);
  assert.equal(controller.runView('run-1', 1).teardown_confirmed, false);
  assert.equal(controller.health().isolation_complete, false);
  assert.equal(controller.health().occupied_runs, 1);
  isolation.resolve();
  assert.equal((await stopping).teardown_confirmed, true);
  assert.equal(controller.health().occupied_runs, 0);
});

test('failed isolation stays unconfirmed and retains the occupied run', async () => {
  const { controller } = fixture({ adapter: { removeParticipant: async () => { throw new Error(); } }, isolate: async () => { throw new Error(); } });
  await controller.createAuthorized(command());
  assert.equal((await controller.revokeRunAuthorized('run-1', command(2))).teardown_confirmed, false);
  assert.equal(controller.health().occupied_runs, 1);
});

test('state exhaustion isolates without evicting a previously acknowledged tombstone', async () => {
  const { controller, isolated } = fixture({ maxTrackedEntries: 2 });
  await controller.revokeAuthorized('admission-1', command());
  await assert.rejects(controller.revokeAuthorized('another', command(1, { id: 'another' })), code('TRACKED_STATE_CAPACITY_EXHAUSTED'));
  await nextTurn();
  assert.deepEqual(isolated, ['TRACKED_STATE_CAPACITY_EXHAUSTED']);
  assert.equal(controller.health().tracked_entries, 2);
  assert.equal(controller.admissionView('admission-1').teardown_confirmed, true);
  await assert.rejects(controller.createAuthorized(command(2)), code('MEDIA_NODE_ISOLATED'));
});

test('pending-check overload isolates and cancels prior verification instead of growing without bound', async () => {
  const started = pending();
  const { controller, isolated } = fixture({ maxPendingAuthorityChecks: 1, verifyAuthority: request => {
    started.resolve(request); return new Promise(() => {});
  } });
  const first = controller.createAuthorized(command()).catch(error => error);
  await started.promise;
  await assert.rejects(controller.createAuthorized(command(1, { id: 'another' })), code('AUTHORITY_CHECK_CAPACITY_EXHAUSTED'));
  assert.equal((await first).code, 'AUTHORITY_CHECK_CANCELLED');
  await nextTurn();
  assert.deepEqual(isolated, ['AUTHORITY_CHECK_CAPACITY_EXHAUSTED']);
  assert.equal(controller.pendingAuthorityChecks.size, 0);
});

test('unknown authority modes refuse startup before opening listeners or constructing prototype authority', async () => {
  const previous = process.env.DARSHAN_MEDIA_AUTHORITY_MODE;
  try {
    process.env.DARSHAN_MEDIA_AUTHORITY_MODE = 'production';
    await assert.rejects(start(), code('MEDIA_AUTHORITY_MODE_INVALID'));
  } finally {
    if (previous === undefined) delete process.env.DARSHAN_MEDIA_AUTHORITY_MODE;
    else process.env.DARSHAN_MEDIA_AUTHORITY_MODE = previous;
  }
});

test('backend headroom defers new runs while current run admissions and renewals remain authorized', async () => {
  const { controller, checked } = fixture({ authorityMode: 'backend', maxTrackedEntries: 5, startHeadroom: 4,
    verifyAuthority: request => grantFor(request, { participant_id: request.id }) });
  await controller.createAuthorized(command());
  assert.equal(controller.health().authority_mode, 'backend');
  assert.equal(controller.health().tracked_remaining, 3);
  assert.equal(controller.health().accepting_new_runs, false);
  await controller.createAuthorized(command(1, { id: 'second' }));
  await controller.renewAuthorized('admission-1', command(2));
  await assert.rejects(controller.createAuthorized(command(1, { id: 'next-run', run_id: 'next-run' })), code('MEDIA_NODE_MAINTENANCE_REQUIRED'));
  assert.equal(controller.health().status, 'ready'); assert.equal(controller.isolated, false);
  assert.equal(checked.length, 3);
});
