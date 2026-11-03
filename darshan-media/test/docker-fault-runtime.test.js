import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, mkdir, readFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import { temporaryTmpfs } from './fixtures/tmpfs-directory.mjs';
import { RoomServiceClient } from 'livekit-server-sdk';

const enabled = process.env.DARSHAN_MEDIA_DOCKER_FAULT_TESTS === '1';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runFile = promisify(execFile);
const docker = async (...args) => {
  try { return (await runFile('docker', ['--context', 'default', ...args], { timeout: 15_000, maxBuffer: 32768 })).stdout.trim(); }
  catch { throw new Error('Isolated Docker fault-test operation failed'); }
};
const monotonic = () => Number(process.hrtime.bigint()) / 1e6;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function coreDigest() {
  const digest = createHash('sha256');
  for (const file of ['controller.js', 'gateway.js', 'index.js', 'livekit-adapter.js', 'supervisor.js', 'sfu-listener-ownership.js', 'authority-file.js', 'backend-authority.js', 'runtime-config.js', 'tls-config.js', 'host-readiness.js']) {
    digest.update(file);
    digest.update(await readFile(path.join(repo, 'darshan-media/src', file)));
  }
  return digest.digest('hex');
}
async function reachable(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.setTimeout(100);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    const no = () => { socket.destroy(); resolve(false); };
    socket.once('error', no);
    socket.once('timeout', no);
  });
}
async function waitUntil(check, timeoutMs, message) {
  const until = performance.now() + timeoutMs;
  while (performance.now() < until) {
    const value = await check();
    if (value) return value;
    await sleep(20);
  }
  throw new Error(message);
}

