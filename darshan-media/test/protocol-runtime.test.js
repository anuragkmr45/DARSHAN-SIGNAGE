import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { RoomServiceClient, TrackSource } from 'livekit-server-sdk';

const enabled = process.env.DARSHAN_MEDIA_PROTOCOL_RUNTIME_TESTS === '1';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 2500) {
  const end = performance.now() + timeout;
  while (performance.now() < end) { const value = await check(); if (value) return value; await delay(20); }
  throw new Error('Isolated protocol observation deadline exceeded');
}
function fixture() {
  const env = process.env;
  const instance = env.DARSHAN_MEDIA_NODE_INSTANCE_ID;
  assert.ok(enabled && instance && env.DARSHAN_MEDIA_PROTOCOL_TEST_INSTANCE === instance);
  assert.match(env.DARSHAN_MEDIA_PROTOCOL_TEST_IMAGE_SHA ?? '', /^sha256:[a-f0-9]{64}$/);
  assert.ok(existsSync('/.dockerenv'), 'Only an explicitly owned Docker fixture is allowed');
  assert.match(readFileSync('/proc/1/cmdline', 'utf8'), /test\/fixtures\/protocol-node\.mjs/);
  const source = createHash('sha256');
  for (const file of ['controller.js', 'gateway.js', 'index.js', 'livekit-adapter.js', 'supervisor.js', 'sfu-listener-ownership.js', 'authority-file.js', 'backend-authority.js', 'runtime-config.js', 'tls-config.js']) {
    source.update(file); source.update(readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url))));
  }
  const digest = source.digest('hex');
  assert.equal(digest, env.DARSHAN_MEDIA_PROTOCOL_EXPECTED_CORE_SHA256, 'Image source must equal the reviewed source digest');
  const secret = env.DARSHAN_MEDIA_CONTROL_SECRET;
  assert.ok(secret?.length >= 32 && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET && env.DARSHAN_MEDIA_TEST_AUTHORITY_EPOCH);
  const upstream = new URL(env.DARSHAN_MEDIA_SFU_URL);
  assert.equal(upstream.hostname, '127.0.0.1');
  const control = `http://127.0.0.1:${Number(env.DARSHAN_MEDIA_CONTROL_PORT ?? 19784)}`;
  const authority = `http://127.0.0.1:${Number(env.DARSHAN_MEDIA_TEST_AUTHORITY_PORT ?? 19785)}`;
  const sockets = new Set(), runs = new Map(), rooms = new Set();
  const sdk = new RoomServiceClient(upstream.origin, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, { requestTimeout: 0.5, failover: false });
  const request = async (path, method = 'GET', body, fixtureAuthority = false) => {
    const response = await fetch(`${fixtureAuthority ? authority : control}${path}`, { method, signal: AbortSignal.timeout(3000),
      headers: { 'x-darshan-media-secret': secret, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const fence = (id, run, generation = 1, revision = 1) => ({ id, run_id: run, generation, operation_revision: revision,
    node_instance_id: instance, authority_epoch: env.DARSHAN_MEDIA_TEST_AUTHORITY_EPOCH });
  const policy = async (target, changes = {}) => {
    const response = await request(`/fixture/policies/${target.id}`, 'PUT', { ...target, participant_id: target.id, role: 'receiver',
      audio: { microphone: false, screen_share_audio: false }, ...changes }, true);
    assert.equal(response.status, 200); runs.set(`${target.run_id}:${target.generation}`, target);
  };
  const join = async ticket => {
    const socket = net.connect(Number(env.DARSHAN_MEDIA_SIGNAL_PORT ?? 19780), '127.0.0.1'); sockets.add(socket);
    socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    const response = new Promise((resolve, reject) => {
      let data = ''; const timer = setTimeout(() => { socket.destroy(); reject(new Error('Actual signaling deadline exceeded')); }, 3000);
      socket.on('data', chunk => { data += chunk; if (data.includes('\r\n\r\n')) { clearTimeout(timer); resolve({ socket, data }); } });
      socket.on('close', () => { clearTimeout(timer); resolve({ socket, data }); });
    });
    socket.on('connect', () => socket.write(`GET /rtc?access_token=${encodeURIComponent(ticket)}&protocol=17&auto_subscribe=1 HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nOrigin: null\r\n\r\n`));
    return response;
  };
  const participant = async id => {
    for (const room of await sdk.listRooms()) {
      const row = (await sdk.listParticipants(room.name)).find(value => value.identity === id);
      if (row) { rooms.add(room.name); return { room: room.name, participant: row }; }
    }
    return null;
  };
  const admit = async target => {
    const admitted = await request('/internal/admissions', 'POST', target); assert.equal(admitted.status, 201);
    assert.match((await join(admitted.body.ticket)).data, /101 Switching Protocols/);
    return { ...await until(() => participant(target.id)), grant: admitted.body };
  };
  const cleanup = async () => {
    for (const target of runs.values()) await request(`/internal/runs/${target.run_id}/revoke`, 'POST', { ...target, operation_revision: 1_000_000 }).catch(() => {});
    for (const socket of sockets) socket.destroy();
    for (const room of rooms) await sdk.deleteRoom(room).catch(() => {});
  };
  return { request, fence, policy, admit, participant, join, sdk, cleanup,
    evidence: { image_sha256: env.DARSHAN_MEDIA_PROTOCOL_TEST_IMAGE_SHA, core_source_sha256: digest, instance_id: instance,
      scope: 'Isolated actual SFU/RPC/signaling with injected loopback HTTP fixture authority; no production Backend, frame, audio or display claim' } };
}

if (enabled && process.env.DARSHAN_MEDIA_PROTOCOL_HOLD === '1') {
  const f = fixture();
  const target = f.fence(`hold-${randomUUID()}`, `hold-run-${randomUUID()}`);
  await f.policy(target); const live = await f.admit(target);
  const ready = { event: 'protocol_participant_ready', ...f.evidence, run_id: target.run_id, participant_id: target.id, room: live.room };
  writeFileSync('/run/darshan-media-watchdog/protocol-ready.json', JSON.stringify(ready), { mode: 0o600, flag: 'wx' });
  process.stdout.write(`${JSON.stringify(ready)}\n`);
  let revision = 1, renewing = false;
  const timer = setInterval(async () => {
    if (renewing) return; renewing = true;
    try { const next = { ...target, operation_revision: ++revision }; await f.policy(next); await f.request(`/internal/admissions/${target.id}/renew`, 'POST', next); }
    catch { /* The local controller lease remains bounded. */ }
    finally { renewing = false; }
  }, 3000);
  await delay(20_000); clearInterval(timer); await f.cleanup();
  throw new Error('Owned participant hold expired before external fault injection');
} else {
  test('actual isolated image: fresh strict grants, SFU permissions, exact stops and replacement fencing', { skip: !enabled, timeout: 25_000 }, async t => {
    const f = fixture(); t.after(f.cleanup);
    assert.equal((await f.request('/internal/health')).body.authority_mode, 'strict-injected');
    assert.equal((await f.sdk.listRooms()).length, 0, 'The owned SFU must be fresh before any protocol probe');
    const unknown = f.fence(`unknown-${randomUUID()}`, `unknown-run-${randomUUID()}`);
    assert.equal((await f.request(`/internal/admissions/${unknown.id}`, 'DELETE', unknown)).body.teardown_confirmed, true);
    assert.equal((await f.request('/internal/admissions', 'POST', { ...unknown, operation_revision: 2 })).status, 410);
    const cancelled = f.fence(`cancelled-${randomUUID()}`, `cancelled-run-${randomUUID()}`);
    assert.equal((await f.request(`/internal/runs/${cancelled.run_id}/revoke`, 'POST', cancelled)).body.teardown_confirmed, true);
    assert.equal((await f.request('/internal/admissions', 'POST', cancelled)).status, 410);
    const run = `actual-run-${randomUUID()}`;
    const presenter = f.fence(`presenter-${randomUUID()}`, run), receiver = f.fence(`receiver-${randomUUID()}`, run);
    await f.policy(presenter, { role: 'presenter' }); await f.policy(receiver);
    const p = await f.admit(presenter), r = await f.admit(receiver);
    assert.equal(p.participant.permission.canPublish, true); assert.equal(p.participant.permission.canSubscribe, false);
    assert.deepEqual(p.participant.permission.canPublishSources, [TrackSource.SCREEN_SHARE]);
    assert.equal(r.participant.permission.canPublish, false); assert.equal(r.participant.permission.canSubscribe, true);
    assert.equal(r.participant.permission.canPublishData, false);
    const stopped = await f.request(`/internal/runs/${run}/revoke`, 'POST', presenter);
    assert.equal(stopped.body.teardown_confirmed, true);
    await until(async () => !await f.participant(presenter.id) && !await f.participant(receiver.id));
    assert.doesNotMatch((await f.join(r.grant.ticket)).data, /101 Switching Protocols/);
    const replacement = f.fence(`replacement-${randomUUID()}`, run, 2);
    await f.policy(replacement); await f.admit(replacement);
    assert.equal((await f.request(`/internal/runs/${run}/revoke`, 'POST', presenter)).body.teardown_confirmed, true);
    assert.ok(await f.participant(replacement.id));
    const delayed = f.fence(`delayed-${randomUUID()}`, `delayed-run-${randomUUID()}`);
    await f.policy(delayed, { delay_ms: 600 });
    const before = performance.now(); const response = await f.request('/internal/admissions', 'POST', delayed);
    const elapsed = performance.now() - before;
    assert.equal(response.status, 201); assert.ok(response.body.lease_ms < 9500);
    const pendingTarget = f.fence(`pending-${randomUUID()}`, `pending-run-${randomUUID()}`);
    await f.policy(pendingTarget, { delay_ms: 600 });
    const pendingCreate = f.request('/internal/admissions', 'POST', pendingTarget);
    await until(async () => (await f.request(`/fixture/policies/${pendingTarget.id}`, 'GET', undefined, true)).body.checks > 0);
    assert.equal((await f.request(`/internal/runs/${pendingTarget.run_id}/revoke`, 'POST', pendingTarget)).body.teardown_confirmed, true);
    assert.equal((await pendingCreate).status, 409);
    await delay(650); assert.equal(await f.participant(pendingTarget.id), null);
    process.stdout.write(`${JSON.stringify({ event: 'protocol_sfu_checks_passed', ...f.evidence,
      unknown_admission_stop: true, unknown_run_stop: true, actual_presenter_receiver_permissions: true,
      actual_run_teardown: true, replacement_survives_old_stop: true, stopped_pending_check: true,
      delayed_check_elapsed_ms: Math.ceil(elapsed), delayed_remaining_lease_ms: response.body.lease_ms })}\n`);
  });
}
