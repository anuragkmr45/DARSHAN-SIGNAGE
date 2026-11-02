import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { AdmissionController } from '../src/controller.js';
import { createControlServer, createSignalServer } from '../src/gateway.js';

const secret = 'test-only-control-secret-of-at-least-32-characters';
const input = (overrides = {}) => ({ id: 'admission-1', run_id: 'run-1', generation: 1,
  participant_id: 'participant-1', role: 'presenter', lease_ms: 10_000, window_remaining_ms: 60_000,
  audio: { microphone: false, screen_share_audio: false }, ...overrides });
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => { server.closeConnections?.(); server.closeAllConnections?.(); server.close(resolve); });
async function rawUpgrade(port, token, origin = 'https://cms.example.test', path = '/rtc') {
  const socket = net.connect(port, '127.0.0.1');
  let response = '';
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('upgrade timeout')); }, 2000);
    socket.on('data', (data) => {
      response += data.toString();
      if (response.includes('\r\n\r\n')) { clearTimeout(timer); resolve({ socket, response }); }
    });
    socket.on('error', reject);
    socket.on('close', () => { clearTimeout(timer); resolve({ socket, response }); });
  });
  socket.on('connect', () => {
    socket.write(`GET ${path}?access_token=${encodeURIComponent(token)}&protocol=15 HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nOrigin: ${origin}\r\n\r\n`);
  });
  return result;
}

test('private control API authenticates all routes, rejects browser origin, and is absent publicly', async (t) => {
  const adapter = { removeParticipant: async () => {}, confirmParticipant: async () => {}, createToken: async () => 'private.jwt.value' };
  const controller = new AdmissionController({ adapter, isolate: async () => {}, signalUrl: 'ws://127.0.0.1' });
  const control = createControlServer({ controller, secret });
  const signal = createSignalServer({ controller, adapter, upstreamUrl: 'http://127.0.0.1:1' });
  const controlPort = await listen(control);
  const signalPort = await listen(signal);
  t.after(async () => { await close(control); await close(signal); });
  assert.equal((await fetch(`http://127.0.0.1:${controlPort}/internal/health`)).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${controlPort}/internal/health`, { headers: { 'x-darshan-media-secret': secret, Origin: 'https://cms.example.test' } })).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${signalPort}/internal/health`, { headers: { 'x-darshan-media-secret': secret } })).status, 404);
  const created = await fetch(`http://127.0.0.1:${controlPort}/internal/admissions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-darshan-media-secret': secret }, body: JSON.stringify(input()),
  });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(body.run_id, 'run-1');
  assert.ok(body.ticket);
  assert.equal(body.token, undefined);
  const renewed = await fetch(`http://127.0.0.1:${controlPort}/internal/admissions/admission-1/renew`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-darshan-media-secret': secret },
    body: JSON.stringify({ generation: 1, lease_ms: 10_000, window_remaining_ms: 50_000 }),
  });
  assert.equal(renewed.status, 200);
  assert.equal((await renewed.json()).ticket, undefined);
});

test('gateway translates the single-use ticket to internal JWT and denies refreshed JWT replay', async (t) => {
  let upstreamToken;
  let upgrades = 0;
  const remoteSockets = new Set();
  const upstream = http.createServer();
  upstream.on('upgrade', (request, socket) => {
    upgrades += 1;
    upstreamToken = new URL(request.url, 'http://upstream').searchParams.get('access_token');
    remoteSockets.add(socket);
    socket.on('close', () => remoteSockets.delete(socket));
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
  });
  const upstreamPort = await listen(upstream);
  let removals = 0;
  const adapter = { createToken: async () => 'internal.jwt.secret', confirmParticipant: async () => {}, removeParticipant: async () => { removals += 1; } };
  const controller = new AdmissionController({ adapter, isolate: async () => {}, signalUrl: 'ws://127.0.0.1' });
  const gateway = createSignalServer({ controller, adapter, upstreamUrl: `http://127.0.0.1:${upstreamPort}`, allowedOrigins: ['https://cms.example.test'] });
  const gatewayPort = await listen(gateway);
  t.after(async () => { gateway.closeConnections(); for (const socket of remoteSockets) socket.destroy(); await close(gateway); await close(upstream); });
  const { ticket } = controller.create(input());
  const first = await rawUpgrade(gatewayPort, ticket);
  assert.match(first.response, /101 Switching Protocols/);
  assert.equal(upstreamToken, 'internal.jwt.secret');
  assert.equal(controller.get('admission-1').state, 'CONNECTED');
  const replay = await rawUpgrade(gatewayPort, ticket);
  assert.doesNotMatch(replay.response, /101 Switching Protocols/);
  const refreshed = await rawUpgrade(gatewayPort, 'internal.jwt.secret');
  assert.doesNotMatch(refreshed.response, /101 Switching Protocols/);
  assert.equal(upgrades, 1);
  const closed = once(first.socket, 'close');
  await controller.revoke('admission-1');
  await closed;
  assert.equal(removals, 1);
  assert.equal(first.socket.destroyed, true);
});