async function fixture(t, { hostWatchdog = false } = {}) {
  for (const port of [19780, 19781, 19782, 19784]) assert.equal(await reachable(port), false, 'Alternate test ports must be unused');
  const name = `darshan-media-fault-${randomUUID()}`;
  const image = 'darshan-live-media:prototype-20261103';
  const local = path.join(repo, '.local', 'live-broadcast');
  await mkdir(local, { recursive: true, mode: 0o700 });
  const privateDir = await mkdtemp(path.join(local, 'fault-private-'));
  let started = false;
  t.after(async () => {
    if (started) await docker('rm', '--force', name).catch(() => {});
    await rm(privateDir, { recursive: true, force: true }); // Only this test-created directory.
  });
  const key = `key-${randomBytes(8).toString('hex')}`;
  const signingSecret = randomBytes(32).toString('hex');
  const controlSecret = randomBytes(32).toString('hex');
  const instance = randomUUID();
  const stateDir = hostWatchdog ? await temporaryTmpfs('darshan-media-fault-state-') : undefined;
  if (stateDir) t.after(() => rm(stateDir, { recursive: true, force: true }));
  await writeFile(path.join(privateDir, 'sfu.yaml'), `port: 19781\nbind_addresses: [127.0.0.1]\nrtc:\n  tcp_port: 19782\n  udp_port: 19783\n  node_ip: 127.0.0.1\n  use_external_ip: false\n  enable_loopback_candidate: true\n  stun_servers: []\nkeys:\n  ${key}: ${signingSecret}\nlogging:\n  level: error\n`, { mode: 0o600 });
  await writeFile(path.join(privateDir, 'node.env'), [
    `LIVEKIT_API_KEY=${key}`, `LIVEKIT_API_SECRET=${signingSecret}`, `DARSHAN_MEDIA_CONTROL_SECRET=${controlSecret}`,
    'DARSHAN_MEDIA_SFU_URL=http://127.0.0.1:19781', 'DARSHAN_MEDIA_SIGNAL_PORT=19780',
    'DARSHAN_MEDIA_SIGNAL_URL=ws://127.0.0.1:19780', 'DARSHAN_MEDIA_CONTROL_PORT=19784',
    'DARSHAN_MEDIA_ALLOWED_ORIGINS=null', 'DARSHAN_MEDIA_SFU_CONFIG_FILE=/run/darshan-media/sfu.yaml',
    ...(hostWatchdog ? [`DARSHAN_MEDIA_NODE_INSTANCE_ID=${instance}`, 'DARSHAN_MEDIA_SUPERVISOR_STATE_FILE=/run/darshan-media-watchdog/supervisor.json'] : []),
  ].join('\n'), { mode: 0o600 });
  const imageId = await docker('image', 'inspect', image, '--format', '{{.Id}}');
  const sourceDigest = await coreDigest();
  // Existing image supplies Node/SFU/dependencies; mount current reviewed source without a build.
  const containerId = await docker('run', '--detach', '--name', name, '--network', 'host', '--memory', '256m', '--memory-swap', '256m', '--cpus', '0.5',
    '--pids-limit', '64', '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=16m',
    '--mount', `type=bind,src=${privateDir},dst=/run/darshan-media,readonly`,
    '--mount', `type=bind,src=${path.join(repo, 'darshan-media/src')},dst=/app/src,readonly`,
    ...(hostWatchdog ? ['--user', `${process.getuid()}:${process.getgid()}`, '--restart', 'no',
      '--label', 'com.darshan.media.managed=1', '--label', 'com.darshan.media.role=media-node',
      '--label', `com.darshan.media.instance=${instance}`, '--mount', `type=bind,src=${stateDir},dst=/run/darshan-media-watchdog`] : []),
    '--env-file', path.join(privateDir, 'node.env'), image);
  started = true;
  const control = async (route, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:19784${route}`, { method, headers: { 'content-type': 'application/json', 'x-darshan-media-secret': controlSecret },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('Private test control rejected request');
    return response.json();
  };
  await waitUntil(async () => { try { return (await control('/internal/health')).status === 'ready'; } catch { return false; } }, 12_000, 'Isolated media node did not become ready');
  const id = `fault-${randomUUID()}`;
  const admission = await control('/internal/admissions', 'POST', { id, run_id: id, generation: 1, participant_id: id, role: 'receiver',
    lease_ms: 10_000, window_remaining_ms: 60_000, audio: { microphone: false, screen_share_audio: false } });
  const socket = net.connect(19780, '127.0.0.1');
  socket.on('error', () => {});
  t.after(() => socket.destroy());
  let handshake = '';
  socket.on('data', (chunk) => { handshake += chunk.toString(); });
  socket.on('connect', () => socket.write(`GET /rtc?access_token=${admission.ticket}&protocol=17&auto_subscribe=1 HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nOrigin: null\r\n\r\n`));
  try {
    await waitUntil(() => handshake.includes('101 Switching Protocols'), 3000, 'Actual SFU signaling did not establish');
  } catch {
    const state = await control(`/internal/admissions/${id}`).then((value) => value.state).catch(() => 'CONTROL_UNREACHABLE');
    const logs = await runFile('docker', ['--context', 'default', 'logs', name], { timeout: 3000, maxBuffer: 32768 }).then((result) => result.stdout + result.stderr).catch(() => '');
    const reason = /supervisor stopped: ([A-Z_]+)/.exec(logs)?.[1] ?? 'NO_STOP_REASON';
    const oom = await docker('inspect', name, '--format', '{{.State.OOMKilled}}').catch(() => 'unknown');
    throw new Error(`Actual SFU signaling did not establish (${state}, ${reason}, OOM=${oom})`);
  }
  const sdk = new RoomServiceClient('http://127.0.0.1:19781', key, signingSecret, { requestTimeout: 0.5, failover: false });
  const rooms = (await sdk.listRooms()).filter((room) => room.name.startsWith('darshan-'));
  assert.equal(rooms.length, 1);
  assert.equal((await sdk.listParticipants(rooms[0].name)).length, 1, 'Fault must start with an actual admitted SFU participant');
  const pids = JSON.parse(await docker('exec', name, 'node', '-e', `const f=require('fs');const out={};for(const p of f.readdirSync('/proc').filter(x=>/^\\d+$/.test(x))){try{const a=f.readFileSync('/proc/'+p+'/cmdline','utf8').split('\\0');if(a[1]?.endsWith('/src/index.js'))out.controller=Number(p);if(a[0]?.endsWith('/livekit-server'))out.sfu=Number(p);}catch{}}process.stdout.write(JSON.stringify(out));`));
  assert.ok(pids.controller > 1 && pids.sfu > 1);
  const hostTop = await docker('top', name, '-eo', 'pid,args');
  const hostSfu = hostTop.split('\n').map((line) => /^\s*(\d+)\s+\/usr\/local\/bin\/livekit-server(?:\s|$)/.exec(line)).find(Boolean);
  assert.ok(hostSfu, 'Must identify actual SFU host PID to prove process death');
  const hostSfuPid = Number(hostSfu[1]);
  const initialStat = await readFile(`/proc/${hostSfuPid}/stat`, 'utf8');
  assert.match(initialStat, /\(livekit-server\)/);
  const processDead = async () => {
    try {
      const stat = await readFile(`/proc/${hostSfuPid}/stat`, 'utf8');
      return /^\d+ \(.+\) Z /.test(stat);
    } catch (error) { if (error.code === 'ENOENT') return true; throw new Error('Cannot prove actual SFU process termination'); }
  };
  const clockBefore = monotonic();
  const childClock = Number(BigInt(await docker('exec', name, 'node', '-e', 'process.stdout.write(String(process.hrtime.bigint()));'))) / 1e6;
  const clockAfter = monotonic();
  assert.ok(childClock >= clockBefore && childClock <= clockAfter, 'Container and observer must share the Linux monotonic clock');
  const signal = async (pid, value) => {
    const timestamp = await docker('exec', name, 'node', '-e', 'const t=process.hrtime.bigint();process.kill(Number(process.argv[1]),process.argv[2]);process.stdout.write(String(t));', String(pid), value);
    return Number(BigInt(timestamp)) / 1e6;
  };
  const awaitStopped = async (expectedExit = 1) => {
    const observedDeadAt = await waitUntil(async () => await processDead() && !await reachable(19781) && monotonic(), 4000, 'SFU did not terminate within the fault bound');
    await waitUntil(async () => (await docker('inspect', name, '--format', '{{.State.Running}}')) === 'false', 3000, 'PID1 did not stop after isolation');
    const exit = Number(await docker('inspect', name, '--format', '{{.State.ExitCode}}'));
    const oom = await docker('inspect', name, '--format', '{{.State.OOMKilled}}');
    assert.equal(oom, 'false', 'OOM termination does not prove enforcement');
    assert.equal(exit, expectedExit);
    return observedDeadAt;
  };
  const evidence = async (fault, milliseconds, boundMs) => {
    const data = { fault, actual_sfu_termination_upper_ms: Math.ceil(milliseconds), bound_ms: boundMs, within_bound: milliseconds <= boundMs,
      image_id: imageId, supervisor_sha256: createHash('sha256').update(await readFile(path.join(repo, 'darshan-media/src/supervisor.js'))).digest('hex'),
      core_source_sha256: sourceDigest,
      ...(hostWatchdog ? { host_watchdog_sha256: createHash('sha256').update(await readFile(path.join(repo, 'darshan-media/host-watchdog.py'))).digest('hex') } : {}),
      resources: { memory_mib: 256, cpus: 0.5 }, scope: 'Actual Docker process/SFU/RPC evidence with admitted participant; no rendered media/audio claim' };
    await writeFile(path.join(local, `fault-result-${fault}-${randomUUID()}.json`), JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });
    process.stdout.write(`${JSON.stringify(data)}\n`);
    assert.ok(data.within_bound, `${fault} exceeded the agreed termination bound`);
  };
  const unconfirmedEvidence = async (fault, events) => {
    const rejected = events.find((event) => event.event === 'watchdog_pidfd_rejected');
    const data = { fault, status: 'UNCONFIRMED', within_bound: false,
      actual_sfu_termination_upper_ms: null, code: rejected?.code ?? 'ENFORCEMENT_UNCONFIRMED',
      stage: rejected?.stage ?? null, image_id: imageId, core_source_sha256: sourceDigest,
      host_watchdog_sha256: createHash('sha256').update(await readFile(path.join(repo, 'darshan-media/host-watchdog.py'))).digest('hex'),
      scope: 'Permission/LSM prevented real pidfd enforcement; owned container was stopped only by test cleanup. This is an open gate.' };
    await writeFile(path.join(local, `fault-result-${fault}-unconfirmed-${randomUUID()}.json`), JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });
    process.stdout.write(`${JSON.stringify(data)}\n`);
  };
  return { pids, signal, awaitStopped, control, id, evidence, unconfirmedEvidence, containerId, instance,
    heartbeatFile: stateDir ? path.join(stateDir, 'supervisor.json') : undefined, privateDir };
}

test('actual Docker: independent supervisor kills SFU after controller SIGSTOP', { skip: !enabled, timeout: 25_000 }, async (t) => {
  const f = await fixture(t);
  const began = await f.signal(f.pids.controller, 'SIGSTOP');
  await f.evidence('controller-sigstop', await f.awaitStopped() - began, 2000);
});

test('actual Docker: controller crash kills SFU instead of draining the room', { skip: !enabled, timeout: 25_000 }, async (t) => {
  const f = await fixture(t);
  const began = await f.signal(f.pids.controller, 'SIGKILL');
  await f.evidence('controller-crash', await f.awaitStopped() - began, 2000);
});

test('actual Docker: stalled SFU management invokes forced isolation inside cleanup reserve', { skip: !enabled, timeout: 25_000 }, async (t) => {
  const f = await fixture(t);
  await f.signal(f.pids.sfu, 'SIGSTOP');
  const began = monotonic();
  const removal = f.control(`/internal/admissions/${f.id}`, 'DELETE').catch(() => undefined);
  const ended = await f.awaitStopped();
  await removal;
  await f.evidence('management-timeout-isolation', ended - began, 3000);
});

test('actual Docker: independent host watchdog kills a stalled PID1 and all SFU children', { skip: !enabled, timeout: 25_000 }, async (t) => {
  const f = await fixture(t, { hostWatchdog: true });
  const script = path.join(repo, 'darshan-media/host-watchdog.py');
  const common = ['--container-id', f.containerId, '--heartbeat', f.heartbeatFile, '--heartbeat-uid', String(process.getuid())];
  const wrong = await runFile('python3', [script, ...common, '--instance-id', randomUUID()], { timeout: 2000 }).then(() => 0).catch((error) => error.code);
  assert.equal(wrong, 2, 'A wrong instance must be rejected without killing any target');
  assert.equal(await reachable(19781), true);
  const watchdog = spawn('python3', [script, ...common, '--instance-id', f.instance], { stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(() => { if (watchdog.exitCode === null) watchdog.kill('SIGKILL'); });
  const events = [];
  let buffer = '';
  watchdog.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let boundary;
    while ((boundary = buffer.indexOf('\n')) >= 0) {
      try { events.push(JSON.parse(buffer.slice(0, boundary))); } catch {}
      buffer = buffer.slice(boundary + 1);
    }
  });
  await waitUntil(() => events.some((event) => event.event === 'watchdog_ready'), 2500, 'Independent host watchdog did not establish its identity/clock fence');
  // Namespace PID1 ignores some unhandled signals from inside its own namespace.
  // Docker sends STOP from the ancestor namespace, and the host verifies the real T state.
  const supervisorPid = Number(await docker('inspect', f.containerId, '--format', '{{.State.Pid}}'));
  const began = monotonic();
  await docker('kill', '--signal', 'STOP', f.containerId);
  assert.match(await readFile(`/proc/${supervisorPid}/stat`, 'utf8'), /^\d+ \(.+\) T /);
  let ended;
  try { ended = await f.awaitStopped(137); }
  catch { throw new Error(`Host watchdog did not enforce: ${JSON.stringify(events.map((event) => ({ event: event.event, reason: event.reason, code: event.code })))}`); }
  await waitUntil(() => watchdog.exitCode !== null, 2000, 'Host watchdog did not finish after enforcement');
  assert.equal(watchdog.exitCode, 0);
  assert.ok(events.some((event) => event.event === 'watchdog_killed_pinned_container' && event.reason === 'SUPERVISOR_HEARTBEAT_STALE'));
  await f.evidence('supervisor-sigstop-host-watchdog', ended - began, 3000);
});

test('actual Docker: pre-pinned pidfd enforces supervisor stall when only watchdog Docker CLI becomes unavailable', { skip: !enabled, timeout: 25_000 }, async (t) => {
  const f = await fixture(t, { hostWatchdog: true });
  const script = path.join(repo, 'darshan-media/host-watchdog.py');
  const binary = (await runFile('which', ['docker'], { timeout: 1000 })).stdout.trim();
  const wrapperDir = path.join(f.privateDir, 'bin');
  const denyFlag = path.join(f.privateDir, 'deny-docker');
  await mkdir(wrapperDir, { mode: 0o700 });
  await writeFile(path.join(wrapperDir, 'docker'), `#!/usr/bin/python3\nimport os,sys\nif os.path.exists(${JSON.stringify(denyFlag)}): sys.exit(1)\nos.execv(${JSON.stringify(binary)},[${JSON.stringify(binary)}]+sys.argv[1:])\n`, { mode: 0o700 });
  const watchdog = spawn('python3', [script, '--container-id', f.containerId, '--instance-id', f.instance,
    '--heartbeat', f.heartbeatFile, '--heartbeat-uid', String(process.getuid())], {
    stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, PATH: `${wrapperDir}:${process.env.PATH}` },
  });
  t.after(() => { if (watchdog.exitCode === null) watchdog.kill('SIGKILL'); });
  const events = [];
  let buffer = '';
  watchdog.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let boundary;
    while ((boundary = buffer.indexOf('\n')) >= 0) {
      try { events.push(JSON.parse(buffer.slice(0, boundary))); } catch {}
      buffer = buffer.slice(boundary + 1);
    }
  });
  await waitUntil(() => events.some((event) => event.event === 'watchdog_ready'), 2500, 'Host watchdog did not pin its kernel process handle');
  const supervisorPid = Number(await docker('inspect', f.containerId, '--format', '{{.State.Pid}}'));
  const began = monotonic();
  await docker('kill', '--signal', 'STOP', f.containerId);
  assert.match(await readFile(`/proc/${supervisorPid}/stat`, 'utf8'), /^\d+ \(.+\) T /);
  await writeFile(denyFlag, '', { mode: 0o600 }); // Only this watchdog's private wrapper fails; dockerd is untouched.
  let ended;
  try { ended = await f.awaitStopped(137); }
  catch {
    await f.unconfirmedEvidence('supervisor-stall-pidfd-docker-unavailable', events);
    throw new Error(`Pidfd fallback did not enforce: ${JSON.stringify(events.map((event) => ({ event: event.event, reason: event.reason, code: event.code, stage: event.stage })))}`);
  }
  await waitUntil(() => watchdog.exitCode !== null, 2000, 'Pidfd fallback did not finish');
  assert.equal(watchdog.exitCode, 0);
  assert.ok(events.some((event) => event.event === 'watchdog_pidfd_enforced'));
  await f.evidence('supervisor-stall-pidfd-docker-unavailable', ended - began, 3000);
});

