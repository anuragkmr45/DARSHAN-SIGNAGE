import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { closeTestServer, createTestServer } from '@/test/helpers';
import { HTTP_STATUS } from '@/http-status-codes';

describe('Settings routes default media auth contract', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await createTestServer();
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('requires authentication for default media settings reads', async () => {
    const [defaultMediaResponse, variantsResponse, targetsResponse] = await Promise.all([
      server.inject({
        method: 'GET',
        url: '/api/v1/settings/default-media',
      }),
      server.inject({
        method: 'GET',
        url: '/api/v1/settings/default-media/variants',
      }),
      server.inject({
        method: 'GET',
        url: '/api/v1/settings/default-media/targets',
      }),
    ]);

    expect(defaultMediaResponse.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(variantsResponse.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(targetsResponse.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});
