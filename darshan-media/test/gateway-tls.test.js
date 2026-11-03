import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import http from 'node:http';
import tls from 'node:tls';
import { randomBytes, randomUUID } from 'node:crypto';
import { AdmissionController } from '../src/controller.js';
import { createControlServer, createSignalServer } from '../src/gateway.js';
import { tlsFiles } from './fixtures/tls-files.mjs';

const secret = 'fixture-control-secret-at-least32-characters';
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise(resolve => { server.closeConnections?.(); server.closeAllConnections?.(); server.close(resolve); });
const request = (port, ca, path, { method = 'GET', body, origin } = {}) => new Promise((resolve, reject) => {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const req = https.request({ host: '127.0.0.1', port, path, method, ca, rejectUnauthorized: true,
    headers: { 'x-darshan-media-secret': secret, 'content-type': 'application/json', ...(payload !== undefined ? { 'content-length': Buffer.byteLength(payload) } : {}), ...(origin !== undefined ? { origin } : {}) } }, response => {
    let raw = ''; response.on('data', chunk => { raw += chunk; }); response.on('end', () => { try { resolve({ status: response.statusCode, body: JSON.parse(raw) }); } catch (error) { reject(error); } });
  }); req.on('error', reject); req.end(payload);
});
function controller(options = {}) {
  const node = randomUUID(), epoch = randomUUID();
  return { node, epoch, controller: new AdmissionController({ adapter: { removeParticipant: async () => {} }, isolate: async () => {}, signalUrl: 'wss://localhost', ...options,
    hostReadiness: { check: () => true }, // Network fixture, not actual root-owned host-watchdog readiness proof.
    strictAuthority: { mode: 'backend', nodeInstanceId: node, authorityEpoch: epoch, verifyAuthority: async value => ({ ...value, allowed: true,
      participant_id: value.id, role: 'receiver', audio: { microphone: false, screen_share_audio: false }, lease_ms: 10_000, window_remaining_ms: 60_000 }) } }) };
}
async function upgrade(port, ca, ticket, origin) {
  const socket = tls.connect({ host: '127.0.0.1', port, ca, rejectUnauthorized: true });
  const response = new Promise((resolve, reject) => {
    let data = ''; const timer = setTimeout(() => { socket.destroy(); reject(new Error('WSS test deadline')); }, 1500);
    socket.on('error', error => { clearTimeout(timer); reject(error); });
    socket.on('data', chunk => { data += chunk; if (data.includes('\r\n\r\n')) { clearTimeout(timer); resolve({ socket, data }); } });
    socket.on('close', () => { clearTimeout(timer); resolve({ socket, data }); });
  });
  socket.on('secureConnect', () => socket.write(`GET /rtc?access_token=${ticket} HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nOrigin: ${origin}\r\n\r\n`));
  return response;
}

test('verified HTTPS control preserves node/epoch/target evidence and rejects browser Origins and wrong trust', async t => {
  const files = await tlsFiles(t), state = controller(), server = createControlServer({ controller: state.controller, secret, tls: files });
  const port = await listen(server); t.after(() => close(server));
  const health = await request(port, files.cert, '/internal/health');
  assert.equal(health.status, 200); assert.equal(health.body.authority_mode, 'backend'); assert.equal(health.body.protocol_version, 1);
  assert.equal(health.body.node_instance_id, state.node); assert.equal(health.body.authority_epoch, state.epoch);
  for (const origin of ['', 'null', 'https://cms.test']) assert.equal((await request(port, files.cert, '/internal/health', { origin })).status, 401);
  const other = await tlsFiles(t); await assert.rejects(request(port, other.cert, '/internal/health'));
  const target = { id: randomUUID(), run_id: randomUUID(), generation: 1, operation_revision: 1, node_instance_id: state.node, authority_epoch: state.epoch };
  const stopped = await request(port, files.cert, `/internal/admissions/${target.id}`, { method: 'DELETE', body: target });
  assert.equal(stopped.status, 200); assert.equal(stopped.body.teardown_confirmed, true);
  for (const key of ['run_id', 'generation', 'node_instance_id', 'authority_epoch']) assert.equal(stopped.body[key], target[key]);
  assert.equal(stopped.body.protocol_version, 1); assert.equal(stopped.body.admission_id, target.id);
});

test('TLS signaling validates origins, forwards one opaque ticket and still rejects JWT/ticket replay', async t => {
  const files = await tlsFiles(t), state = controller(), upstream = http.createServer(), remote = new Set(); let joins = 0;
  upstream.on('upgrade', (_request, socket) => { joins += 1; remote.add(socket); socket.on('close', () => remote.delete(socket)); socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'); });
  const upstreamPort = await listen(upstream), adapter = { createToken: async () => 'private.jwt.fixture', confirmParticipant: async () => {} };
  const signal = createSignalServer({ controller: state.controller, adapter, tls: files, upstreamUrl: `http://127.0.0.1:${upstreamPort}`, allowedOrigins: ['https://cms.test'] });
  const port = await listen(signal);
  t.after(async () => { signal.closeConnections(); for (const socket of remote) socket.destroy(); await close(signal); await close(upstream); });
  const target = { id: randomUUID(), run_id: randomUUID(), generation: 1, operation_revision: 1, node_instance_id: state.node, authority_epoch: state.epoch };
  const grant = await state.controller.createAuthorized(target);
  assert.doesNotMatch((await upgrade(port, files.cert, grant.ticket, 'https://other.test')).data, /101 Switching Protocols/);
  const accepted = await upgrade(port, files.cert, grant.ticket, 'https://cms.test'); assert.match(accepted.data, /101 Switching Protocols/);
  assert.doesNotMatch((await upgrade(port, files.cert, grant.ticket, 'https://cms.test')).data, /101 Switching Protocols/);
  assert.doesNotMatch((await upgrade(port, files.cert, 'private.jwt.fixture', 'https://cms.test')).data, /101 Switching Protocols/);
  assert.equal(joins, 1); accepted.socket.destroy();
});

test('partially bound startup cannot advertise readiness or issue an admission', async t => {
  const files = await tlsFiles(t), state = controller({ ready: false });
  const server = createControlServer({ controller: state.controller, secret, tls: files }), port = await listen(server); t.after(() => close(server));
  assert.equal((await request(port, files.cert, '/internal/health')).status, 503);
  const target = { id: randomUUID(), run_id: randomUUID(), generation: 1, operation_revision: 1, node_instance_id: state.node, authority_epoch: state.epoch };
  assert.equal((await request(port, files.cert, '/internal/admissions', { method: 'POST', body: target })).status, 503);
  assert.equal(state.controller.admissions.size, 0); state.controller.ready = true;
  assert.equal((await request(port, files.cert, '/internal/health')).status, 200);
});
