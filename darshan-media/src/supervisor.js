import { spawn, fork } from 'node:child_process';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, lstatSync, statfsSync, openSync, writeFileSync, closeSync, renameSync, unlinkSync, constants } from 'node:fs';
import path from 'node:path';
import { ownsSfuListener, readSfuProcessStartTicks } from './sfu-listener-ownership.js';
import { randomUUID } from 'node:crypto';
import { createHostReadiness } from './host-readiness.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function waitExit(child, timeoutMs = 1000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let timer;
  try {
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); })]);
  } finally { clearTimeout(timer); }
}
async function tcpReady(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(150);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

/** Supervisor-owned host-watchdog evidence. Never substitute a controller heartbeat. */
export function createSupervisorHeartbeat(file, instance, { boottimeNow = () => Math.floor(Number(readFileSync('/proc/uptime', 'utf8').split(' ')[0]) * 1000), authorityNodeInstanceId } = {}) {
  if (!file && !instance) return undefined;
  if (!file || !path.isAbsolute(file) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(instance ?? '')) throw new Error('Invalid supervisor watchdog configuration');
  if (authorityNodeInstanceId !== undefined && !uuid.test(authorityNodeInstanceId)) throw new Error('Invalid authority boot identity');
  let component = path.parse(file).root;
  const parts = file.slice(component.length).split(path.sep);
  for (const part of parts.slice(0, -1)) {
    component = path.join(component, part);
    if (lstatSync(component).isSymbolicLink()) throw new Error('Watchdog directory cannot contain symlinks');
  }
  const directory = path.dirname(file);
  const parent = lstatSync(directory);
  if (!parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o077) !== 0) throw new Error('Watchdog directory must be privately owned by the media UID');
  // Linux TMPFS_MAGIC: volatile runtime evidence must not block behind disk writeback.
  if (statfsSync(directory).type !== 0x01021994) {
    const error = new Error('Supervisor heartbeat directory must use tmpfs (a private volatile /run directory)');
    error.code = 'SUPERVISOR_HEARTBEAT_REQUIRES_TMPFS';
    throw error;
  }
  const bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  const ownStat = readFileSync('/proc/self/stat', 'utf8');
  const processStartTicks = ownStat.slice(ownStat.lastIndexOf(')') + 2).split(' ')[19];
  let sequence = 0;
  let lastBoottime;
  return {
    write(phase) {
      try {
        const existing = lstatSync(file);
        if (!existing.isFile() || existing.isSymbolicLink() || existing.uid !== process.getuid() || existing.nlink !== 1 || (existing.mode & 0o077) !== 0) throw new Error('Invalid watchdog file');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const boottime = boottimeNow();
      if (!Number.isSafeInteger(boottime) || boottime <= 0) throw new Error('Host boot clock unavailable');
      if (lastBoottime !== undefined && (boottime < lastBoottime || boottime - lastBoottime > 1500)) throw new Error('Supervisor boot-clock gap requires isolation');
      const value = { schema_version: 1, instance_id: instance, supervisor_pid: process.pid,
        process_start_ticks: processStartTicks, sequence: ++sequence,
        boottime_ms: boottime, boot_id: bootId, phase,
        ...(authorityNodeInstanceId ? { authority_node_instance_id: authorityNodeInstanceId } : {}) };
      const temporary = path.join(directory, `.heartbeat-${instance}-${sequence}.tmp`);
      const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(fd, JSON.stringify(value)); } finally { closeSync(fd); }
      try { renameSync(temporary, file); } catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
      lastBoottime = boottime;
    },
  };
}

