import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createPrototypeAuthority } from '../authority.js';
import { randomUUID } from 'node:crypto';
import { AdmissionController } from '../../src/controller.js';
import { createControlServer } from '../../src/gateway.js';

const presenterToken = 'fixture-presenter-token-private';
const receiverToken = 'fixture-receiver-token-private';
const receiverSessionId = 'fixture-receiver-session';
const secret = 'fixture-media-control-secret-at-least-32-characters';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(t, options = {}) {
  // Keep the sweep from hiding missing authorization checks in request handlers.
  t.mock.timers.enable({ apis: ['setInterval'] });
  let clock = 0;
  const operations = [];
  const held = [];
  const allocated = new Set();
  const controller = options.realControl ? new AdmissionController({ now: () => clock,
    adapter: { removeParticipant: async () => undefined }, isolate: async () => undefined, signalUrl: 'ws://127.0.0.1:19099' }) : undefined;
  const control = controller ? createControlServer({ controller, secret }) : http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined;
    assert.equal(req.headers['x-darshan-media-secret'], secret);
    operations.push({ method: req.method, path: req.url, body });
    if (req.method === 'POST' && req.url === '/internal/admissions' && options.holdCreate && (options.holdCreate !== 'first' || held.length === 0)) {
      const gate = deferred(); held.push(gate); options.created?.resolve(); await gate.promise;
    }
    if (req.method === 'POST' && req.url === '/internal/admissions') allocated.add(body.id);
    if (req.method === 'DELETE' && options.absentDelete404) {
      const id = req.url.split('/').at(-1);
      if (!allocated.has(id)) {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'ADMISSION_NOT_FOUND' }));
      }
      allocated.delete(id);
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ signal_url: 'ws://127.0.0.1:19099', ticket: 'fixture-one-use-ticket', lease_ms: 10000 }));
  });
  control.listen(0, '127.0.0.1'); await once(control, 'listening');
  const authority = createPrototypeAuthority({ controlUrl: `http://127.0.0.1:${control.address().port}`, controlSecret: secret,
    presenterToken, receiverToken, receiverSessionId, now: () => clock, windowMs: options.windowMs ?? 60000, publicOrigin: options.publicOrigin });
  authority.server.listen(0, '127.0.0.1'); await once(authority.server, 'listening');
  const port = authority.server.address().port;
  t.after(async () => {
    for (const gate of held) gate.resolve();
    await authority.close();
    control.closeAllConnections(); await new Promise(resolve => control.close(resolve));
  });
  const call = (route, body = {}, token = presenterToken, headers = {}) => new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request({ hostname: '127.0.0.1', port, path: route, method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers } }, response => {
      const chunks = []; response.on('data', c => chunks.push(c)); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
    });
    request.on('error', reject); request.end(payload);
  });
  const requestId = randomUUID();
  let activeRun;
  const start = async (session = 'presenter-session', request_id = requestId) => {
    const response = await call('/prototype/start', { presenter_session_id: session, request_id });
    if (response.status === 200) activeRun = response.body;
    return response;
  };
  const stop = () => call('/prototype/stop', { presenter_session_id: 'presenter-session', ...activeRun });
  const receive = (extra = {}, headers = {}) => call('/prototype/authority/receiver', { receiver_session_id: receiverSessionId, reconnect: true, ...extra }, receiverToken, headers);
  return { start, stop, receive, call, operations, held, port, controller, requestId, advance: ms => { clock += ms; } };
}

test('one presenter owns a run; duplicate starts are idempotent and other sessions are denied', async t => {
  const f = await fixture(t);
  const first = await f.start(); const repeated = await f.start(); const other = await f.start('other-presenter', randomUUID());
  assert.equal(first.status, 200); assert.deepEqual(repeated.body, first.body); assert.equal(other.status, 409);
  assert.equal((await f.call('/prototype/stop', { presenter_session_id: 'other-presenter' })).status, 403);
});

test('concurrent initial receiver requests allocate exactly one admission', async t => {
  const created = deferred(); const f = await fixture(t, { holdCreate: true, created }); await f.start();
  const first = f.receive(); await created.promise;
  const second = await f.receive();
  assert.equal(second.status, 409); assert.equal(second.body.error, 'ADMISSION_PREPARING');
  f.held[0].resolve();
  const admitted = await first;
  assert.equal(admitted.status, 200); assert.equal(typeof admitted.body.presenter_identity, 'string');
  assert.equal(f.operations.filter(op => op.method === 'POST' && op.path === '/internal/admissions').length, 1);
  assert.ok(admitted.body.lease_ms <= 10000);
});

test('stopping during admission creation rejects the late grant and tears it down', async t => {
  const created = deferred(); const f = await fixture(t, { holdCreate: true, created }); await f.start();
  const pending = f.receive(); await created.promise;
  assert.equal((await f.stop()).status, 200);
  f.held[0].resolve();
  assert.equal((await pending).status, 410);
  assert.equal((await f.receive()).status, 410);
  assert.ok(f.operations.some(op => op.method === 'DELETE'));
});