test('denied origin does not consume its ticket', async (t) => {
  const adapter = { createToken: async () => 'internal.jwt', confirmParticipant: async () => {}, removeParticipant: async () => {} };
  const controller = new AdmissionController({ adapter, isolate: async () => {}, signalUrl: 'ws://127.0.0.1' });
  const gateway = createSignalServer({ controller, adapter, upstreamUrl: 'http://127.0.0.1:1', allowedOrigins: ['https://cms.example.test'] });
  const port = await listen(gateway);
  t.after(() => close(gateway));
  const { ticket } = controller.create(input());
  const result = await rawUpgrade(port, ticket, 'https://unapproved.example.test');
  assert.doesNotMatch(result.response, /101 Switching Protocols/);
  assert.equal(controller.get('admission-1').state, 'ISSUED');
  assert.ok(controller.consumeTicket(ticket));
});

test('revocation while upstream token work is pending never establishes a late connection', async (t) => {
  let releaseToken;
  const adapter = { createToken: () => new Promise((resolve) => { releaseToken = resolve; }), confirmParticipant: async () => {}, removeParticipant: async () => {} };
  const controller = new AdmissionController({ adapter, isolate: async () => {}, signalUrl: 'ws://127.0.0.1' });
  const gateway = createSignalServer({ controller, adapter, upstreamUrl: 'http://127.0.0.1:1', allowedOrigins: ['https://cms.example.test'] });
  const port = await listen(gateway);
  t.after(() => close(gateway));
  const { ticket } = controller.create(input());
  const attempt = rawUpgrade(port, ticket);
  while (!releaseToken) await new Promise((resolve) => setTimeout(resolve, 1));
  await controller.revoke('admission-1');
  releaseToken('internal.jwt');
  assert.doesNotMatch((await attempt).response, /101 Switching Protocols/);
  assert.equal(controller.get('admission-1').state, 'REVOKED');
});

test('upstream signaling cannot be a public or credential-bearing target', () => {
  assert.throws(() => createSignalServer({ controller: {}, adapter: {}, upstreamUrl: 'http://192.0.2.1:7880' }), /loopback/);
  assert.throws(() => createSignalServer({ controller: {}, adapter: {}, upstreamUrl: 'http://secret@127.0.0.1:7880' }), /loopback/);
});

test('SDK v1 validation does not consume tickets; v1 upgrade supports explicitly allowed Electron origins', async (t) => {
  const remoteSockets = new Set();
  const upstream = http.createServer();
  upstream.on('upgrade', (request, socket) => {
    assert.equal(new URL(request.url, 'http://upstream').pathname, '/rtc/v1');
    remoteSockets.add(socket);
    socket.on('close', () => remoteSockets.delete(socket));
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
  });
  const upstreamPort = await listen(upstream);
  const adapter = { createToken: async () => 'internal.jwt', confirmParticipant: async () => {}, removeParticipant: async () => {} };
  const controller = new AdmissionController({ adapter, isolate: async () => {}, signalUrl: 'ws://127.0.0.1' });
  const gateway = createSignalServer({ controller, adapter, upstreamUrl: `http://127.0.0.1:${upstreamPort}`, allowedOrigins: ['null', 'file://'] });
  const port = await listen(gateway);
  t.after(async () => { gateway.closeConnections(); for (const socket of remoteSockets) socket.destroy(); await close(gateway); await close(upstream); });
  for (const [index, origin] of ['null', 'file://'].entries()) {
    const { ticket } = controller.create(input({ id: `a-${index}`, run_id: `run-${index}`, participant_id: `p-${index}` }));
    const url = `http://127.0.0.1:${port}/rtc/v1/validate?access_token=${ticket}`;
    const validated = await fetch(url, { headers: { Origin: origin } });
    assert.equal(validated.status, 200);
    assert.equal(validated.headers.get('access-control-allow-origin'), origin);
    assert.equal(controller.get(`a-${index}`).state, 'ISSUED');
    const connected = await rawUpgrade(port, ticket, origin, '/rtc/v1');
    assert.match(connected.response, /101 Switching Protocols/);
    assert.equal((await fetch(url, { headers: { Origin: origin } })).status, 401);
  }
  assert.equal((await fetch(`http://127.0.0.1:${port}/rtc/v1/validate?access_token=internal.jwt`, { headers: { Origin: 'null' } })).status, 401);
});