/** Separate PID1 process: controller liveness is never supervised by its own event loop. */
export async function supervise({
  sfuCommand = ['/usr/local/bin/livekit-server', '--config', process.env.DARSHAN_MEDIA_SFU_CONFIG_FILE ?? '/run/darshan-media/livekit.yaml'],
  gatewayEntry = fileURLToPath(new URL('./index.js', import.meta.url)),
  // Reserve 200 ms for watchdog polling and process shutdown inside the 2 s external bound.
  env = process.env, startupMs = 10_000, heartbeatMs = 1800, checkMs = 100,
  onStop = () => {}, signal,
} = {}) {
  if (process.platform !== 'linux') throw Object.assign(new Error('SFU_LISTENER_OWNERSHIP_UNAVAILABLE'), { code: 'SFU_LISTENER_OWNERSHIP_UNAVAILABLE' });
  const upstream = new URL(env.DARSHAN_MEDIA_SFU_URL ?? 'http://127.0.0.1:18781');
  if (upstream.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(upstream.hostname)) throw new Error('SFU must bind numeric loopback');
  const backend = env.DARSHAN_MEDIA_AUTHORITY_MODE === 'backend';
  if (backend && (!env.DARSHAN_MEDIA_SUPERVISOR_STATE_FILE || !uuid.test(env.DARSHAN_MEDIA_NODE_INSTANCE_ID ?? '') || !path.isAbsolute(env.DARSHAN_MEDIA_HOST_LEASE_FILE ?? ''))) throw new Error('Backend supervision configuration required');
  // Authority identity is fresh per supervisor invocation even if a host
  // mistakenly restarts a container with its previous managed label/config.
  const authorityNodeInstanceId = backend ? randomUUID() : undefined;
  const childEnv = backend ? { ...env, DARSHAN_MEDIA_AUTHORITY_INSTANCE_ID: authorityNodeInstanceId } : env;
  const heartbeat = createSupervisorHeartbeat(env.DARSHAN_MEDIA_SUPERVISOR_STATE_FILE, env.DARSHAN_MEDIA_NODE_INSTANCE_ID, { authorityNodeInstanceId });
  heartbeat?.write('STARTING'); // Must succeed before either media child can run.
  const sfu = spawn(sfuCommand[0], sfuCommand.slice(1), { env: childEnv, stdio: 'ignore' });
  let gateway;
  let timer;
  let lastHeartbeat = performance.now();
  let lastSequence = 0;
  let admissionsReady = false;
  let stopPromise;
  let stopped = false;
  let fault;
  let phase = 'STARTING';
  let hostHeartbeatTimer;
  const stop = (reason) => {
    if (stopPromise) return stopPromise;
    stopped = true;
    clearInterval(timer);
    clearInterval(hostHeartbeatTimer);
    try { heartbeat?.write('STOPPING'); } catch { /* Shutdown must still kill the SFU. */ }
    // LiveKit SIGTERM drains existing rooms. Enforcement needs SIGKILL to end media now.
    sfu.kill('SIGKILL');
    stopPromise = (async () => {
      await waitExit(sfu, 500);
      const confirmedDead = sfu.exitCode !== null || sfu.signalCode !== null;
      if (gateway?.connected && confirmedDead) gateway.send({ type: 'isolation-complete' }, () => {});
      gateway?.kill('SIGTERM');
      if (gateway) {
        await waitExit(gateway, 500);
        if (gateway.exitCode === null && gateway.signalCode === null) gateway.kill('SIGKILL');
        await waitExit(gateway);
      }
      onStop(reason);
    })();
    return stopPromise;
  };
  const hostReadiness = backend ? createHostReadiness({ file: env.DARSHAN_MEDIA_HOST_LEASE_FILE, nodeInstanceId: authorityNodeInstanceId,
    managedInstanceId: env.DARSHAN_MEDIA_NODE_INSTANCE_ID, onInvalid: () => { void stop('HOST_READINESS_LOST'); } }) : undefined;
  sfu.once('error', () => { fault = 'SFU_START_FAILED'; void stop(fault); });
  sfu.once('exit', () => { if (!stopped) { fault = 'SFU_EXIT'; void stop(fault); } });
  if (heartbeat) hostHeartbeatTimer = setInterval(() => {
    try { hostReadiness?.check(); if (!stopped) heartbeat.write(phase); } catch { void stop('SUPERVISOR_HEARTBEAT_WRITE_FAILED'); }
  }, 100);
  signal?.addEventListener('abort', () => { void stop('SUPERVISOR_SHUTDOWN'); }, { once: true });
  if (signal?.aborted) await stop('SUPERVISOR_SHUTDOWN');
  const started = performance.now();
  let sfuStartTicks;
  try { sfuStartTicks = readSfuProcessStartTicks(sfu.pid); }
  catch (error) { fault = error.code; await stop(fault); }
  while (!stopped) {
    try {
      const target = { pid: sfu.pid, host: upstream.hostname, port: Number(upstream.port || 80), startTicks: sfuStartTicks };
      if (ownsSfuListener(target) && await tcpReady(upstream.hostname.replace(/^\[|\]$/g, ''), target.port)
        && ownsSfuListener(target)) break;
    } catch (error) { fault = error.code; await stop(fault); break; }
    if (performance.now() - started > startupMs) { fault = 'SFU_START_TIMEOUT'; await stop(fault); }
    else await delay(50);
  }
  if (stopped) throw Object.assign(new Error(fault ?? 'SUPERVISOR_STOPPED'), { code: fault ?? 'SUPERVISOR_STOPPED' });
  gateway = fork(gatewayEntry, [], { env: childEnv, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  lastHeartbeat = performance.now();
  gateway.on('message', (message) => {
    if (message?.type === 'ready' && !admissionsReady) {
      admissionsReady = true;
      lastHeartbeat = performance.now();
      phase = 'RUNNING';
    } else if (message?.type === 'heartbeat' && Number.isSafeInteger(message.sequence) && message.sequence > lastSequence) {
      lastSequence = message.sequence;
      lastHeartbeat = performance.now();
    } else if (message?.type === 'isolate') {
      void stop('ENFORCEMENT_ISOLATION');
    }
  });
  gateway.once('error', () => { void stop('CONTROLLER_START_FAILED'); });
  gateway.once('exit', () => { if (!stopped) void stop('CONTROLLER_EXIT'); });
  gateway.once('disconnect', () => { if (!stopped) void stop('CONTROLLER_IPC_LOST'); });
  timer = setInterval(() => {
    if (performance.now() - lastHeartbeat > (lastSequence || admissionsReady ? heartbeatMs : startupMs)) void stop('CONTROLLER_HEARTBEAT_EXPIRED');
  }, checkMs);
  return { sfu, gateway, stop, authorityNodeInstanceId };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const abort = new AbortController();
  const terminate = () => { abort.abort(); };
  process.once('SIGTERM', terminate);
  process.once('SIGINT', terminate);
  supervise({ signal: abort.signal, onStop: (reason) => {
    process.stderr.write(`DARSHAN media supervisor stopped: ${reason}\n`);
    process.exit(reason === 'SUPERVISOR_SHUTDOWN' ? 0 : 1);
  } }).then(() => {
    process.stdout.write('DARSHAN media supervisor running\n');
  }).catch((error) => {
    process.stderr.write(error?.code === 'SUPERVISOR_HEARTBEAT_REQUIRES_TMPFS'
      ? 'DARSHAN media supervisor startup refused: heartbeat directory must use private tmpfs under /run\n'
      : 'DARSHAN media supervisor startup failed\n');
    process.exitCode = 1;
  });
}
