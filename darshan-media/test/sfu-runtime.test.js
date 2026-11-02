import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TrackSource } from 'livekit-server-sdk';
import { AdmissionController } from '../src/controller.js';
import { LiveKitAdapter } from '../src/livekit-adapter.js';
import { createSignalServer } from '../src/gateway.js';

// Opt-in: uses only isolated uniquely named rooms on an already-running local SFU.
// It never stops a container or creates application/database fixtures.
const envFile = process.env.DARSHAN_MEDIA_REAL_SFU_ENV_FILE;
function privateConfig(path) {
  const values = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z_][A-Z_0-9]*)=(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  if (!values.LIVEKIT_API_KEY || !values.LIVEKIT_API_SECRET) throw new Error('Private SFU test configuration is incomplete');
  return values;
}
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => { server.closeConnections?.(); server.closeAllConnections?.(); server.close(resolve); });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function bounded(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Actual SFU operation did not complete')), milliseconds); })]);
  } finally { clearTimeout(timer); }
}
function rawClient(port, token) {
  const socket = net.connect(port, '127.0.0.1');
  socket.on('error', () => {});
  socket.on('connect', () => socket.write(`GET /rtc?access_token=${encodeURIComponent(token)}&sdk=js&version=2.23.0&protocol=17&auto_subscribe=1 HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nOrigin: null\r\n\r\n`));
  return socket;
}
async function response(socket) {
  return new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error('Signaling response deadline exceeded')), 3000);
    socket.on('data', (chunk) => {
      text += chunk.toString();
      if (text.includes('\r\n\r\n')) { clearTimeout(timer); resolve(text); }
    });
    socket.on('close', () => { clearTimeout(timer); resolve(text); });
  });
}

