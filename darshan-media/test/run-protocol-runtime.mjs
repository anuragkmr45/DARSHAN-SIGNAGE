// Explicit opt-in only. Builds a developer overlay and owns exactly one new node.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { temporaryTmpfs } from './fixtures/tmpfs-directory.mjs';

assert.equal(process.env.DARSHAN_MEDIA_PROTOCOL_DOCKER_TESTS, '1', 'Explicit Docker protocol test opt-in is required');
assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 1000, 'This fixture requires the reviewed media UID 1000');
const baseId = process.env.DARSHAN_MEDIA_PROTOCOL_BASE_IMAGE_ID;
assert.match(baseId ?? '', /^sha256:[a-f0-9]{64}$/);
const execute = promisify(execFile);
const docker = async (...args) => (await execute('docker', ['--context', 'default', ...args], { timeout: 15_000, maxBuffer: 131072 })).stdout.trim();
const media = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(media, '..');
const local = path.join(repo, '.local/live-broadcast');
const available = Number(/^MemAvailable:\s+(\d+)/m.exec(await readFile('/proc/meminfo', 'utf8'))?.[1] ?? 0);
assert.ok(available > 1_048_576, 'At least 1 GiB available memory is required');
const context = JSON.parse(await docker('context', 'inspect', 'default'))[0];
assert.match(context.Endpoints.docker.Host, /^unix:\/\//, 'Only the local native Docker daemon is allowed');
assert.equal(JSON.parse(await docker('image', 'inspect', baseId))[0].Id, baseId);
await mkdir(local, { recursive: true, mode: 0o700 });
const instance = randomUUID(), epoch = randomUUID();
const privateDir = await mkdtemp(path.join(local, 'protocol-private-'));
const stateDir = await temporaryTmpfs('darshan-protocol-state-');
const buildDir = path.join(privateDir, 'build');
const baseTag = `darshan-live-media-protocol-base:${instance}`;
const imageTag = `darshan-live-media:protocol-test-${instance}`;
const name = `darshan-media-protocol-${instance}`;
const resultFile = path.join(local, `protocol-result-${instance}.json`);
const sourceFiles = ['controller.js', 'gateway.js', 'index.js', 'livekit-adapter.js', 'supervisor.js', 'sfu-listener-ownership.js'];
const digest = createHash('sha256');
for (const file of sourceFiles) { digest.update(file); digest.update(await readFile(path.join(media, 'src', file))); }
const sourceHash = digest.digest('hex');
let id, imageId, watchdog, holder, baseTagged = false, resultWritten = false, stage = 'PREPARE';
const events = [];
const now = () => Number(process.hrtime.bigint()) / 1e6;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 5000) {
  const end = now() + timeout;
  while (now() < end) { const value = await check(); if (value) return value; await sleep(50); }
  throw new Error('Owned runtime observation deadline exceeded');
}
async function owned() {
  const value = JSON.parse(await docker('inspect', id))[0];
  assert.equal(value.Id, id, 'OWNED_ID_MISMATCH'); assert.equal(value.Image, imageId, 'OWNED_IMAGE_MISMATCH');
  assert.equal(value.Config.Labels['com.darshan.media.instance'], instance, 'OWNED_INSTANCE_MISMATCH');
  assert.equal(value.Config.Labels['com.darshan.media.role'], 'media-node', 'OWNED_ROLE_MISMATCH');
  assert.equal(value.HostConfig.NetworkMode, 'none', 'OWNED_NETWORK_MISMATCH'); assert.equal(value.HostConfig.PidMode, '', 'OWNED_PID_MISMATCH');
  assert.equal(value.Config.User, '1000:1000', 'OWNED_USER_MISMATCH'); assert.equal(value.HostConfig.Memory, 268435456, 'OWNED_MEMORY_MISMATCH');
  assert.equal(value.HostConfig.RestartPolicy.Name, 'no', 'OWNED_RESTART_MISMATCH');
  assert.deepEqual(value.Config.Cmd, ['node', 'test/fixtures/protocol-node.mjs'], 'OWNED_COMMAND_MISMATCH');
  return value;
}
async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(500)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
try {
  await mkdir(path.join(buildDir, 'test/fixtures'), { recursive: true, mode: 0o700 });
  await cp(path.join(media, 'src'), path.join(buildDir, 'src'), { recursive: true });
  await cp(path.join(media, 'test/fixtures/protocol-node.mjs'), path.join(buildDir, 'test/fixtures/protocol-node.mjs'));
  await cp(path.join(media, 'test/protocol-runtime.test.js'), path.join(buildDir, 'test/protocol-runtime.test.js'));
  await writeFile(path.join(buildDir, 'Dockerfile'), `FROM ${baseTag}\nWORKDIR /app\nCOPY src ./src\nCOPY --chown=1000:1000 test ./test\nUSER 1000:1000\nRUN ["node","--check","test/fixtures/protocol-node.mjs"]\nRUN ["node","--check","test/protocol-runtime.test.js"]\nCMD ["node","test/fixtures/protocol-node.mjs"]\n`, { mode: 0o600 });
  await docker('tag', baseId, baseTag); baseTagged = true;
  stage = 'BUILD';
  const build = await execute('docker', ['--context', 'default', 'build', '--pull=false', '--network=none', '--tag', imageTag, buildDir], { timeout: 30_000, maxBuffer: 262144 });
  await writeFile(path.join(local, `protocol-build-${instance}.log`), build.stdout + build.stderr, { mode: 0o600 });
  imageId = JSON.parse(await docker('image', 'inspect', imageTag))[0].Id;
  const key = `fixture-${randomBytes(8).toString('hex')}`, signing = randomBytes(32).toString('hex'), secret = randomBytes(32).toString('hex');
  await writeFile(path.join(privateDir, 'sfu.yaml'), `port: 19781\nbind_addresses: [127.0.0.1]\nrtc:\n  tcp_port: 19782\n  udp_port: 19783\n  node_ip: 127.0.0.1\n  use_external_ip: false\n  enable_loopback_candidate: true\n  stun_servers: []\nkeys:\n  ${key}: ${signing}\nlogging:\n  level: error\n`, { mode: 0o600 });
  await writeFile(path.join(privateDir, 'node.env'), [
    `LIVEKIT_API_KEY=${key}`, `LIVEKIT_API_SECRET=${signing}`, `DARSHAN_MEDIA_CONTROL_SECRET=${secret}`,
    `DARSHAN_MEDIA_NODE_INSTANCE_ID=${instance}`, `DARSHAN_MEDIA_PROTOCOL_TEST_INSTANCE=${instance}`,
    `DARSHAN_MEDIA_TEST_AUTHORITY_EPOCH=${epoch}`, `DARSHAN_MEDIA_PROTOCOL_TEST_IMAGE_SHA=${imageId}`,
    `DARSHAN_MEDIA_PROTOCOL_EXPECTED_CORE_SHA256=${sourceHash}`, 'DARSHAN_MEDIA_PROTOCOL_RUNTIME_TESTS=1',
    'DARSHAN_MEDIA_SUPERVISOR_STATE_FILE=/run/darshan-media-watchdog/supervisor.json',
    'DARSHAN_MEDIA_SFU_CONFIG_FILE=/run/darshan-media/sfu.yaml', 'DARSHAN_MEDIA_SFU_URL=http://127.0.0.1:19781',
    'DARSHAN_MEDIA_SIGNAL_PORT=19780', 'DARSHAN_MEDIA_SIGNAL_URL=ws://127.0.0.1:19780', 'DARSHAN_MEDIA_CONTROL_PORT=19784',
  ].join('\n'), { mode: 0o600 });
  stage = 'CREATE_CONTAINER';
  id = await docker('run', '--detach', '--name', name, '--network', 'none', '--restart', 'no', '--user', '1000:1000',
    '--memory', '256m', '--memory-swap', '256m', '--cpus', '1', '--pids-limit', '64', '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=16m',
    '--label', 'com.darshan.media.managed=1', '--label', 'com.darshan.media.role=media-node', '--label', `com.darshan.media.instance=${instance}`,
    '--mount', `type=bind,src=${privateDir},dst=/run/darshan-media,readonly`, '--mount', `type=bind,src=${stateDir},dst=/run/darshan-media-watchdog`,
    '--env-file', path.join(privateDir, 'node.env'), imageId);
  stage = 'IDENTITY_GUARD'; assert.match(id, /^[a-f0-9]{64}$/); await owned();
  stage = 'CONTROLLER_READINESS';
  await until(async () => {
    try { return (await docker('exec', id, 'node', '-e', 'fetch("http://127.0.0.1:19784/internal/health",{headers:{"x-darshan-media-secret":process.env.DARSHAN_MEDIA_CONTROL_SECRET}}).then(async r=>process.stdout.write((await r.json()).status)).catch(()=>process.exit(1))')) === 'ready'; }
    catch { return false; }
  }, 10_000);
  stage = 'PACKAGE_HASHES';
  const packageHashes = JSON.parse(await docker('exec', id, 'node', '-e', 'const f=require("fs"),c=require("crypto");process.stdout.write(JSON.stringify({node:process.versions.node,sdk:JSON.parse(f.readFileSync("node_modules/livekit-server-sdk/package.json")).version,files:Object.fromEntries(["package.json","package-lock.json"].map(p=>[p,c.createHash("sha256").update(f.readFileSync(p)).digest("hex")]))}));'));
  assert.match(packageHashes.node, /^20\./); assert.equal(packageHashes.sdk, '2.19.2');
  for (const file of ['package.json', 'package-lock.json']) assert.equal(packageHashes.files[file], createHash('sha256').update(await readFile(path.join(media, file))).digest('hex'));
  stage = 'WATCHDOG_READINESS';
  watchdog = spawn('python3', [path.join(media, 'host-watchdog.py'), '--docker-context', 'default', '--container-id', id,
    '--instance-id', instance, '--heartbeat', path.join(stateDir, 'supervisor.json'), '--heartbeat-uid', '1000'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let buffer = '';
  watchdog.stdout.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) { const boundary = buffer.indexOf('\n'); try { events.push(JSON.parse(buffer.slice(0, boundary))); } catch {} buffer = buffer.slice(boundary + 1); }
  });
  watchdog.stderr.on('data', () => {});
  await until(() => events.some(event => event.event === 'watchdog_ready'), 3000);
  await owned();
  stage = 'PROTOCOL_ASSERTIONS';
  let probe;
  try { probe = await execute('docker', ['--context', 'default', 'exec', id, 'node', '--test', '--test-concurrency=1', 'test/protocol-runtime.test.js'], { timeout: 30_000, maxBuffer: 131072 }); }
  catch (error) {
    await writeFile(path.join(local, `protocol-probe-${instance}.log`), String(error.stdout ?? '') + String(error.stderr ?? ''), { mode: 0o600 });
    throw new Error('Owned protocol assertions failed');
  }
  await writeFile(path.join(local, `protocol-probe-${instance}.log`), probe.stdout + probe.stderr, { mode: 0o600 });
  const checkLine = probe.stdout.split('\n').find(line => line.includes('"event":"protocol_sfu_checks_passed"'));
  assert.ok(checkLine, 'Actual protocol assertions must complete before fault injection');
  stage = 'HELD_PARTICIPANT';
  holder = spawn('docker', ['--context', 'default', 'exec', '--env', 'DARSHAN_MEDIA_PROTOCOL_HOLD=1', id, 'node', 'test/protocol-runtime.test.js'], { stdio: ['ignore', 'pipe', 'pipe'] });
  holder.stdout.on('data', () => {}); holder.stderr.on('data', () => {});
  const ready = await until(async () => { try { return JSON.parse(await readFile(path.join(stateDir, 'protocol-ready.json'), 'utf8')); } catch { return false; } });
  assert.equal(ready.instance_id, instance); assert.equal(ready.image_sha256, imageId); assert.equal(ready.core_source_sha256, sourceHash);
  const top = await docker('top', id, '-eo', 'pid,args');
  const sfuPid = Number(top.split('\n').map(line => /^\s*(\d+)\s+\/usr\/local\/bin\/livekit-server(?:\s|$)/.exec(line)).find(Boolean)?.[1]);
  assert.ok(sfuPid > 1); const initialStat = await readFile(`/proc/${sfuPid}/stat`, 'utf8');
  const startTicks = initialStat.slice(initialStat.lastIndexOf(')') + 2).split(' ')[19];
  await owned(); stage = 'WATCHDOG_FAULT'; const began = now(); await docker('kill', '--signal', 'STOP', id);
  const ended = await until(async () => {
    const state = await owned(); if (state.State.Running) return false;
    try { const stat = await readFile(`/proc/${sfuPid}/stat`, 'utf8'); if (stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] === startTicks && !/^\d+ \(.+\) Z /.test(stat)) return false; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert.equal(state.State.OOMKilled, false); assert.equal(state.State.ExitCode, 137); return now();
  }, 4000);
  await until(() => watchdog.exitCode !== null, 2000); assert.equal(watchdog.exitCode, 0);
  assert.ok(events.some(event => event.event === 'watchdog_killed_pinned_container' || event.event === 'watchdog_pinned_exit_observed'));
  const elapsed = Math.ceil(ended - began);
  const result = { status: elapsed <= 3000 ? 'PASS' : 'FAIL', instance_id: instance, container_id: id, image_id: imageId, image_tag: imageTag,
    base_image_id: baseId, build_scope: 'Offline developer source/test overlay; not canonical production deployment image',
    core_source_sha256: sourceHash, packages: packageHashes, actual_sfu_termination_upper_ms: elapsed, cutoff_bound_ms: 3000,
    actuation: 'Healthy local Docker daemon watchdog kill; direct pidfd permission gate remains open',
    protocol_assertions: JSON.parse(checkLine.slice(checkLine.indexOf('{'))), watchdog_events: events,
    scope: 'Actual isolated SFU/RPC/signaling and process death only; no production Backend, frame, physical audio or display claim' };
  await writeFile(resultFile, JSON.stringify(result, null, 2), { mode: 0o600 });
  resultWritten = true;
  assert.ok(elapsed <= 3000, 'Observed watchdog enforcement exceeded the bound');
  process.stdout.write(`${JSON.stringify({ status: result.status, result_file: resultFile, image_id: imageId, actual_sfu_termination_upper_ms: elapsed })}\n`);
} catch (error) {
  const diagnostics = {};
  if (id) {
    try {
      const state = await owned(); diagnostics.container = { running: state.State.Running, exit_code: state.State.ExitCode, oom_killed: state.State.OOMKilled };
      const logs = await execute('docker', ['--context', 'default', 'logs', id], { timeout: 2000, maxBuffer: 65536 });
      const raw = logs.stdout + logs.stderr;
      await writeFile(path.join(local, `protocol-node-${instance}.log`), raw, { mode: 0o600 });
      diagnostics.startup_codes = [...new Set(raw.match(/\b(?:SFU|ERR)_[A-Z_]+\b/g) ?? [])];
      diagnostics.fixture_stop_events = raw.split('\n').flatMap(line => {
        try { const event = JSON.parse(line); return event.event === 'protocol_fixture_stopped' ? [{ event: event.event, reason: event.reason }] : []; } catch { return []; }
      });
    } catch { diagnostics.container = { identity_or_diagnostics_unavailable: true }; }
  }
  if (!resultWritten) await writeFile(resultFile, JSON.stringify({ status: 'FAIL_OR_UNCONFIRMED', instance_id: instance, container_id: id ?? null,
    image_id: imageId ?? null, core_source_sha256: sourceHash, failure_stage: stage,
    failure_code: /^[A-Z0-9_]{1,80}$/.test(error.message ?? '') ? error.message : String(error.code ?? error.name ?? 'UNCONFIRMED'),
    diagnostics, watchdog_events: events,
    scope: 'Failed or incomplete owned fixture; cleanup is not enforcement evidence' }, null, 2), { mode: 0o600 });
  process.stderr.write(`Owned protocol runtime verification failed; inspect private artifacts at ${resultFile}\n`); process.exitCode = 1;
} finally {
  await stopChild(watchdog); await stopChild(holder);
  let cleanupSafe = true;
  if (id) { try { await owned(); await docker('rm', '--force', id); } catch { cleanupSafe = false; process.stderr.write('Owned fixture cleanup needs identity review; private fixture state retained\n'); process.exitCode = 1; } }
  if (baseTagged) await docker('image', 'rm', baseTag).catch(() => {});
  if (cleanupSafe) { await rm(privateDir, { recursive: true, force: true }); await rm(stateDir, { recursive: true, force: true }); }
}
