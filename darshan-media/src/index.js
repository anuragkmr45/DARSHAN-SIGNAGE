import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AdmissionController } from './controller.js';
import { LiveKitAdapter } from './livekit-adapter.js';
import { createControlServer, createSignalServer } from './gateway.js';

const executeFile = promisify(execFile);
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const port = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) throw new Error(`Invalid ${name}`);
  return value;
};

export async function start() {
  // Strict authority is an injected prerequisite only. Do not expose a partially
  // wired production path by accepting prototype grants under a production flag.
  if ((process.env.DARSHAN_MEDIA_AUTHORITY_MODE ?? 'prototype') !== 'prototype') {
    throw new Error('Production media authority adapter is not configured');
  }
  const upstreamUrl = process.env.DARSHAN_MEDIA_SFU_URL ?? 'http://127.0.0.1:18781';
  const controlSecret = process.env.DARSHAN_MEDIA_CONTROL_SECRET_FILE
    ? readFileSync(process.env.DARSHAN_MEDIA_CONTROL_SECRET_FILE, 'utf8').trim()
    : required('DARSHAN_MEDIA_CONTROL_SECRET');
  const controlHost = process.env.DARSHAN_MEDIA_CONTROL_HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '::1'].includes(controlHost)) throw new Error('Control API must bind loopback');
  let isolate;
  if (process.send) {
    isolate = (reason) => new Promise((resolve, reject) => {
      const onMessage = (message) => {
        if (message?.type !== 'isolation-complete') return;
        clearTimeout(timer);
        process.off('message', onMessage);
        resolve();
      };
      const timer = setTimeout(() => { process.off('message', onMessage); reject(new Error('ISOLATION_ACK_TIMEOUT')); }, 3000);
      process.on('message', onMessage);
      process.send({ type: 'isolate', reason }, (error) => {
        if (error) { clearTimeout(timer); process.off('message', onMessage); reject(new Error('SUPERVISOR_UNAVAILABLE')); }
      });
    });
  } else {
    const isolateCommand = JSON.parse(required('DARSHAN_MEDIA_ISOLATE_COMMAND'));
    if (!Array.isArray(isolateCommand) || isolateCommand.length === 0 || isolateCommand.some((part) => typeof part !== 'string' || !part)) {
      throw new Error('Isolation command must be a JSON argv array');
    }
    isolate = async () => {
      // Never execute a shell, print command output, or expose arguments in diagnostics.
      await executeFile(isolateCommand[0], isolateCommand.slice(1), { timeout: 750, maxBuffer: 16384 });
    };
  }
  const adapter = new LiveKitAdapter({
    url: upstreamUrl, apiKey: required('LIVEKIT_API_KEY'), apiSecret: required('LIVEKIT_API_SECRET'),
  });
  const controller = new AdmissionController({
    adapter,
    signalUrl: process.env.DARSHAN_MEDIA_SIGNAL_URL ?? 'ws://127.0.0.1:18780',
    isolate,
  });
  const signalServer = createSignalServer({ controller, adapter, upstreamUrl,
    allowedOrigins: (process.env.DARSHAN_MEDIA_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean),
  });
  const controlServer = createControlServer({ controller, secret: controlSecret });
  let heartbeatSequence = 0;
  // The supervisor's short runtime deadline must exist before any admission can
  // be created. Its cold-start grace is only valid while both listeners are closed.
  if (process.send) await new Promise((resolve, reject) => {
    process.send({ type: 'heartbeat', sequence: ++heartbeatSequence }, (error) => {
      if (error) reject(new Error('INITIAL_SUPERVISOR_HEARTBEAT_FAILED'));
      else resolve();
    });
  });
  await Promise.all([
    new Promise((resolve, reject) => signalServer.once('error', reject).listen(port('DARSHAN_MEDIA_SIGNAL_PORT', 18780), process.env.DARSHAN_MEDIA_SIGNAL_HOST ?? '127.0.0.1', resolve)),
    new Promise((resolve, reject) => controlServer.once('error', reject).listen(port('DARSHAN_MEDIA_CONTROL_PORT', 18784), controlHost, resolve)),
  ]);
  const heartbeatFile = process.env.DARSHAN_MEDIA_SUPERVISOR_HEARTBEAT_FILE;
  const timer = setInterval(() => {
    void controller.sweep();
    if (process.send && !controller.isolated) {
      process.send({ type: 'heartbeat', sequence: ++heartbeatSequence }, (error) => {
        if (error) void controller.isolateNode('SUPERVISOR_UNAVAILABLE');
      });
    }
    if (heartbeatFile && !controller.isolated) {
      try {
        writeFileSync(`${heartbeatFile}.tmp`, JSON.stringify({ pid: process.pid, monotonic_ms: Math.floor(performance.now()) }), { mode: 0o600 });
        renameSync(`${heartbeatFile}.tmp`, heartbeatFile);
      } catch { void controller.isolateNode('SUPERVISOR_HEARTBEAT_FAILED'); }
    }
  }, 100);
  timer.unref();
  const shutdown = async () => {
    clearInterval(timer);
    await controller.isolateNode('GATEWAY_SHUTDOWN');
    signalServer.closeConnections();
    signalServer.close();
    controlServer.close();
  };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
  process.once('disconnect', () => { void shutdown(); });
  process.send?.({ type: 'ready' });
  return { controller, signalServer, controlServer, shutdown };
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  start().then(() => process.stdout.write('DARSHAN media admission service ready\n')).catch(() => {
    // Configuration/SDK exceptions may contain credentials or URL query strings.
    process.stderr.write('DARSHAN media service startup failed; verify private configuration\n');
    process.exitCode = 1;
  });
}
