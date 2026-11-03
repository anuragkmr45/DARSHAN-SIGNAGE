import { writeFileSync, renameSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AdmissionController } from './controller.js';
import { LiveKitAdapter } from './livekit-adapter.js';
import { createControlServer, createSignalServer } from './gateway.js';
import { loadMediaRuntimeConfig } from './runtime-config.js';
import { createHostReadiness } from './host-readiness.js';

const executeFile = promisify(execFile);
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
export async function start() {
  let controller;
  const runtime = loadMediaRuntimeConfig(process.env, { supervised: Boolean(process.send),
    onAuthorityInvalid: () => { void controller?.isolateNode('AUTHORITY_CONFIGURATION_CHANGED'); } });
  const { upstreamUrl } = runtime;
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
    onDiagnostic: (code) => {
      if (process.env.DARSHAN_MEDIA_DIAGNOSTICS === '1' && process.send && process.connected) {
        try { process.send({ type: 'diagnostic', code }, () => {}); } catch { /* Isolation does not depend on diagnostics. */ }
      }
    },
  });
  const hostReadiness = runtime.backendAuthority ? createHostReadiness({ file: runtime.hostLeaseFile,
    nodeInstanceId: runtime.nodeInstanceId, managedInstanceId: runtime.managedInstanceId,
    onInvalid: () => { void controller?.isolateNode('HOST_READINESS_LOST'); } }) : undefined;
  controller = new AdmissionController({
    adapter,
    signalUrl: runtime.signalUrl, isolate, ready: false, managedInstanceId: runtime.managedInstanceId, hostReadiness,
    strictAuthority: runtime.backendAuthority ? { mode: 'backend', nodeInstanceId: runtime.nodeInstanceId,
      authorityEpoch: runtime.backendAuthority.epochId, verifyAuthority: runtime.backendAuthority.verifyAuthority } : undefined,
  });
  const signalServer = createSignalServer({ controller, adapter, upstreamUrl,
    allowedOrigins: runtime.allowedOrigins, tls: runtime.tlsOptions,
  });
  const controlServer = createControlServer({ controller, secret: runtime.controlSecret, tls: runtime.tlsOptions });
  let heartbeatSequence = 0;
  // The supervisor's short runtime deadline must exist before any admission can
  // be created. Its cold-start grace is only valid while both listeners are closed.
  if (process.send) await new Promise((resolve, reject) => {
    process.send({ type: 'heartbeat', sequence: ++heartbeatSequence }, (error) => {
      if (error) reject(new Error('INITIAL_SUPERVISOR_HEARTBEAT_FAILED'));
      else resolve();
    });
  });
  try {
    runtime.backendAuthority?.assertCurrent();
    await Promise.all([
      new Promise((resolve, reject) => signalServer.once('error', reject).listen(runtime.signalPort, runtime.signalHost, resolve)),
      new Promise((resolve, reject) => controlServer.once('error', reject).listen(runtime.controlPort, runtime.controlHost, resolve)),
    ]);
    controller.ready = true;
  } catch {
    signalServer.closeConnections(); signalServer.close(); controlServer.close();
    await controller.isolateNode('GATEWAY_STARTUP_FAILED'); throw new Error('GATEWAY_STARTUP_FAILED');
  }
  const heartbeatFile = process.env.DARSHAN_MEDIA_SUPERVISOR_HEARTBEAT_FILE;
  const timer = setInterval(() => {
    hostReadiness?.check();
    try { runtime.backendAuthority?.assertCurrent(); } catch { void controller.isolateNode('AUTHORITY_CONFIGURATION_CHANGED'); }
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
    controlServer.closeAllConnections(); controlServer.close();
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