test('actual Docker: Docker inspection outage does not kill a healthy pinned media namespace', { skip: !enabled, timeout: 25_000 }, async (t) => {
  const f = await fixture(t, { hostWatchdog: true });
  const script = path.join(repo, 'darshan-media/host-watchdog.py');
  const binary = (await runFile('which', ['docker'], { timeout: 1000 })).stdout.trim();
  const wrapperDir = path.join(f.privateDir, 'healthy-bin');
  const denyFlag = path.join(f.privateDir, 'deny-healthy-docker');
  await mkdir(wrapperDir, { mode: 0o700 });
  await writeFile(path.join(wrapperDir, 'docker'), `#!/usr/bin/python3\nimport os,sys\nif os.path.exists(${JSON.stringify(denyFlag)}): sys.exit(1)\nos.execv(${JSON.stringify(binary)},[${JSON.stringify(binary)}]+sys.argv[1:])\n`, { mode: 0o700 });
  const watchdog = spawn('python3', [script, '--container-id', f.containerId, '--instance-id', f.instance,
    '--heartbeat', f.heartbeatFile, '--heartbeat-uid', String(process.getuid())], {
    stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, PATH: `${wrapperDir}:${process.env.PATH}` },
  });
  t.after(() => { if (watchdog.exitCode === null) watchdog.kill('SIGKILL'); });
  const events = [];
  let buffer = '';
  watchdog.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let boundary;
    while ((boundary = buffer.indexOf('\n')) >= 0) {
      try { events.push(JSON.parse(buffer.slice(0, boundary))); } catch {}
      buffer = buffer.slice(boundary + 1);
    }
  });
  await waitUntil(() => events.some((event) => event.event === 'watchdog_ready'), 2500,
    'Host watchdog did not pin the healthy media namespace');
  await writeFile(denyFlag, '', { mode: 0o600 });
  await waitUntil(() => events.some((event) => event.event === 'watchdog_docker_inspection_degraded'), 2500,
    'Docker inspection outage was not reported');
  await sleep(1800); // Exceeds the superseded one-second Docker-management cutoff.
  assert.equal(await docker('inspect', f.containerId, '--format', '{{.State.Running}}'), 'true');
  assert.equal(await reachable(19781), true, 'Healthy SFU must remain available during Docker management outage');
  await rm(denyFlag);
  await waitUntil(() => events.some((event) => event.event === 'watchdog_docker_inspection_recovered'), 2500,
    'Recovered Docker identity was not revalidated');
  assert.equal(watchdog.exitCode, null, 'Healthy watchdog must continue after recovery');
});
