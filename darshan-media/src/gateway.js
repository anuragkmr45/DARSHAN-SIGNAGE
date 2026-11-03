import http from 'node:http';
import https from 'node:https';
import { createHash, timingSafeEqual } from 'node:crypto';
import { MediaError } from './controller.js';

const digest = (value) => createHash('sha256').update(value).digest();
const send = (response, status, value) => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
};
const errorValue = (error) => ({ error: error instanceof MediaError ? error.code : 'MEDIA_OPERATION_FAILED' });
const createServer = (tls, listener) => {
  if (!tls) return http.createServer(listener);
  if (!tls.cert || !tls.key) throw new Error('TLS certificate and key are required');
  return https.createServer({ cert: tls.cert, key: tls.key, minVersion: 'TLSv1.2', handshakeTimeout: 5000 }, listener);
};

async function readBody(request) {
  if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) throw new MediaError('JSON_REQUIRED', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new MediaError('BODY_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new MediaError('INVALID_JSON', 400); }
}

export function createControlServer({ controller, secret, tls }) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('A control secret of at least 32 characters is required');
  const expected = digest(secret);
  return createServer(tls, async (request, response) => {
    const supplied = request.headers['x-darshan-media-secret'];
    // A browser must never invoke the private control surface, even on loopback.
    if (request.headers.origin !== undefined || typeof supplied !== 'string' || !timingSafeEqual(digest(supplied), expected)) {
      send(response, 401, { error: 'UNAUTHORIZED' });
      return;
    }
    try {
      const url = new URL(request.url, 'http://control.invalid');
      if (request.method === 'GET' && url.pathname === '/internal/health') {
        const health = controller.health(); send(response, health.status === 'ready' ? 200 : 503, health);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/internal/admissions') {
        send(response, 201, await controller.createAuthorized(await readBody(request)));
        return;
      }
      const run = /^\/internal\/runs\/([A-Za-z0-9_.:-]+)(?:\/(revoke))?$/.exec(url.pathname);
      if (run) {
        if (request.method === 'POST' && run[2] === 'revoke') {
          send(response, 200, await controller.revokeRunAuthorized(run[1], await readBody(request)));
        } else if (request.method === 'GET' && !run[2]) {
          const generation = Number(url.searchParams.get('generation'));
          if (!Number.isSafeInteger(generation) || generation <= 0) throw new MediaError('INVALID_GENERATION', 400);
          send(response, 200, controller.runView(run[1], generation));
        } else throw new MediaError('NOT_FOUND', 404);
        return;
      }
      const match = /^\/internal\/admissions\/([A-Za-z0-9_.:-]+)(?:\/(renew|ticket))?$/.exec(url.pathname);
      if (!match) throw new MediaError('NOT_FOUND', 404);
      const [, id, action] = match;
      if (request.method === 'GET' && !action) {
        send(response, 200, controller.admissionView(id));
      } else if (request.method === 'DELETE' && !action) {
        const body = controller.strictAuthority ? await readBody(request) : undefined;
        send(response, 200, await controller.revokeAuthorized(id, body));
      } else if (request.method === 'POST' && action === 'renew') {
        send(response, 200, await controller.renewAuthorized(id, await readBody(request)));
      } else if (request.method === 'POST' && action === 'ticket') {
        const body = await readBody(request);
        send(response, 200, await controller.issueTicketAuthorized(id, body));
      } else throw new MediaError('NOT_FOUND', 404);
    } catch (error) {
      send(response, error instanceof MediaError ? error.status : 500, errorValue(error));
    }
  });
}

