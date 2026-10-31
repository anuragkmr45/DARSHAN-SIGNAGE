import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { parseTrustedProxyCidrs } from './trusted-proxy';

describe('trusted reverse proxy rate-limit identity', () => {
  it('rejects broad or malformed proxy trust', () => {
    expect(parseTrustedProxyCidrs('')).toBe(false);
    expect(() => parseTrustedProxyCidrs('0.0.0.0/0')).toThrow();
    expect(() => parseTrustedProxyCidrs('example.com')).toThrow();
    expect(parseTrustedProxyCidrs('127.0.0.1,10.20.0.0/24')).toEqual(['127.0.0.1', '10.20.0.0/24']);
  });

  it('separates devices behind an approved proxy and ignores spoofed headers from direct clients', async () => {
    const app = Fastify({ trustProxy: parseTrustedProxyCidrs('10.20.0.1') });
    await app.register(rateLimit, { max: 1, timeWindow: '1 minute' });
    app.get('/device', async (request) => ({ ip: request.ip }));
    const first = await app.inject({ method: 'GET', url: '/device', remoteAddress: '10.20.0.1', headers: { 'x-forwarded-for': '192.168.10.1' } });
    const second = await app.inject({ method: 'GET', url: '/device', remoteAddress: '10.20.0.1', headers: { 'x-forwarded-for': '192.168.10.2' } });
    const directFirst = await app.inject({ method: 'GET', url: '/device', remoteAddress: '192.168.20.1', headers: { 'x-forwarded-for': '192.168.10.3' } });
    const directSecond = await app.inject({ method: 'GET', url: '/device', remoteAddress: '192.168.20.1', headers: { 'x-forwarded-for': '192.168.10.4' } });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(directFirst.statusCode).toBe(200);
    expect(directSecond.statusCode).toBe(429);
    await app.close();
  });
});
