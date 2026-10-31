import { createServer, type Server } from 'node:http';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import type { MaintenanceCoordinator, OperationPermit } from '@/maintenance';
import { MaintenanceCoordinatorError } from '@/maintenance';
import { installHttpAdmission } from '@/maintenance/http-admission';
import { buildMediaGatewayRequestOptions, mediaUploadGatewayRoutes } from './media-upload-gateway';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function fakeCoordinator(open: boolean) {
  let admitted = 0;
  let completed = 0;
  let uncertain = 0;
  const coordinator = {
    admit: async (input: { siteKey: string; operationKind: string }): Promise<OperationPermit> => {
      if (!open) {
        throw new MaintenanceCoordinatorError('MAINTENANCE_ADMISSION_CLOSED', 'capture active', {
          retryAt: new Date(Date.now() + 30_000),
        });
      }
      admitted += 1;
      return {
        operationId: `upload-${admitted}`,
        ownerToken: `owner-${admitted}`,
        siteKey: input.siteKey,
        generation: 1,
        operationKind: input.operationKind,
      };
    },
    heartbeat: async () => true,
    complete: async () => { completed += 1; },
    markUncertain: async () => { uncertain += 1; },
  } as unknown as MaintenanceCoordinator;
  return { coordinator, counts: () => ({ admitted, completed, uncertain }) };
}

async function listen(upstream: Server): Promise<number> {
  servers.push(upstream);
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('Test upstream did not expose a TCP port.');
  return address.port;
}

describe('controlled browser upload gateway', () => {
  it('separates private TLS SNI from the public signed Host', () => {
    const options = buildMediaGatewayRequestOptions({
      method: 'PUT',
      headers: { host: 'cms.example.test:443', 'content-type': 'video/mp4' },
      raw: { url: '/media-staging/a.mp4?X-Amz-Signature=test' },
    } as never, {
      endpoint: 'data.internal.example',
      port: 9443,
      useSsl: true,
    });
    expect(options).toMatchObject({
      hostname: 'data.internal.example',
      servername: 'data.internal.example',
      path: '/media-staging/a.mp4?X-Amz-Signature=test',
      headers: { host: 'cms.example.test:443' },
    });
  });

  it('preserves signed path/query/Host and holds admission until MinIO response completes', async () => {
    let releaseResponse!: () => void;
    const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
    let observed!: { url: string; host: string | undefined; body: string };
    let received!: () => void;
    const receivedRequest = new Promise<void>((resolve) => { received = resolve; });
    const port = await listen(createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      observed = { url: request.url ?? '', host: request.headers.host, body: Buffer.concat(chunks).toString() };
      received();
      await responseGate;
      response.writeHead(200, { etag: '"test-etag"' });
      response.end();
    }));
    const fake = fakeCoordinator(true);
    const server = Fastify();
    await installHttpAdmission(server, {
      pool: {} as Pool,
      siteKey: 'gateway-test',
      coordinator: fake.coordinator,
      startWatchdog: false,
    });
    await server.register(mediaUploadGatewayRoutes, { endpoint: '127.0.0.1', port, useSsl: false });
    const responsePromise = server.inject({
      method: 'PUT',
      url: '/media-staging/uploads/a%20b/video.mp4?X-Amz-Signature=abc%2F123',
      headers: { host: 'cms.example.test', 'content-type': 'video/mp4' },
      payload: Buffer.from('video-bytes'),
    });
    await receivedRequest;
    expect(fake.counts()).toEqual({ admitted: 1, completed: 0, uncertain: 0 });
    expect(observed).toEqual({
      url: '/media-staging/uploads/a%20b/video.mp4?X-Amz-Signature=abc%2F123',
      host: 'cms.example.test',
      body: 'video-bytes',
    });
    releaseResponse();
    const response = await responsePromise;
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"test-etag"');
    await new Promise((resolve) => setImmediate(resolve));
    expect(fake.counts()).toEqual({ admitted: 1, completed: 1, uncertain: 0 });
    await server.close();
  });

  it('rejects a new PUT before any bytes reach MinIO while capture admission is closed', async () => {
    let upstreamRequests = 0;
    const port = await listen(createServer((_request, response) => {
      upstreamRequests += 1;
      response.writeHead(500);
      response.end();
    }));
    const fake = fakeCoordinator(false);
    const server = Fastify();
    await installHttpAdmission(server, {
      pool: {} as Pool,
      siteKey: 'gateway-test',
      coordinator: fake.coordinator,
      startWatchdog: false,
    });
    await server.register(mediaUploadGatewayRoutes, { endpoint: '127.0.0.1', port, useSsl: false });
    const response = await server.inject({
      method: 'PUT',
      url: '/media-staging/uploads/blocked.bin?X-Amz-Signature=test',
      headers: { host: 'cms.example.test', 'content-type': 'application/octet-stream' },
      payload: Buffer.from('must-not-arrive'),
    });
    expect(response.statusCode).toBe(503);
    expect(upstreamRequests).toBe(0);
    expect(fake.counts()).toEqual({ admitted: 0, completed: 0, uncertain: 0 });
    await server.close();
  });

  it('marks a streamed PUT uncertain when MinIO closes without a result', async () => {
    const port = await listen(createServer(async (request) => {
      request.resume();
      await new Promise<void>((resolve) => request.once('end', resolve));
      request.socket.destroy();
    }));
    const fake = fakeCoordinator(true);
    const server = Fastify();
    await installHttpAdmission(server, {
      pool: {} as Pool,
      siteKey: 'gateway-test',
      coordinator: fake.coordinator,
      startWatchdog: false,
    });
    await server.register(mediaUploadGatewayRoutes, { endpoint: '127.0.0.1', port, useSsl: false });
    const response = await server.inject({
      method: 'PUT',
      url: '/media-source/uploads/ambiguous.bin?X-Amz-Signature=test',
      headers: { host: 'cms.example.test', 'content-type': 'application/octet-stream' },
      payload: Buffer.from('possibly-committed'),
    });
    expect(response.statusCode).toBe(500);
    await new Promise((resolve) => setImmediate(resolve));
    expect(fake.counts()).toEqual({ admitted: 1, completed: 0, uncertain: 1 });
    await server.close();
  });
});

