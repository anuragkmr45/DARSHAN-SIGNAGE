import { EventEmitter } from 'node:events';
import http, { type ClientRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from '../../src/recovery/controlled-docker/contracts';
import { NodeD3HealthTransport, type D3HealthRequest } from './controlled-recovery-d3-source-health';

const hostname = 'darshan-d2-20261030-minio', raw = Buffer.from('public deterministic unit certificate bytes');
const certificate = { raw, subjectaltname: `DNS:${hostname}`, subject: { CN: hostname } } as unknown as tls.PeerCertificate;
const input = (): D3HealthRequest => ({ role: 'minio', mode: 'unauthenticated', host: '172.30.250.3', servername: hostname, ca: Buffer.from('public fixture CA'), expectedCertificateSha256: sha256(raw), timeoutMs: 666, password: '' });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

type FakeResource = EventEmitter & { closed: boolean; destroyed: boolean; destroy: ReturnType<typeof vi.fn> };
type FakeSocket = FakeResource & { authorized: boolean; authorizationError: Error | null; encrypted: boolean; getPeerCertificate: ReturnType<typeof vi.fn>; isSessionReused: ReturnType<typeof vi.fn> };
function resource(prototype?: object, stalls = false): FakeResource {
  const value = new EventEmitter() as FakeResource;
  if (prototype) Object.setPrototypeOf(value, prototype);
  // Keep the EventEmitter implementation on these deterministic objects: no native socket is constructed.
  for (const method of ['on', 'once', 'emit', 'removeListener'] as const) Object.defineProperty(value, method, { value: EventEmitter.prototype[method], configurable: true });
  Object.defineProperties(value, { closed: { value: false, writable: true }, destroyed: { value: false, writable: true } });
  Object.defineProperty(value, 'destroy', { value: vi.fn(() => { value.destroyed = true; if (!stalls) queueMicrotask(() => { if (!value.closed) { value.closed = true; value.emit('close'); } }); return value; }) });
  return value;
}
type Fault = 'none' | 'skip-callback' | 'wrong-pin' | 'wrong-name' | 'missing-peer' | 'unauthorized' | 'authorization-error' | 'reused' | 'resumed' | 'late-pin' | 'late-unauthorized' | 'socket-mismatch' | 'late-socket-mismatch' | 'agent-retains-socket' | 'status' | 'body-overflow' | 'length' | 'incomplete' | 'body-error' | 'request-error' | 'socket-error' | 'no-response' | 'body-stall' | 'request-close-stall' | 'response-close-stall' | 'socket-close-stall' | 'request-throws';
function harness(fault: Fault = 'none') {
  const requests: Array<{ options: RequestOptions & tls.ConnectionOptions; request: FakeResource & { socket?: FakeSocket; agent?: http.Agent; reusedSocket: boolean; end: ReturnType<typeof vi.fn> }; response: FakeResource & { socket: FakeSocket; statusCode: number; complete: boolean; aborted: boolean; headers: Record<string, string> }; socket: FakeSocket }> = [];
  let pooled: FakeSocket | undefined, callbacks = 0, pooledReuses = 0;
  const factory = (options: RequestOptions & tls.ConnectionOptions, callback: (response: IncomingMessage) => void) => {
    if (fault === 'request-throws') throw new Error('private factory marker');
    const secure = options.ca !== undefined, owned = options.agent instanceof http.Agent;
    const reused = !owned && !!pooled; if (reused) pooledReuses++;
    const socket = reused ? pooled! : resource(secure ? tls.TLSSocket.prototype : net.Socket.prototype, fault === 'socket-close-stall') as FakeSocket;
    if (!reused) {
      Object.assign(socket, { authorized: fault !== 'unauthorized', authorizationError: fault === 'authorization-error' ? new Error('private authorization marker') : null, encrypted: secure,
        getPeerCertificate: vi.fn(() => fault === 'missing-peer' ? {} : { ...certificate, ...(fault === 'wrong-pin' ? { raw: Buffer.from('wrong public peer') } : {}), ...(fault === 'wrong-name' ? { subjectaltname: 'DNS:foreign.invalid', subject: { CN: 'foreign.invalid' } } : {}) }),
        isSessionReused: vi.fn(() => fault === 'resumed') });
      if (!owned) pooled = socket;
    }
    const request = Object.assign(resource(undefined, fault === 'request-close-stall'), { agent: options.agent === false ? undefined : options.agent ?? https.globalAgent, reusedSocket: reused || fault === 'reused', end: vi.fn() }) as typeof requests[number]['request'];
    const body = Buffer.from(secure ? '<Error><Code>AccessDenied</Code></Error>' : 'Client sent an HTTP request to an HTTPS server.');
    const response = Object.assign(resource(undefined, fault === 'response-close-stall'), { socket, statusCode: fault === 'status' ? 999 : secure ? 403 : 400, complete: false, aborted: false, headers: { 'content-length': String(fault === 'length' ? body.length + 1 : body.length) } });
    if (owned) vi.spyOn(options.agent as http.Agent, 'destroy');
    if (fault === 'agent-retains-socket') ((options.agent as http.Agent).sockets as Record<string, net.Socket[]>)['unit-only'] = [socket as unknown as net.Socket];
    const entry = { options, request, response, socket }; requests.push(entry);
    request.end.mockImplementation(() => queueMicrotask(() => {
      request.socket = socket; request.emit('socket', socket);
      if (secure && !reused && fault !== 'skip-callback') { callbacks++; const error = options.checkServerIdentity?.(hostname, certificate); if (error) { request.emit('error', error); return; } }
      if (fault === 'request-error') { request.emit('error', new Error('private request marker')); return; }
      if (fault === 'socket-error') { socket.emit('error', new Error('private socket marker')); return; }
      if (fault === 'no-response') return;
      if (fault === 'socket-mismatch') response.socket = resource(tls.TLSSocket.prototype) as FakeSocket;
      callback(response as unknown as IncomingMessage);
      if (fault === 'body-stall') return;
      if (fault === 'body-error') { response.emit('error', new Error('private body marker')); return; }
      response.emit('data', fault === 'body-overflow' ? Buffer.alloc(8193) : body);
      if (fault === 'late-pin') socket.getPeerCertificate.mockReturnValue({ ...certificate, raw: Buffer.from('changed peer after headers') });
      if (fault === 'late-unauthorized') socket.authorized = false;
      if (fault === 'late-socket-mismatch') response.socket = resource(tls.TLSSocket.prototype) as FakeSocket;
      response.complete = fault !== 'incomplete'; response.emit('end');
    }));
    return request as unknown as ClientRequest;
  };
  vi.spyOn(https, 'request').mockImplementation(factory as typeof https.request);
  vi.spyOn(http, 'request').mockImplementation(factory as typeof http.request);
  return { requests, callbacks: () => callbacks, pooledReuses: () => pooledReuses };
}

describe('D3 fresh owned raw MinIO negative probes', () => {
  it('proves two rounds use distinct owned sockets and independent peer observations instead of the former global pool', async () => {
    const h = harness(), transport = new NodeD3HealthTransport();
    for (let round = 0; round < 2; round++) expect(await transport.s3(input())).toEqual({ ok: false, rejected: 'AUTH', status: 403, certificateSha256: sha256(raw) });
    expect(h.requests).toHaveLength(2); expect(h.requests[0]!.socket).not.toBe(h.requests[1]!.socket); expect(h.requests[0]!.options.agent).not.toBe(h.requests[1]!.options.agent); expect(h.callbacks()).toBe(2); expect(h.pooledReuses()).toBe(0);
    for (const { options, request, response, socket } of h.requests) {
      const agent = options.agent as https.Agent;
      expect(agent).not.toBe(https.globalAgent); expect(agent.options.keepAlive).toBe(false); expect((agent.options as https.AgentOptions).maxCachedSessions).toBe(0); expect(agent.maxSockets).toBe(1); expect(agent.destroy).toHaveBeenCalledOnce();
      expect(options).toMatchObject({ host: '172.30.250.3', port: 9000, path: '/', method: 'GET', rejectUnauthorized: true, servername: hostname, minVersion: 'TLSv1.2' });
      expect(options).not.toHaveProperty('auth'); expect(options).not.toHaveProperty('headers.Authorization'); expect(socket.getPeerCertificate).toHaveBeenCalledTimes(2);
      expect([request.closed, response.closed, socket.closed]).toEqual([true, true, true]); expect(Object.values(agent.sockets).flat()).toEqual([]); expect(Object.values(agent.freeSockets).flat()).toEqual([]); expect(Object.values(agent.requests).flat()).toEqual([]);
    }
  });
  it('uses independently verified live peer state even when the handshake callback is skipped', async () => {
    const h = harness('skip-callback'); expect(await new NodeD3HealthTransport().s3(input())).toMatchObject({ rejected: 'AUTH', certificateSha256: sha256(raw) }); expect(h.callbacks()).toBe(0); expect(h.requests[0]!.socket.getPeerCertificate).toHaveBeenCalledTimes(2);
  });
  it.each(['wrong-pin', 'wrong-name', 'missing-peer', 'unauthorized', 'authorization-error', 'reused', 'resumed', 'late-pin', 'late-unauthorized', 'socket-mismatch', 'late-socket-mismatch', 'agent-retains-socket', 'status', 'body-overflow', 'length', 'incomplete', 'body-error', 'request-error', 'socket-error', 'request-throws'] as const)('fails closed and joins owned resources for %s', async fault => {
    const h = harness(fault), result = await new NodeD3HealthTransport().s3(input()); expect(result).toEqual({ ok: false, certificateSha256: null }); expect(JSON.stringify(result)).not.toContain('private');
    for (const { request, response, socket } of h.requests) { expect(request.closed).toBe(true); expect(socket.closed).toBe(true); if (request.end.mock.calls.length && !['request-error', 'socket-error', 'no-response'].includes(fault)) expect(response.closed).toBe(true); }
    if (fault === 'socket-mismatch' || fault === 'late-socket-mismatch') expect(h.requests[0]!.response.socket.closed).toBe(true);
    if (fault === 'reused' || fault === 'resumed') expect(h.requests[0]!.socket.getPeerCertificate).toHaveBeenCalled();
  });
  it('preserves the bounded plaintext400 TLS_REQUIRED contract without credentials or TLS fallback', async () => {
    const h = harness(); expect(await new NodeD3HealthTransport().s3({ ...input(), mode: 'plaintext' })).toEqual({ ok: false, certificateSha256: null, rejected: 'TLS_REQUIRED', status: 400 }); expect(h.requests[0]!.options).not.toHaveProperty('ca'); expect(h.requests[0]!.options).not.toHaveProperty('auth'); expect(h.requests[0]!.socket.closed).toBe(true);
  });
  it.each(['no-response', 'body-stall', 'request-close-stall', 'response-close-stall', 'socket-close-stall'] as const)('bounds timeout/settlement and refuses success for %s', async fault => {
    vi.useFakeTimers(); const h = harness(fault), result = new NodeD3HealthTransport().s3(input()); await vi.advanceTimersByTimeAsync(1000); expect(await result).toEqual({ ok: false, certificateSha256: null });
    for (const { request, socket } of h.requests) { expect(request.destroy).toHaveBeenCalled(); expect(socket.destroy).toHaveBeenCalled(); } expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps the exact666ms request deadline and clears the separate settlement timer after a safe join', async () => {
    vi.useFakeTimers(); harness('no-response'); let settled = false;
    const result = new NodeD3HealthTransport().s3(input()).then(value => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(665); expect(settled).toBe(false); await vi.advanceTimersByTimeAsync(1); expect(await result).toEqual({ ok: false, certificateSha256: null }); expect(settled).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it('settles an in-flight abort, observes late request/response/socket errors, and leaks no secret or timer', async () => {
    vi.useFakeTimers(); const h = harness('body-stall'), abort = new AbortController(), unhandled: unknown[] = [], listener = (error: unknown) => { unhandled.push(error); }; process.on('unhandledRejection', listener);
    try { const result = new NodeD3HealthTransport().s3({ ...input(), signal: abort.signal }); await Promise.resolve(); abort.abort(); await vi.advanceTimersByTimeAsync(1000); expect(await result).toEqual({ ok: false, certificateSha256: null }); for (const { request, response, socket } of h.requests) { for (const value of [request, response, socket]) value.emit('error', new Error('private late secret marker')); } await Promise.resolve(); expect(unhandled).toEqual([]); expect(vi.getTimerCount()).toBe(0); }
    finally { process.removeListener('unhandledRejection', listener); }
  });
  it('does not create a request for an already aborted caller or invalid deadline', async () => {
    const h = harness(), abort = new AbortController(); abort.abort(); expect(await new NodeD3HealthTransport().s3({ ...input(), signal: abort.signal })).toEqual({ ok: false, certificateSha256: null }); for (const timeoutMs of [0, NaN, Infinity, 2001]) expect(await new NodeD3HealthTransport().s3({ ...input(), timeoutMs })).toEqual({ ok: false, certificateSha256: null }); expect(h.requests).toEqual([]);
  });
  it('observes late errors after a successful closed request without reopening resources or exposing data', async () => {
    vi.useFakeTimers(); const h = harness(); const result = await new NodeD3HealthTransport().s3(input());
    expect(result).toMatchObject({ rejected: 'AUTH', certificateSha256: sha256(raw) });
    for (const { request, response, socket, options } of h.requests) { for (const value of [request, response, socket, options.agent as http.Agent]) expect(() => value.emit('error', new Error('private late marker'))).not.toThrow(); expect((options.agent as http.Agent).destroy).toHaveBeenCalledOnce(); expect([request.closed, response.closed, socket.closed]).toEqual([true, true, true]); }
    expect(JSON.stringify(result)).not.toContain('private'); expect(vi.getTimerCount()).toBe(0);
  });
  it('leaves authenticated S3 on its existing SDK ListBuckets branch', async () => {
    const h = harness(), send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({ $metadata: { httpStatusCode: 200 } } as never);
    expect(await new NodeD3HealthTransport().s3({ ...input(), mode: 'authenticated', accessKey: 'unit-only', secretKey: 'unit-only' })).toMatchObject({ ok: true, status: 200 }); expect(send.mock.calls[0]?.[0]).toBeInstanceOf(ListBucketsCommand); expect(h.requests).toEqual([]);
  });
});
