import { describe, expect, it } from 'vitest';
import { createPinnedLookup, validateWebhookTestDestination } from './webhook-test-delivery';

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