test('client cancellation waits for a delayed actual HTTP upgrade and late participant registration before removal', async (t) => {
  let joinStarted;
  const sawJoin = new Promise((resolve) => { joinStarted = resolve; });
  let registered;
  const registration = new Promise((resolve) => { registered = resolve; });
  let participantExists = false;
  let removesBeforeRegistration = 0;
  let removalFinished;
  const removed = new Promise((resolve) => { removalFinished = resolve; });
  const upstream = http.createServer();
  const remoteSockets = new Set();
  upstream.on('upgrade', (_request, socket) => {
    remoteSockets.add(socket);
    socket.on('close', () => remoteSockets.delete(socket));
    joinStarted();
    setTimeout(() => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      setTimeout(() => { participantExists = true; registered(); }, 40);
    }, 80);
  });
  const upstreamPort = await listen(upstream);
  const adapter = {
    createToken: async () => 'internal.jwt',
    confirmParticipant: async () => { await registration; },
    removeParticipant: async () => {
      if (!participantExists) removesBeforeRegistration += 1;
      participantExists = false;
      removalFinished();
    },
  };
  const controller = new AdmissionController({ adapter, isolate: async () => assert.fail('Confirmed late join should be removable'), signalUrl: 'ws://127.0.0.1', maxRuns: 1 });
  const gateway = createSignalServer({ controller, adapter, upstreamUrl: `http://127.0.0.1:${upstreamPort}`, allowedOrigins: ['https://cms.example.test'] });
  const port = await listen(gateway);
  t.after(async () => { gateway.closeConnections(); for (const socket of remoteSockets) socket.destroy(); await close(gateway); await close(upstream); });
  const { ticket } = controller.create(input());
  const client = net.connect(port, '127.0.0.1');
  client.on('error', () => {});
  client.on('connect', () => client.write(`GET /rtc?access_token=${ticket} HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nOrigin: https://cms.example.test\r\n\r\n`));
  await sawJoin;
  client.destroy();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(controller.get('admission-1').state, 'REMOVING');
  assert.throws(() => controller.issueTicket('admission-1', 1), /PARTICIPANT_STILL_CONNECTED/);
  await removed;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(removesBeforeRegistration, 0);
  assert.equal(participantExists, false);
  assert.equal(controller.get('admission-1').state, 'IDLE');
  assert.equal(controller.isolated, false);
});

test('an inflight join that cannot be settled never frees its slot without node isolation', async () => {
  let isolated = false;
  const adapter = { removeParticipant: async () => assert.fail('Do not trust not_found before an uncertain join settles') };
  const controller = new AdmissionController({ adapter, isolate: async () => { isolated = true; }, signalUrl: 'ws://127.0.0.1' });
  const entry = controller.consumeTicket(controller.create(input()).ticket);
  controller.registerPendingJoin(entry, { settled: new Promise(() => {}), closeClient() {}, abort() {} });
  const removal = controller.disconnect(entry.id);
  assert.equal(entry.state, 'REMOVING');
  assert.throws(() => controller.issueTicket(entry.id, 1), /PARTICIPANT_STILL_CONNECTED/);
  await removal;
  assert.equal(isolated, true);
  assert.equal(entry.state, 'REVOKED');
  assert.equal(controller.health().status, 'isolated');
});
