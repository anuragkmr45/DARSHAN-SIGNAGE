// Opt-in isolated runtime fixture, never a production Backend verifier.
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { supervise } from '../../src/supervisor.js';
import { AdmissionController } from '../../src/controller.js';
import { LiveKitAdapter } from '../../src/livekit-adapter.js';
import { createControlServer, createSignalServer } from '../../src/gateway.js';

const required = name => { const value = process.env[name]; if (!value) throw new Error('Missing private runtime fixture configuration'); return value; };
const instance = required('DARSHAN_MEDIA_NODE_INSTANCE_ID');
if (process.env.DARSHAN_MEDIA_PROTOCOL_RUNTIME_TESTS !== '1' || process.env.DARSHAN_MEDIA_PROTOCOL_TEST_INSTANCE !== instance
  || !/^[0-9a-f-]{36}$/i.test(instance)) throw new Error('Isolated runtime fixture identity required');

if (!process.send) {
  const stop = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop.abort());
  await supervise({ gatewayEntry: fileURLToPath(import.meta.url), signal: stop.signal, onStop: reason => {
    process.stdout.write(`${JSON.stringify({ event: 'protocol_fixture_stopped', reason })}\n`);
    process.exit(reason === 'SUPERVISOR_SHUTDOWN' ? 0 : 1);
  } });
} else {
  const secret = required('DARSHAN_MEDIA_CONTROL_SECRET');
  const epoch = required('DARSHAN_MEDIA_TEST_AUTHORITY_EPOCH');
  const authorityPort = Number(process.env.DARSHAN_MEDIA_TEST_AUTHORITY_PORT ?? 19785);
  const authorityUrl = `http://127.0.0.1:${authorityPort}`;
  const policies = new Map();
  const send = (response, status, body) => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(body));
  };
  const fixture = http.createServer(async (request, response) => {
    const supplied = request.headers['x-darshan-media-secret'];
    if (request.headers.origin || typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(secret)
      || !timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))) return send(response, 401, { error: 'UNAUTHORIZED' });
    try {
      let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 8192) throw new Error(); }
      const body = raw ? JSON.parse(raw) : {};
      const url = new URL(request.url, authorityUrl);
      const match = /^\/fixture\/policies\/([A-Za-z0-9_.:-]{1,128})$/.exec(url.pathname);
      if (match && request.method === 'PUT') {
        if (typeof body.run_id !== 'string' || !Number.isSafeInteger(body.generation) || body.generation < 1
          || !Number.isSafeInteger(body.operation_revision) || body.operation_revision < 1
          || !['presenter', 'receiver'].includes(body.role) || typeof body.participant_id !== 'string'
          || (body.allowed !== undefined && typeof body.allowed !== 'boolean')
          || typeof body.audio?.microphone !== 'boolean' || typeof body.audio?.screen_share_audio !== 'boolean'
          || !Number.isSafeInteger(body.delay_ms ?? 0) || (body.delay_ms ?? 0) < 0 || (body.delay_ms ?? 0) > 1000) throw new Error();
        const previous = policies.get(match[1]);
        policies.set(match[1], { ...body, checks: previous?.checks ?? 0,
          end: previous?.end ?? performance.now() + 60_000 });
        return send(response, 200, { registered: true });
      }
      if (match && request.method === 'GET') return send(response, 200, { checks: policies.get(match[1])?.checks ?? 0 });
      if (url.pathname !== '/fixture/check' || request.method !== 'POST') return send(response, 404, { error: 'NOT_FOUND' });
      const initial = policies.get(body.id);
      if (initial) initial.checks += 1;
      if (initial?.delay_ms) await new Promise(resolve => setTimeout(resolve, initial.delay_ms));
      const policy = policies.get(body.id);
      const allowed = Boolean(policy && policy.run_id === body.run_id && policy.generation === body.generation
        && policy.operation_revision === body.operation_revision && body.node_instance_id === instance
        && body.authority_epoch === epoch && policy.allowed !== false);
      return send(response, 200, { id: body.id, run_id: body.run_id, generation: body.generation,
        node_instance_id: instance, authority_epoch: epoch, operation_revision: body.operation_revision, nonce: body.nonce,
        allowed, participant_id: policy?.participant_id, role: policy?.role, audio: policy?.audio,
        lease_ms: 10_000, window_remaining_ms: policy ? Math.max(1, Math.floor(policy.end - performance.now())) : 1 });
    } catch { send(response, 422, { error: 'INVALID_FIXTURE_REQUEST' }); }
  });
  const adapter = new LiveKitAdapter({ url: required('DARSHAN_MEDIA_SFU_URL'), apiKey: required('LIVEKIT_API_KEY'), apiSecret: required('LIVEKIT_API_SECRET') });
  const controller = new AdmissionController({ adapter, signalUrl: required('DARSHAN_MEDIA_SIGNAL_URL'),
    isolate: () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { process.off('message', acknowledged); reject(new Error('Isolation unconfirmed')); }, 3000);
      const acknowledged = message => { if (message?.type === 'isolation-complete') { clearTimeout(timer); process.off('message', acknowledged); resolve(); } };
      process.on('message', acknowledged); process.send({ type: 'isolate', reason: 'PROTOCOL_RUNTIME_ENFORCEMENT' });
    }),
    strictAuthority: { nodeInstanceId: instance, authorityEpoch: epoch, verifyAuthority: async request => {
      const { signal, ...body } = request;
      const response = await fetch(`${authorityUrl}/fixture/check`, { method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'x-darshan-media-secret': secret }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error('Fixture authority unavailable');
      return response.json();
    } },
  });
  const control = createControlServer({ controller, secret });
  const signal = createSignalServer({ controller, adapter, upstreamUrl: required('DARSHAN_MEDIA_SFU_URL'), allowedOrigins: ['null'] });
  let sequence = 0;
  await new Promise((resolve, reject) => process.send({ type: 'heartbeat', sequence: ++sequence }, error => error ? reject(error) : resolve()));
  for (const [server, port] of [[fixture, authorityPort], [control, Number(process.env.DARSHAN_MEDIA_CONTROL_PORT ?? 19784)],
    [signal, Number(process.env.DARSHAN_MEDIA_SIGNAL_PORT ?? 19780)]]) {
    await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve));
  }
  const heartbeat = setInterval(() => { void controller.sweep(); if (!controller.isolated) process.send({ type: 'heartbeat', sequence: ++sequence }, () => {}); }, 100);
  const close = () => { clearInterval(heartbeat); signal.closeConnections(); for (const server of [fixture, control, signal]) { server.closeAllConnections?.(); server.close(); } };
  process.once('SIGTERM', close); process.once('SIGINT', close); process.once('disconnect', close);
  process.send({ type: 'ready' });
}
