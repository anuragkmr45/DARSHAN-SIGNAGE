import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { AppError } from '@/utils/app-error';
import { ipMatchesCidr, isHardDeniedAddress, isPrivateAddress, webpageHostMatches } from '@/utils/webpage-url-policy';

const MAX_REDIRECTS = 2;
const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 5_000;
const csv = (value: string) => value.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);

type Policy = { hosts: string[]; ports: number[]; cidrs: string[] };
type Resolve = (host: string) => Promise<string[]>;

function configuredPolicy(): Policy {
  return {
    hosts: csv(process.env.WEBHOOK_TEST_ALLOWED_HOSTS ?? ''),
    ports: csv(process.env.WEBHOOK_TEST_ALLOWED_PORTS ?? '80,443').map(Number),
    cidrs: csv(process.env.WEBHOOK_TEST_ALLOWED_CIDRS ?? ''),
  };
}

function blocked(message: string): never {
  throw new AppError({ statusCode: 400, code: 'WEBHOOK_DESTINATION_BLOCKED', message });
}

export async function validateWebhookTestDestination(
  rawUrl: string,
  options: { policy?: Policy; resolveAddresses?: Resolve } = {}
): Promise<{ url: URL; address: string }> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return blocked('Webhook Test URL is invalid.'); }
  if (url.username || url.password) return blocked('Webhook Test URL credentials are prohibited.');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return blocked('Webhook Test requires HTTP or HTTPS.');
  const policy = options.policy ?? configuredPolicy();
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (!policy.ports.includes(port)) return blocked('Webhook Test port is not approved.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!policy.hosts.some((pattern) => webpageHostMatches(host, pattern))) {
    return blocked('Webhook Test host is not approved.');
  }
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : options.resolveAddresses
      ? await options.resolveAddresses(host)
      : (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
  } catch { return blocked('Webhook Test destination could not be resolved.'); }
  if (addresses.length === 0 || addresses.some((address) =>
    isHardDeniedAddress(address) || !isPrivateAddress(address)
      || !policy.cidrs.some((cidr) => ipMatchesCidr(address, cidr)))) {
    return blocked('Webhook Test address is outside approved private networks.');
  }
  return { url, address: addresses[0]! };
}

function sendPinnedPost(url: URL, address: string, headers: Record<string, string>, body: string, signal: AbortSignal): Promise<{ status: number; location?: string }> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'POST', headers, signal,
      // The socket uses the address already checked above. TLS still verifies
      // the original URL hostname, so DNS changes cannot redirect this hop.
      lookup: ((_host: string, _options: unknown, callback: (error: Error | null, address: string, family: number) => void) => {
        callback(null, address, isIP(address));
      }) as any,
    }, (response) => {
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          request.destroy(new Error('Webhook Test response exceeded limit'));
        }
      });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode ?? 502, location: response.headers.location }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

export async function deliverWebhookTest(record: {
  id: string; target_url: string; headers?: Record<string, string> | null;
}): Promise<{ response: { ok: boolean; status: number }; sentAt: string }> {
  const sentAt = new Date().toISOString();
  const body = JSON.stringify({ type: 'webhook.test', sent_at: sentAt, webhook_id: record.id });
  const custom = Object.fromEntries(Object.entries(record.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  for (const key of Object.keys(custom)) {
    if (!/^[a-z0-9-]+$/.test(key) || ['host', 'content-length', 'connection', 'transfer-encoding'].includes(key) || key.startsWith('x-darshan-')) {
      return blocked('Webhook Test contains an unsafe custom header.');
    }
  }
  const headers = {
    ...custom,
    'content-type': 'application/json',
    'user-agent': 'darshan-webhook-test',
    'x-darshan-event': 'webhook.test',
    'x-darshan-sent-at': sentAt,
    'x-darshan-webhook-id': record.id,
  };
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let next = record.target_url;
  const first = await validateWebhookTestDestination(next);
  const firstOrigin = first.url.origin;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const { url, address } = redirect === 0 ? first : await validateWebhookTestDestination(next);
    if (url.origin !== firstOrigin) return blocked('Webhook Test redirect changed origin.');
    const response = await sendPinnedPost(url, address, headers, body, signal);
    if (response.status === 307 || response.status === 308) {
      if (!response.location || redirect === MAX_REDIRECTS) return blocked('Webhook Test redirect limit exceeded.');
      next = new URL(response.location, url).toString();
      continue;
    }
    if (response.status >= 300 && response.status < 400) return blocked('Webhook Test redirect status is not supported.');
    return { response: { ok: response.status >= 200 && response.status < 300, status: response.status }, sentAt };
  }
  return blocked('Webhook Test redirect limit exceeded.');
}
