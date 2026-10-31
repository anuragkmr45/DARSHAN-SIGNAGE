import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPinnedLookup,
  deliverWebhookTest,
  sendPinnedPost,
  validateWebhookTestDestination,
} from './webhook-test-delivery';

const policy = { hosts: ['hook.site.test'], ports: [80, 443], cidrs: ['10.20.0.0/16'] };
const check = (url: string, addresses: string[]) => validateWebhookTestDestination(url, {
  policy, resolveAddresses: async () => addresses,
});

describe('Webhook Test destination policy', () => {
  it('returns the pinned address shape requested by Node lookup callers', async () => {
    const lookup = createPinnedLookup('10.20.1.8');
    await expect(new Promise((resolve, reject) => {
      lookup('hook.site.test', { all: true }, (error, result) => error ? reject(error) : resolve(result));
    })).resolves.toEqual([{ address: '10.20.1.8', family: 4 }]);
    await expect(new Promise((resolve, reject) => {
      lookup('hook.site.test', {}, (error, result, family) =>
        error ? reject(error) : resolve({ address: result, family }));
    })).resolves.toEqual({ address: '10.20.1.8', family: 4 });
  });

  it('accepts approved internal HTTP and HTTPS destinations', async () => {
    expect((await check('http://hook.site.test/', ['10.20.1.8'])).address).toBe('10.20.1.8');
    expect((await check('https://hook.site.test/', ['10.20.1.8'])).url.protocol).toBe('https:');
  });

  it.each([
    ['https://public.test/', ['10.20.1.8']],
    ['https://user:password@hook.site.test/', ['10.20.1.8']],
    ['https://hook.site.test:8443/', ['10.20.1.8']],
    ['https://hook.site.test/', ['8.8.8.8']],
    ['https://hook.site.test/', ['10.21.1.8']],
    ['https://hook.site.test/', ['10.20.1.8', '169.254.169.254']],
    ['https://hook.site.test/', ['100.100.100.200']],
    ['https://hook.site.test/', ['127.0.0.1']],
  ])('rejects disallowed destination %s resolving to %j', async (url, addresses) => {
    await expect(check(url, addresses)).rejects.toMatchObject({ code: 'WEBHOOK_DESTINATION_BLOCKED' });
  });

  it('revalidates a changed DNS answer on each use', async () => {
    const answers = [['10.20.1.8'], ['8.8.8.8']];
    const options = { policy, resolveAddresses: async () => answers.shift() ?? [] };
    await expect(validateWebhookTestDestination('https://hook.site.test/', options)).resolves.toMatchObject({ address: '10.20.1.8' });
    await expect(validateWebhookTestDestination('https://hook.site.test/', options)).rejects.toMatchObject({ code: 'WEBHOOK_DESTINATION_BLOCKED' });
  });
});

describe('Webhook Test delivery boundaries', () => {
  const openServers: ReturnType<typeof createServer>[] = [];

  afterEach(async () => {
    await Promise.all(openServers.splice(0).map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }));
  });

  it('keeps the original hostname while contacting only the validated pinned address', async () => {
    const post = vi.fn(async (url: URL, address: string) => {
      expect(url.hostname).toBe('hook.site.test');
      expect(address).toBe('10.20.1.8');
      return { status: 204 };
    });

    await expect(deliverWebhookTest({ id: 'hook-1', target_url: 'https://hook.site.test/path' }, {
      policy,
      resolveAddresses: async () => ['10.20.1.8'],
      sendPinnedPost: post,
    })).resolves.toMatchObject({ response: { ok: true, status: 204 } });
    expect(post).toHaveBeenCalledOnce();
  });

  it('revalidates a redirect and never contacts a later prohibited DNS answer', async () => {
    const answers = [['10.20.1.8'], ['169.254.169.254']];
    const post = vi.fn(async () => ({ status: 307, location: '/next' }));

    await expect(deliverWebhookTest({ id: 'hook-1', target_url: 'https://hook.site.test/start' }, {
      policy,
      resolveAddresses: async () => answers.shift() ?? [],
      sendPinnedPost: post,
    })).rejects.toMatchObject({ code: 'WEBHOOK_DESTINATION_BLOCKED' });
    expect(post).toHaveBeenCalledOnce();
  });

  it('blocks cross-origin, unsupported, and excessive redirects', async () => {
    const redirectPolicy = { ...policy, hosts: [...policy.hosts, 'other.site.test'] };
    const resolveAddresses = async () => ['10.20.1.8'];

    const crossOriginPost = vi.fn(async () => ({ status: 307, location: 'https://other.site.test/next' }));
    await expect(deliverWebhookTest({ id: 'hook-1', target_url: 'https://hook.site.test/start' }, {
      policy: redirectPolicy,
      resolveAddresses,
      sendPinnedPost: crossOriginPost,
    })).rejects.toMatchObject({ code: 'WEBHOOK_DESTINATION_BLOCKED' });
    expect(crossOriginPost).toHaveBeenCalledOnce();

    const unsupportedPost = vi.fn(async () => ({ status: 302, location: '/next' }));
    await expect(deliverWebhookTest({ id: 'hook-1', target_url: 'https://hook.site.test/start' }, {
      policy,
      resolveAddresses,
      sendPinnedPost: unsupportedPost,
    })).rejects.toMatchObject({ code: 'WEBHOOK_DESTINATION_BLOCKED' });
    expect(unsupportedPost).toHaveBeenCalledOnce();

    const loopPost = vi.fn(async () => ({ status: 307, location: '/next' }));
    await expect(deliverWebhookTest({ id: 'hook-1', target_url: 'https://hook.site.test/start' }, {
      policy,
      resolveAddresses,
      sendPinnedPost: loopPost,
    })).rejects.toMatchObject({ code: 'WEBHOOK_DESTINATION_BLOCKED' });
    expect(loopPost).toHaveBeenCalledTimes(3);
  });

  it.each([
    'host',
    'content-length',
    'connection',
    'transfer-encoding',
    'expect',
    'keep-alive',
    'proxy-authorization',
    'te',
    'trailer',
    'upgrade',
    'x-darshan-forged',
  ])(
    'rejects the unsafe custom header %s before network contact',
    async (header) => {
      const post = vi.fn(async () => ({ status: 204 }));
      await expect(deliverWebhookTest({
        id: 'hook-1',
        target_url: 'https://hook.site.test/',
        headers: { [header]: 'unsafe' },
      }, {
        policy,
        resolveAddresses: async () => ['10.20.1.8'],
        sendPinnedPost: post,
      })).rejects.toMatchObject({ code: 'WEBHOOK_DESTINATION_BLOCKED' });
      expect(post).not.toHaveBeenCalled();
    },
  );

  it('aborts a pinned request at the supplied total timeout', async () => {
    const server = createServer(() => undefined);
    openServers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    await expect(sendPinnedPost(
      new URL(`http://hook.site.test:${port}/`),
      '127.0.0.1',
      {},
      '{}',
      AbortSignal.timeout(30),
    )).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('terminates a pinned request when the response exceeds 64 KiB', async () => {
    const server = createServer((_request, response) => {
      response.end(Buffer.alloc(64 * 1024 + 1, 'x'));
    });
    openServers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    await expect(sendPinnedPost(
      new URL(`http://hook.site.test:${port}/`),
      '127.0.0.1',
      {},
      '{}',
      AbortSignal.timeout(1_000),
    )).rejects.toThrow('Webhook Test response exceeded limit');
  });
});
