// Deliberately separate from production authorization. Only for the loop-1
// media/security experiment; PostgreSQL-backed scheduling comes after this gate.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
export function createPrototypeAuthority(options) {
  const { controlUrl, controlSecret, presenterToken, receiverToken, receiverSessionId } = options;
  // Explicit loopback HTTPS proxy only. Forwarded headers cannot opt a request
  // into another origin, and production hosts are never accepted by this harness.
  const publicOrigin = options.publicOrigin;
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (url.protocol !== 'https:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.origin !== publicOrigin || url.username || url.password) throw new Error('Only an exact loopback HTTPS prototype origin is allowed');
  }
  const windowMs = options.windowMs ?? 600_000;
  const now = options.now ?? performance.now.bind(performance);
  let run;
  let starting = false;
  let stopping;
  const clients = new Map();
  const refreshing = new Set();
  const requests = new Map();
  const matches = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const send = (res, status, data) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(data));
  };
  const control = async (route, method, body) => {
    const response = await fetch(`${controlUrl}${route}`, {
      method, headers: { 'content-type': 'application/json', 'x-darshan-media-secret': controlSecret },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) { const e = new Error('Media control operation failed'); e.status = response.status; throw e; }
    return response.status === 204 ? {} : response.json();
  };
  const stop = () => {
    if (stopping) return stopping;
    if (!run) return Promise.resolve();
    run.stopped = true;
    stopping = Promise.allSettled([...clients.values()].map(c => control(`/internal/admissions/${c.id}`, 'DELETE')))
      .then(results => {
        if (results.some(r => r.status === 'rejected')) throw new Error('Prototype teardown requires media-node reconciliation');
        clients.clear();
      }).finally(() => { stopping = undefined; });
    return stopping;
  };
  const bodyOf = async req => {
    let data = '';
    for await (const chunk of req) { data += chunk; if (data.length > 4096) throw new Error('Request too large'); }
    return data ? JSON.parse(data) : {};
  };
  const timer = setInterval(() => {
    if (run && !run.stopped && (now() >= run.end || now() - run.presenterRenewed >= 10_000)) void stop().catch(() => {});
  }, 100);
  timer.unref();
  const server = http.createServer(async (req, res) => {
    try {
      // Reject host rebinding and cross-origin requests even on loopback.
      let requestHost;
      try { requestHost = new URL(`http://${req.headers.host}`).hostname; } catch { /* reject below */ }
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(requestHost)) return send(res, 403, { error: 'LOOPBACK_ONLY' });
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== publicOrigin) return send(res, 403, { error: 'ORIGIN_DENIED' });
      const route = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && ['/', '/presenter.js'].includes(route)) {
        const file = route === '/' ? 'index.html' : 'dist/presenter.js';
        res.writeHead(200, { 'content-type': route === '/' ? 'text/html; charset=utf-8' : 'text/javascript', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
        return res.end(await readFile(path.join(root, file)));
      }
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      const isPresenter = matches(token, presenterToken);
      const isReceiver = matches(token, receiverToken);
      if (!isPresenter && !isReceiver) return send(res, 401, { error: 'PROTOTYPE_SESSION_REQUIRED' });
      if (route === '/prototype/start' && req.method === 'POST' && isPresenter) {
        const body = await bodyOf(req);
        if (typeof body.presenter_session_id !== 'string' || !body.presenter_session_id || body.presenter_session_id.length > 100) return send(res, 422, { error: 'SESSION_REQUIRED' });
        if (typeof body.request_id !== 'string' || !/^[A-Za-z0-9-]{16,80}$/.test(body.request_id)) return send(res, 422, { error: 'REQUEST_ID_REQUIRED' });
        const previous = requests.get(body.request_id);
        if (previous) return previous.owner === body.presenter_session_id
          ? send(res, 200, { run_id: previous.id, generation: previous.generation })
          : send(res, 409, { error: 'REQUEST_ID_CONFLICT' });
        if (starting || stopping) return send(res, 409, { error: 'TRANSITION_IN_PROGRESS' });
        if (run && !run.stopped) {
          if (run.owner !== body.presenter_session_id) return send(res, 409, { error: 'PRESENTER_ALREADY_ACTIVE' });
          return send(res, 200, { run_id: run.id, generation: run.generation });
        }
        if (clients.size) return send(res, 409, { error: 'TEARDOWN_NOT_CONFIRMED' });
        starting = true;
        try {
          run = { id: randomUUID(), generation: 1, request_id: body.request_id, owner: body.presenter_session_id, presenter: `presenter-${randomUUID()}`, end: now() + windowMs, presenterRenewed: now(), stopped: false,
            audio: { microphone: body.microphone === true, screen_share_audio: body.screen_share_audio === true } };
          requests.set(body.request_id, run);
          if (requests.size > 100) requests.delete(requests.keys().next().value);
          return send(res, 200, { run_id: run.id, generation: run.generation });
        } finally { starting = false; }
      }
      if (route === '/prototype/stop' && req.method === 'POST' && isPresenter) {
        const body = await bodyOf(req);
        if (run && run.owner !== body.presenter_session_id) return send(res, 403, { error: 'WRONG_PRESENTER_SESSION' });
        if (!run || (body.run_id !== run.id && body.request_id !== run.request_id) || (body.generation !== undefined && body.generation !== run.generation)) return send(res, 409, { error: 'STALE_RUN' });
        await stop(); return send(res, 200, { stopped: true });
      }
      if (route === '/prototype/status' && req.method === 'GET') return send(res, 200, {
        run_id: run?.id ?? null, stopped: !run || run.stopped,
        remaining_ms: run ? Math.max(0, Math.floor(run.end - now())) : 0,
        presenter_identity: run?.presenter ?? null,
        presenter_admission_id: clients.get(`presenter:${run?.owner}`)?.id ?? null,
        receiver_admission_id: clients.get(`receiver:${receiverSessionId}`)?.id ?? null,
      });
      const role = route === '/prototype/authority/presenter' ? 'presenter' : route === '/prototype/authority/receiver' ? 'receiver' : null;
      if (!role || req.method !== 'POST') return send(res, 404, { error: 'NOT_FOUND' });
      if ((role === 'presenter' && !isPresenter) || (role === 'receiver' && !isReceiver)) return send(res, 403, { error: 'WRONG_ROLE' });
      const body = await bodyOf(req);
      const session = role === 'presenter' ? body.presenter_session_id : body.receiver_session_id;
      if (role === 'receiver' && session !== receiverSessionId) return send(res, 403, { error: 'WRONG_RECEIVER_SESSION' });
      if (!run || run.stopped || now() >= run.end || now() - run.presenterRenewed >= 10_000) return send(res, 410, { error: 'RUN_ENDED' });
      if (role === 'presenter' && session !== run.owner) return send(res, 409, { error: 'PRESENTER_ALREADY_ACTIVE' });
      if (role === 'presenter' && (body.run_id !== run.id || body.generation !== run.generation)) return send(res, 409, { error: 'STALE_RUN' });
      const capturedRun = run;
      const key = `${role}:${session}`;
      if (refreshing.has(key)) return send(res, 409, { error: 'ADMISSION_PREPARING' });
      let admission = clients.get(key);
      const timing = { generation: run.generation, lease_ms: Math.floor(Math.min(10_000, run.end - now())), window_remaining_ms: Math.floor(Math.max(0, run.end - now())) };
      let granted;
      refreshing.add(key);
      try {
      if (!admission) {
        admission = { id: randomUUID(), participant_id: role === 'presenter' ? run.presenter : `receiver-${randomUUID()}` };
        // Claim synchronously before awaiting control, preventing parallel creates.
        clients.set(key, admission);
        try {
          granted = await control('/internal/admissions', 'POST', { ...timing, ...admission, run_id: run.id, role, audio: run.audio });
          admission.signal_url = granted.signal_url;
        } catch (error) { clients.delete(key); throw error; }
      } else {
        if (!admission.signal_url) return send(res, 409, { error: 'ADMISSION_PREPARING' });
        granted = await control(`/internal/admissions/${admission.id}/renew`, 'POST', timing);
        if (body.reconnect === true) granted = { ...granted, ...await control(`/internal/admissions/${admission.id}/ticket`, 'POST', { generation: run.generation }) };
      }
      if (capturedRun !== run || run.stopped || now() >= run.end || now() - run.presenterRenewed >= 10_000) {
        await control(`/internal/admissions/${admission.id}`, 'DELETE');
        // Stop can reach the control plane before an in-flight create and get
        // 404. This successful post-create deletion confirms its reconciliation.
        // A late attempt must never erase a replacement admission at this key.
        if (clients.get(key) === admission) clients.delete(key);
        return send(res, 410, { error: 'RUN_ENDED' });
      }
      if (role === 'presenter') run.presenterRenewed = now();
      return send(res, 200, { ...granted, ...timing, signal_url: admission.signal_url, admission_id: admission.id, run_id: run.id, generation: run.generation, presenter_identity: run.presenter });
      } finally { refreshing.delete(key); }
    } catch (error) { send(res, error.status ?? 503, { error: 'PROTOTYPE_OPERATION_FAILED' }); }
  });
  server.on('close', () => clearInterval(timer));
  return { server, stop, close: async () => { clearInterval(timer); await stop(); await new Promise(resolve => server.close(resolve)); } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.DARSHAN_LIVE_PROTOTYPE !== '1') throw new Error('Explicit prototype mode is required');
  const required = ['PROTO_CONTROL_SECRET', 'PROTO_PRESENTER_TOKEN', 'PROTO_RECEIVER_TOKEN', 'PROTO_RECEIVER_SESSION_ID'];
  if (required.some(k => !process.env[k] || process.env[k].length < 16)) throw new Error('Protected prototype session configuration is required');
  const authority = createPrototypeAuthority({ controlUrl: process.env.PROTO_CONTROL_URL ?? 'http://127.0.0.1:18784', controlSecret: process.env.PROTO_CONTROL_SECRET, presenterToken: process.env.PROTO_PRESENTER_TOKEN, receiverToken: process.env.PROTO_RECEIVER_TOKEN, receiverSessionId: process.env.PROTO_RECEIVER_SESSION_ID, windowMs: Number(process.env.PROTO_WINDOW_MS ?? 600_000), publicOrigin: process.env.PROTO_PUBLIC_ORIGIN });
  const port = Number(process.env.PROTO_PORT ?? 18130);
  authority.server.listen(port, '127.0.0.1', () => console.log(`Live prototype listening on loopback port ${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void authority.close().finally(() => process.exit()));
}
