import { describe, expect, it } from 'vitest';
import {
  assertWebpageUrlAllowed,
  ipMatchesCidr,
  webpageHostMatches,
} from '@/utils/webpage-url-policy';

const productionPolicy = {
  NODE_ENV: 'production',
  WEBPAGE_ALLOW_HTTP: false,
  WEBPAGE_ALLOWED_PORTS: '443',
  WEBPAGE_NAVIGATION_ALLOWLIST: '*.example.test',
  WEBPAGE_RESOURCE_ALLOWLIST: 'cdn.example.test',
  WEBPAGE_ALLOWED_CIDRS: '',
} as const;

const expectCode = async (promise: Promise<unknown>, code: string) => {
  await expect(promise).rejects.toMatchObject({ name: 'WebpageUrlPolicyError', code });
};

describe('webpage URL policy primitives', () => {
  it('matches wildcard domains only at a DNS label boundary', () => {
    expect(webpageHostMatches('screen.example.com', '*.example.com')).toBe(true);
    expect(webpageHostMatches('deep.screen.example.com', '*.example.com')).toBe(true);
    expect(webpageHostMatches('example.com', '*.example.com')).toBe(false);
    expect(webpageHostMatches('evil-example.com', '*.example.com')).toBe(false);
  });

  it('matches IPv4 and IPv6 CIDRs without accepting adjacent networks', () => {
    expect(ipMatchesCidr('192.168.29.64', '192.168.29.0/24')).toBe(true);
    expect(ipMatchesCidr('192.168.30.1', '192.168.29.0/24')).toBe(false);
    expect(ipMatchesCidr('fd00::10', 'fd00::/8')).toBe(true);
    expect(ipMatchesCidr('fe80::1', 'fd00::/8')).toBe(false);
    expect(ipMatchesCidr('::ffff:192.168.29.64', '::ffff:0:0/96')).toBe(true);
  });

  it('rejects credentials, HTTP, disallowed ports, and wildcard-boundary attacks', async () => {
    const resolvePublic = async () => ['203.0.113.10'];
    await expectCode(assertWebpageUrlAllowed('https://user:secret@screen.example.test/', 'navigation', {
      policy: productionPolicy,
      resolveAddresses: resolvePublic,
    }), 'WEBPAGE_CREDENTIALS_BLOCKED');
    await expectCode(assertWebpageUrlAllowed('http://screen.example.test/', 'navigation', {
      policy: productionPolicy,
      resolveAddresses: resolvePublic,
    }), 'WEBPAGE_SCHEME_BLOCKED');
    await expectCode(assertWebpageUrlAllowed('https://screen.example.test:8443/', 'navigation', {
      policy: productionPolicy,
      resolveAddresses: resolvePublic,
    }), 'WEBPAGE_PORT_BLOCKED');
    await expectCode(assertWebpageUrlAllowed('https://evil-example.test/', 'navigation', {
      policy: productionPolicy,
      resolveAddresses: resolvePublic,
    }), 'WEBPAGE_HOST_NOT_ALLOWED');
  });

  it('applies a separate subresource allowlist', async () => {
    const resolvePublic = async () => ['203.0.113.10'];
    await expect(assertWebpageUrlAllowed('https://cdn.example.test/image.png', 'resource', {
      policy: productionPolicy,
      resolveAddresses: resolvePublic,
    })).resolves.toBeInstanceOf(URL);
    await expectCode(assertWebpageUrlAllowed('https://screen.example.test/script.js', 'resource', {
      policy: productionPolicy,
      resolveAddresses: resolvePublic,
    }), 'WEBPAGE_RESOURCE_BLOCKED');
  });

  it('rechecks every DNS answer and rejects rebinding, link-local, loopback, and metadata addresses', async () => {
    const addresses = [
      ['203.0.113.10'],
      ['10.0.0.5'],
      ['127.0.0.1'],
      ['169.254.169.254'],
      ['fe80::1'],
    ];
    const resolveNext = async () => addresses.shift() ?? [];
    await expect(assertWebpageUrlAllowed('https://screen.example.test/', 'navigation', {
      policy: productionPolicy,
      resolveAddresses: resolveNext,
    })).resolves.toBeInstanceOf(URL);
    for (const code of ['WEBPAGE_ADDRESS_BLOCKED', 'WEBPAGE_ADDRESS_BLOCKED', 'WEBPAGE_ADDRESS_BLOCKED', 'WEBPAGE_ADDRESS_BLOCKED']) {
      await expectCode(assertWebpageUrlAllowed('https://screen.example.test/', 'navigation', {
        policy: productionPolicy,
        resolveAddresses: resolveNext,
      }), code);
    }
  });

  it('allows private destinations only through an explicit CIDR', async () => {
    await expect(assertWebpageUrlAllowed('https://intranet.example.test/', 'navigation', {
      policy: { ...productionPolicy, WEBPAGE_ALLOWED_CIDRS: '10.20.0.0/16' },
      resolveAddresses: async () => ['10.20.1.9'],
    })).resolves.toBeInstanceOf(URL);
  });
});