export function createSignalServer({ controller, adapter, upstreamUrl, allowedOrigins = [], upgradeTimeoutMs = 5000, tls }) {
  const upstream = new URL(upstreamUrl);
  if (upstream.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname) ||
    upstream.username || upstream.password || upstream.pathname !== '/' || upstream.search || upstream.hash) {
    throw new Error('SFU signaling must use an HTTP loopback endpoint');
  }
  const origins = new Set(allowedOrigins);
  const server = createServer(tls, (request, response) => {
    try {
      const url = new URL(request.url, 'http://signal.invalid');
      if (request.method !== 'GET' || !['/rtc/validate', '/rtc/v1/validate'].includes(url.pathname)) throw new MediaError('NOT_FOUND', 404);
      if (request.headers.origin !== undefined && !origins.has(request.headers.origin)) throw new MediaError('ORIGIN_DENIED', 403);
      if (request.headers.origin !== undefined) {
        response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
        response.setHeader('Vary', 'Origin');
      }
      if (url.searchParams.getAll('access_token').length !== 1 || request.headers.authorization) throw new MediaError('INVALID_TICKET', 401);
      controller.inspectTicket(url.searchParams.get('access_token'));
      send(response, 200, { status: 'valid' });
    } catch (error) { send(response, error instanceof MediaError ? error.status : 500, errorValue(error)); }
  });
  const sockets = new Set();
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.closeConnections = () => { for (const socket of sockets) socket.destroy(); };
  server.on('upgrade', async (request, socket, head) => {
    let entry;
    let proxyRequest;
    let upstreamSocket;
    let closed = false;
    let joinSettled = false;
    let resolveJoin;
    const pendingJoin = new Promise((resolve) => { resolveJoin = resolve; });
    const closeUpstream = () => { proxyRequest?.destroy(); upstreamSocket?.destroy(); };
    const settleJoin = (outcome) => {
      if (joinSettled) return;
      joinSettled = true;
      resolveJoin(outcome);
      if (closed) closeUpstream();
    };
    const cleanup = () => {
      if (closed) return;
      closed = true;
      socket.destroy();
      // Observe an inflight upstream join until its participant is confirmed or node isolation occurs.
      if (joinSettled || !proxyRequest) closeUpstream();
      if (entry) void controller.disconnect(entry.id);
    };
    const reject = (status) => {
      if (!socket.destroyed) socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      cleanup();
    };
    socket.on('error', cleanup);
    socket.on('close', cleanup);
    socket.on('end', cleanup);
    try {
      const url = new URL(request.url, 'http://signal.invalid');
      if (!['/rtc', '/rtc/v1'].includes(url.pathname)) throw new MediaError('NOT_FOUND', 404);
      if (request.headers.origin !== undefined && !origins.has(request.headers.origin)) throw new MediaError('ORIGIN_DENIED', 403);
      if (url.searchParams.getAll('access_token').length !== 1 || request.headers.authorization) throw new MediaError('INVALID_TICKET', 401);
      entry = controller.consumeTicket(url.searchParams.get('access_token'));
      const token = await adapter.createToken(entry);
      controller.assertCurrent(entry, entry.generation);
      if (closed) throw new MediaError('CONNECTION_CLOSED', 410);
      url.searchParams.set('access_token', token);
      // Clients cannot smuggle another upstream path, header credential or host.
      const headers = { ...request.headers, host: upstream.host };
      delete headers.authorization;
      delete headers.cookie;
      delete headers['x-darshan-media-secret'];
      controller.registerPendingJoin(entry, { settled: pendingJoin, closeClient: cleanup, abort: closeUpstream });
      proxyRequest = http.request({
        hostname: upstream.hostname.replace(/^\[|\]$/g, ''), port: upstream.port,
        path: `${url.pathname}${url.search}`, method: 'GET', headers,
      });
      proxyRequest.setTimeout(upgradeTimeoutMs, () => { settleJoin('UNCERTAIN'); reject(504); });
      proxyRequest.on('upgrade', async (response, remoteSocket, remoteHead) => {
        upstreamSocket = remoteSocket;
        proxyRequest.setTimeout(0);
        remoteSocket.setTimeout(0);
        remoteSocket.pause();
        remoteSocket.on('error', () => { settleJoin('UNCERTAIN'); cleanup(); });
        remoteSocket.on('close', () => { settleJoin('UNCERTAIN'); cleanup(); });
        remoteSocket.on('end', () => { settleJoin('UNCERTAIN'); cleanup(); });
        try {
          await adapter.confirmParticipant(entry);
          settleJoin('CONFIRMED');
          if (closed) { remoteSocket.destroy(); return; }
          controller.setConnection(entry, { destroy: cleanup });
          socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers)
            .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`).join('')}\r\n`);
          if (remoteHead.length) socket.write(remoteHead);
          if (head.length) remoteSocket.write(head);
          socket.pipe(remoteSocket);
          remoteSocket.pipe(socket);
          remoteSocket.resume();
        } catch { settleJoin('UNCERTAIN'); reject(410); }
      });
      proxyRequest.on('response', () => { settleJoin('REJECTED'); reject(502); });
      proxyRequest.on('error', () => { settleJoin('UNCERTAIN'); reject(502); });
      proxyRequest.on('close', () => { if (!upstreamSocket) settleJoin('UNCERTAIN'); });
      proxyRequest.end();
    } catch (error) {
      settleJoin('UNCERTAIN');
      reject(error instanceof MediaError ? error.status : 502);
    }
  });
  return server;
}