test('real SFU: delayed join cancellation waits for actual registration and performs final SDK removal', { skip: !envFile, timeout: 8000 }, async (t) => {
  const config = privateConfig(envFile);
  const upstreamUrl = config.DARSHAN_MEDIA_SFU_URL ?? 'http://127.0.0.1:18781';
  const upstream = new URL(upstreamUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(upstream.hostname));
  const realAdapter = new LiveKitAdapter({ url: upstreamUrl, apiKey: config.LIVEKIT_API_KEY, apiSecret: config.LIVEKIT_API_SECRET });
  const identity = `race-${randomUUID()}`;
  let joinStarted;
  const sawJoin = new Promise((resolve) => { joinStarted = resolve; });
  let sawActualParticipant = false;
  let finalRemovalObserved = false;
  const proxySockets = new Set();
  const proxyRequests = new Set();
  const delayProxy = http.createServer();
  delayProxy.on('upgrade', (request, socket) => {
    proxySockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => proxySockets.delete(socket));
    joinStarted();
    // Keep processing even when the downstream client cancels, reproducing a real inflight join.
    setTimeout(() => {
      const outgoing = http.request({ hostname: upstream.hostname, port: upstream.port, path: request.url,
        headers: { ...request.headers, host: upstream.host } });
      proxyRequests.add(outgoing);
      outgoing.on('error', () => {});
      outgoing.on('close', () => proxyRequests.delete(outgoing));
      outgoing.on('upgrade', (reply, remote, head) => {
        proxySockets.add(remote);
        remote.on('error', () => {});
        remote.on('close', () => proxySockets.delete(remote));
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(reply.headers).map(([key, value]) => `${key}: ${value}\r\n`).join('')}\r\n`);
        if (head.length) socket.write(head);
        socket.pipe(remote);
        remote.pipe(socket);
      });
      outgoing.end();
    }, 120);
  });
  const proxyPort = await listen(delayProxy);
  let removed;
  const removedEvent = new Promise((resolve) => { removed = resolve; });
  const adapter = {
    createToken: (entry) => realAdapter.createToken(entry),
    confirmParticipant: async (entry) => {
      await realAdapter.confirmParticipant(entry);
      const actual = await realAdapter.rooms.getParticipant(entry.room, entry.participantId);
      assert.equal(actual.permission?.canPublish, false);
      assert.equal(actual.permission?.canSubscribe, true);
      assert.equal(actual.permission?.canPublishData, false);
      sawActualParticipant = true;
    },
    removeParticipant: async (room, participant) => {
      await realAdapter.removeParticipant(room, participant);
      finalRemovalObserved = true;
      removed();
    },
  };
  let isolated = false;
  const controller = new AdmissionController({ adapter, isolate: async () => { isolated = true; }, signalUrl: 'ws://127.0.0.1' });
  const admission = controller.create({ id: identity, run_id: identity, generation: 1, participant_id: identity,
    role: 'receiver', lease_ms: 10_000, window_remaining_ms: 30_000,
    audio: { microphone: false, screen_share_audio: false } });
  const entry = controller.get(identity);
  await realAdapter.rooms.createRoom({ name: entry.room, emptyTimeout: 10, departureTimeout: 2 });
  const gateway = createSignalServer({ controller, adapter, upstreamUrl: `http://127.0.0.1:${proxyPort}`, allowedOrigins: ['null'] });
  const port = await listen(gateway);
  t.after(async () => {
    gateway.closeConnections();
    for (const request of proxyRequests) request.destroy();
    for (const socket of proxySockets) socket.destroy();
    await close(gateway);
    await close(delayProxy);
    await realAdapter.rooms.deleteRoom(entry.room).catch(() => {});
  });
  const socket = rawClient(port, admission.ticket);
  await sawJoin;
  socket.destroy();
  await delay(20);
  assert.equal(entry.state, 'REMOVING');
  await bounded(removedEvent, 3000);
  await delay(30);
  assert.equal(sawActualParticipant, true);
  assert.equal(finalRemovalObserved, true);
  assert.equal(isolated, false);
  assert.equal(entry.state, 'IDLE');
  assert.equal((await realAdapter.rooms.listParticipants(entry.room)).length, 0);

  // The actual internal JWT remains unusable through the public gateway.
  const internalJwt = await realAdapter.createToken(entry);
  const denied = await response(rawClient(port, internalJwt));
  assert.doesNotMatch(denied, /101 Switching Protocols/);
});

test('real SFU: actual participant permissions enforce approved presenter track sources', { skip: !envFile, timeout: 5000 }, async (t) => {
  const config = privateConfig(envFile);
  const upstreamUrl = config.DARSHAN_MEDIA_SFU_URL ?? 'http://127.0.0.1:18781';
  const adapter = new LiveKitAdapter({ url: upstreamUrl, apiKey: config.LIVEKIT_API_KEY, apiSecret: config.LIVEKIT_API_SECRET });
  let isolated = false;
  const controller = new AdmissionController({ adapter, isolate: async () => { isolated = true; }, signalUrl: 'ws://127.0.0.1' });
  const id = `grant-${randomUUID()}`;
  const admission = controller.create({ id, run_id: id, generation: 1, participant_id: id, role: 'presenter',
    lease_ms: 10_000, window_remaining_ms: 30_000, audio: { microphone: false, screen_share_audio: false } });
  const entry = controller.get(id);
  await adapter.rooms.createRoom({ name: entry.room, emptyTimeout: 10, departureTimeout: 2 });
  const gateway = createSignalServer({ controller, adapter, upstreamUrl, allowedOrigins: ['null'] });
  const port = await listen(gateway);
  t.after(async () => {
    await controller.revoke(id).catch(() => {});
    await close(gateway);
    await adapter.rooms.deleteRoom(entry.room).catch(() => {});
  });
  const socket = rawClient(port, admission.ticket);
  assert.match(await response(socket), /101 Switching Protocols/);
  const actual = await adapter.rooms.getParticipant(entry.room, id);
  assert.equal(actual.permission?.canPublish, true);
  assert.equal(actual.permission?.canSubscribe, false);
  assert.equal(actual.permission?.canPublishData, false);
  assert.deepEqual(actual.permission?.canPublishSources, [TrackSource.SCREEN_SHARE]);
  await controller.revoke(id);
  assert.equal((await adapter.rooms.listParticipants(entry.room)).length, 0);
  assert.equal(isolated, false);
});