test('late create reconciles an earlier stop-before-create 404 and permits a new run', async t => {
  const created = deferred(); const f = await fixture(t, { holdCreate: 'first', absentDelete404: true, created });
  await f.start();
  const pending = f.receive(); await created.promise;
  assert.equal((await f.stop()).status, 503);
  f.held[0].resolve();
  assert.equal((await pending).status, 410);
  const deletes = f.operations.filter(op => op.method === 'DELETE');
  assert.equal(deletes.length, 2);
  assert.equal(deletes[0].path, deletes[1].path);
  assert.equal((await f.start('presenter-session', randomUUID())).status, 200);
  assert.equal((await f.receive()).status, 200);
});

test('window expiry during admission creation rejects the late grant without relying on sweep', async t => {
  const created = deferred(); const f = await fixture(t, { holdCreate: true, created, windowMs: 1000 }); await f.start();
  const pending = f.receive(); await created.promise; f.advance(1000); f.held[0].resolve();
  assert.equal((await pending).status, 410);
  assert.ok(f.operations.some(op => op.method === 'DELETE'));
});

test('presenter lease expiry during admission creation rejects the late receiver grant', async t => {
  const created = deferred(); const f = await fixture(t, { holdCreate: true, created }); await f.start();
  const pending = f.receive(); await created.promise; f.advance(10000); f.held[0].resolve();
  assert.equal((await pending).status, 410);
  assert.ok(f.operations.some(op => op.method === 'DELETE'));
});

test('tokens, roles, exact receiver session, Origin and Host all gate access', async t => {
  const f = await fixture(t); await f.start();
  assert.equal((await f.call('/prototype/authority/receiver', {}, 'wrong-token')).status, 401);
  assert.equal((await f.call('/prototype/authority/receiver', { receiver_session_id: receiverSessionId }, presenterToken)).status, 403);
  assert.equal((await f.receive({ receiver_session_id: 'wrong-session' })).status, 403);
  assert.equal((await f.receive({}, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.receive({}, { Host: `evil.example:${f.port}` })).status, 403);
  assert.equal((await f.receive({}, { Origin: `http://127.0.0.1:${f.port}` })).status, 200);
  assert.equal(f.operations.filter(op => op.method === 'POST' && op.path === '/internal/admissions').length, 1);
});

test('malformed Unicode bearer credentials are denied without operation-failure response', async t => {
  const f = await fixture(t);
  const unicode = 'é'.repeat(presenterToken.length);
  const response = await f.call('/prototype/start', { presenter_session_id: 'session' }, unicode);
  assert.equal(response.status, 401);
  assert.equal(f.operations.length, 0);
});

test('HTTPS proxy accepts only its explicitly configured exact loopback origin', async t => {
  const f = await fixture(t, { publicOrigin: 'https://localhost:18444' }); await f.start();
  assert.equal((await f.receive({}, { Origin: 'https://localhost:18444' })).status, 200);
  for (const Origin of ['https://localhost:18445', 'http://localhost:18444', 'https://evil.example']) {
    assert.equal((await f.receive({}, { Origin, 'x-forwarded-host': 'localhost:18444', 'x-forwarded-proto': 'https' })).status, 403);
  }
  assert.equal((await f.receive({}, { Host: 'evil.example', Origin: 'https://localhost:18444' })).status, 403);
});

test('prototype public origin cannot enable nonlocal, non-HTTPS or ambiguous trust', () => {
  for (const publicOrigin of ['http://localhost:18444', 'https://evil.example', 'https://localhost:18444/path', 'https://localhost:18444/', 'https://a@localhost:18444', 'https://localhost:18444?x=1']) {
    assert.throws(() => createPrototypeAuthority({ publicOrigin }));
  }
});

test('real media control accepts healthy renewal and a correctly scoped reconnect ticket', async t => {
  const f = await fixture(t, { realControl: true }); await f.start();
  const first = await f.receive(); assert.equal(first.status, 200);
  const renewed = await f.receive({ reconnect: false });
  assert.equal(renewed.status, 200); assert.equal(renewed.body.ticket, undefined);
  assert.equal(renewed.body.admission_id, first.body.admission_id);
  const reconnected = await f.receive();
  assert.equal(reconnected.status, 200);
  assert.equal(f.controller.consumeTicket(reconnected.body.ticket).id, first.body.admission_id);
});

test('two concurrent reconnect requests cannot invalidate the successful caller ticket', async t => {
  const f = await fixture(t, { realControl: true }); await f.start();
  assert.equal((await f.receive()).status, 200);
  const results = await Promise.all([f.receive(), f.receive()]);
  const accepted = results.filter(result => result.status === 200);
  assert.equal(accepted.length, 1);
  assert.equal(results.filter(result => result.status === 409).length, 1);
  assert.ok(f.controller.consumeTicket(accepted[0].body.ticket));
});

test('late operations from an ended request cannot stop or join its replacement run', async t => {
  const f = await fixture(t);
  const first = await f.start(); assert.equal((await f.stop()).status, 200);
  const second = await f.start('presenter-session', randomUUID());
  assert.notEqual(first.body.run_id, second.body.run_id);
  const staleStop = await f.call('/prototype/stop', { presenter_session_id: 'presenter-session', ...first.body });
  assert.equal(staleStop.status, 409);
  const staleGrant = await f.call('/prototype/authority/presenter', { presenter_session_id: 'presenter-session', ...first.body, reconnect: true });
  assert.equal(staleGrant.status, 409);
  const replay = await f.start(); assert.deepEqual(replay.body, first.body);
  const current = await f.receive(); assert.equal(current.status, 200); assert.equal(current.body.run_id, second.body.run_id);
});
