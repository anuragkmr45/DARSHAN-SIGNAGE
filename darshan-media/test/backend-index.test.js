import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import net from 'node:net';
import { writeFile, rename, rm, readFile } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { supervise } from '../src/supervisor.js';
import { tlsFiles } from './fixtures/tls-files.mjs';
import { temporaryTmpfs } from './fixtures/tmpfs-directory.mjs';

async function unusedPort() {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function bounded(promise, ms = 3000) {
  let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Backend index fixture deadline')), ms); })]); }
  finally { clearTimeout(timer); }
}
test('actual backend entrypoint exposes verified TLS boot metadata, denies grants without root RO host readiness and isolates on authority replacement', async t => {
  const files = await tlsFiles(t), directory = await temporaryTmpfs('darshan-backend-index-'); t.after(() => rm(directory, { recursive: true, force: true }));
  const epoch = randomUUID(), managed = randomUUID(), secret = randomBytes(32).toString('base64url'), controlSecret = randomBytes(32).toString('hex');
  const authorityFile = path.join(files.directory, 'authority.json');
  await writeFile(authorityFile, JSON.stringify({ version: 1, epoch_id: epoch, authority_secret: secret }), { mode: 0o600 });
  let verified = 0;
  const backend = https.createServer({ key: files.key, cert: files.cert }, async (request, response) => {
    assert.equal(request.headers['x-darshan-live-authority-secret'] === secret, true);
    let body = ''; for await (const chunk of request) body += chunk; const value = JSON.parse(body); verified += 1;
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ...value, allowed: true, participant_id: value.id,
      role: 'receiver', audio: { microphone: false, screen_share_audio: false }, lease_ms: 10_000, window_remaining_ms: 60_000 }));
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => { backend.closeAllConnections(); backend.close(resolve); }));
  const controlPort = await unusedPort(), signalPort = await unusedPort(), sfuPort = await unusedPort();
  let stopped; const stopEvent = new Promise(resolve => { stopped = resolve; });
  const runtime = await supervise({ sfuCommand: [process.execPath, fileURLToPath(new URL('./fixtures/sfu-child.mjs', import.meta.url)), String(sfuPort)],
    env: { ...process.env, DARSHAN_MEDIA_AUTHORITY_MODE: 'backend', DARSHAN_MEDIA_AUTHORITY_FILE: authorityFile,
      DARSHAN_MEDIA_BACKEND_AUTHORITY_URL: `https://127.0.0.1:${backend.address().port}/api/v1/internal/live-authority`, DARSHAN_MEDIA_BACKEND_CA_FILE: files.certFile,
      DARSHAN_MEDIA_TLS_CERT_FILE: files.certFile, DARSHAN_MEDIA_TLS_KEY_FILE: files.keyFile, DARSHAN_MEDIA_SIGNAL_URL: `wss://localhost:${signalPort}`,
      DARSHAN_MEDIA_CONTROL_SECRET: controlSecret, DARSHAN_MEDIA_NODE_INSTANCE_ID: managed, DARSHAN_MEDIA_SUPERVISOR_STATE_FILE: path.join(directory, 'supervisor.json'),
      DARSHAN_MEDIA_HOST_LEASE_FILE: path.join(directory, 'untrusted-host-lease.json'),
      DARSHAN_MEDIA_SFU_URL: `http://127.0.0.1:${sfuPort}`, DARSHAN_MEDIA_CONTROL_PORT: String(controlPort), DARSHAN_MEDIA_SIGNAL_PORT: String(signalPort),
      LIVEKIT_API_KEY: 'test-only-key', LIVEKIT_API_SECRET: 'test-only-sfu-signing-secret-at-least32' }, onStop: stopped });
  t.after(() => runtime.stop('TEST_CLEANUP'));
  await bounded(new Promise(resolve => runtime.gateway.on('message', message => { if (message.type === 'ready') resolve(); })));
  const call = (url, body) => new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port: controlPort, path: url, ca: files.cert, method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', 'x-darshan-media-secret': controlSecret } }, response => {
      let value = ''; response.on('data', chunk => { value += chunk; }); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(value) }));
    }); req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
  const health = await call('/internal/health'); assert.equal(health.status, 503); assert.equal(health.body.status, 'starting'); assert.equal(health.body.accepting_new_runs, false); assert.equal(health.body.authority_mode, 'backend');
  assert.equal(health.body.node_instance_id, runtime.authorityNodeInstanceId); assert.equal(health.body.managed_instance_id, managed);
  assert.equal(health.body.authority_epoch, epoch); assert.equal(health.body.protocol_version, 1);
  const heartbeat = JSON.parse(await readFile(path.join(directory, 'supervisor.json'), 'utf8'));
  assert.equal(heartbeat.authority_node_instance_id, runtime.authorityNodeInstanceId);
  const admitted = await call('/internal/admissions', { id: randomUUID(), run_id: randomUUID(), generation: 1, operation_revision: 1,
    node_instance_id: health.body.node_instance_id, authority_epoch: epoch });
  assert.equal(admitted.status, 503); assert.equal(admitted.body.error, 'MEDIA_HOST_NOT_READY'); assert.equal(verified, 0); assert.equal(admitted.body.ticket, undefined);
  await writeFile(`${authorityFile}.new`, JSON.stringify({ version: 1, epoch_id: randomUUID(), authority_secret: randomBytes(32).toString('base64url') }), { mode: 0o600 });
  await rename(`${authorityFile}.new`, authorityFile);
  assert.equal(await bounded(stopEvent), 'ENFORCEMENT_ISOLATION');
  assert.equal(runtime.sfu.signalCode, 'SIGKILL'); assert.throws(() => process.kill(runtime.sfu.pid, 0), error => error.code === 'ESRCH');
});
