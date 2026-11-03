import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { supervise } from '../src/supervisor.js';
import { fork } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { mkdtemp, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function fixture(t, overrides = {}) {
  const portServer = net.createServer();
  await new Promise((resolve) => portServer.listen(0, '127.0.0.1', resolve));
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  let stopped;
  const stopEvent = new Promise((resolve) => { stopped = resolve; });
  const runtime = await supervise({
    sfuCommand: [process.execPath, fileURLToPath(new URL('./fixtures/sfu-child.mjs', import.meta.url)), String(port)],
    gatewayEntry: fileURLToPath(new URL('./fixtures/controller-child.mjs', import.meta.url)),
    env: { ...process.env, DARSHAN_MEDIA_SFU_URL: `http://127.0.0.1:${port}`, ...overrides },
    heartbeatMs: 150, startupMs: 1500, checkMs: 20,
    onStop: stopped,
  });
  t.after(() => runtime.stop('TEST_CLEANUP'));
  return { runtime, stopEvent };
}
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('supervisor timeout')), 3000); })]);
  } finally { clearTimeout(timer); }
}
function assertDead(child) {
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  assert.throws(() => process.kill(child.pid, 0), (error) => error.code === 'ESRCH');
}

test('separate supervisor kills the SFU when the controller process is killed', async (t) => {
  const { runtime, stopEvent } = await fixture(t);
  runtime.gateway.kill('SIGKILL');
  assert.match(await bounded(stopEvent), /^CONTROLLER_(EXIT|IPC_LOST)$/);
  assertDead(runtime.sfu);
});

test('separate supervisor kills the SFU when the controller event loop stops heartbeating', async (t) => {
  const { runtime, stopEvent } = await fixture(t, { TEST_STOP_HEARTBEAT: '1' });
  assert.equal(await bounded(stopEvent), 'CONTROLLER_HEARTBEAT_EXPIRED');
  assertDead(runtime.sfu);
  assertDead(runtime.gateway);
});

test('private enforcement-isolation IPC kills the actual SFU child and then the controller', async (t) => {
  const { runtime, stopEvent } = await fixture(t, { TEST_ISOLATE: '1' });
  assert.equal(await bounded(stopEvent), 'ENFORCEMENT_ISOLATION');
  assert.equal(runtime.sfu.signalCode, 'SIGKILL');
  assertDead(runtime.sfu);
  assertDead(runtime.gateway);
});

test('a genuinely suspended controller cannot supervise itself; independent process still kills SFU', async (t) => {
  const { runtime, stopEvent } = await fixture(t);
  await new Promise((resolve) => runtime.gateway.once('message', resolve));
  runtime.gateway.kill('SIGSTOP');
  assert.equal(await bounded(stopEvent), 'CONTROLLER_HEARTBEAT_EXPIRED');
  assertDead(runtime.sfu);
  assertDead(runtime.gateway);
});

test('an admission-ready controller never retains cold-start grace before its first periodic heartbeat', async (t) => {
  const began = performance.now();
  const { runtime, stopEvent } = await fixture(t, { TEST_READY_WITHOUT_HEARTBEAT: '1' });
  assert.equal(await bounded(stopEvent), 'CONTROLLER_HEARTBEAT_EXPIRED');
  assert.ok(performance.now() - began < 1200, 'Ready state must use the 150 ms test runtime threshold, not 1500 ms cold-start grace');
  assertDead(runtime.sfu);
});

test('actual controller publishes initial supervisor heartbeat before admitting HTTP readiness', async (t) => {
  async function unusedPort() {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    return port;
  }
  const controlPort = await unusedPort();
  const signalPort = await unusedPort();
  const secret = 'test-only-initial-heartbeat-secret-at-least-32-characters';
  const child = fork(fileURLToPath(new URL('../src/index.js', import.meta.url)), [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { ...process.env, LIVEKIT_API_KEY: 'test-key', LIVEKIT_API_SECRET: secret,
      DARSHAN_MEDIA_CONTROL_SECRET: secret, DARSHAN_MEDIA_CONTROL_PORT: String(controlPort),
      DARSHAN_MEDIA_SIGNAL_PORT: String(signalPort), DARSHAN_MEDIA_SFU_URL: 'http://127.0.0.1:1' },
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const messages = [];
  await bounded(new Promise((resolve) => child.on('message', (message) => {
    messages.push(message);
    if (message.type === 'isolate') child.send({ type: 'isolation-complete' });
    if (message.type === 'ready') resolve();
  })));
  assert.equal(messages[0].type, 'heartbeat');
  assert.equal(messages[0].sequence, 1);
  const response = await fetch(`http://127.0.0.1:${controlPort}/internal/health`, { headers: { 'x-darshan-media-secret': secret } });
  assert.equal(response.status, 200);
});

test('a foreign listener cannot make an unrelated spawned child admission-ready or become its isolation proof', async (t) => {
  const foreign = net.createServer(socket => socket.end());
  await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve));
  const port = foreign.address().port;
  const directory = await mkdtemp(path.join(tmpdir(), 'darshan-supervisor-owner-'));
  const marker = path.join(directory, 'gateway-started');
  let runtime;
  t.after(async () => {
    await runtime?.stop('TEST_CLEANUP');
    await new Promise(resolve => foreign.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const stopped = [];
  const attempt = supervise({
    sfuCommand: [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
    gatewayEntry: fileURLToPath(new URL('./fixtures/controller-child.mjs', import.meta.url)),
    env: { ...process.env, DARSHAN_MEDIA_SFU_URL: `http://127.0.0.1:${port}`, TEST_START_MARKER: marker },
    startupMs: 1000, onStop: reason => stopped.push(reason),
  }).then(value => { runtime = value; return value; });
  await assert.rejects(attempt, error => error.code === 'SFU_LISTENER_NOT_OWNED');
  assert.deepEqual(stopped, ['SFU_LISTENER_NOT_OWNED']);
  await assert.rejects(lstat(marker), error => error.code === 'ENOENT');
  // The refused endpoint belongs to this test, not the stopped child. It must
  // survive cleanup, and must never be acknowledged as isolated by that child.
  const socket = net.connect(port, '127.0.0.1');
  await bounded(new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); }));
  socket.destroy();
});
