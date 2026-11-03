import https from 'node:https';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { config } from '@/config';
import { liveUuid } from '@/schemas/live-runtime';
import { liveError, readPrivateLiveFile, requireLiveAuthorityEpoch } from './live-authority-epoch';

export const liveMediaHealthSchema = z.object({ protocol_version: z.literal(1), node_instance_id: liveUuid,
  managed_instance_id: liveUuid, authority_epoch: liveUuid, authority_mode: z.literal('backend'),
  accepting_new_runs: z.boolean(), status: z.string(), isolation_complete: z.boolean(),
  active_admissions: z.number().int().nonnegative(), occupied_runs: z.number().int().nonnegative(),
  tracked_remaining: z.number().int().nonnegative(), pending_authority_checks: z.number().int().nonnegative(),
  pending_check_limit: z.number().int().positive() }).passthrough();
export type LiveMediaHealth = z.infer<typeof liveMediaHealthSchema>;
export type LiveMediaFence = { run_id: string; generation: number; node_instance_id: string;
  authority_epoch: string; operation_revision: number; id?: string };
export type LiveMediaView = { protocol_version: number; node_instance_id: string; authority_epoch: string;
  run_id?: string; generation?: number; admission_id?: string; state: string; teardown_confirmed: boolean;
  lease_ms?: number; window_remaining_ms?: number; ticket?: string; signal_url?: string };
export interface LiveMediaTransport {
  discover(): Promise<LiveMediaHealth>;
  perform(kind: 'CREATE' | 'REVOKE_ADMISSION' | 'REVOKE_RUN' | 'RENEW' | 'TICKET' | 'RUN_STATUS' | 'ADMISSION_STATUS', fence: LiveMediaFence): Promise<LiveMediaView>;
}
const base = () => {
  requireLiveAuthorityEpoch();
  const target = new URL(config.DARSHAN_LIVE_MEDIA_CONTROL_URL!);
  if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash || !['', '/'].includes(target.pathname)) {
    throw liveError('LIVE_MEDIA_UNAVAILABLE', 'Live media endpoint configuration is invalid.', 503);
  }
  return target;
};
export function liveMediaEndpointFingerprint() { return createHash('sha256').update(base().origin).digest('hex'); }

async function request(path: string, method: 'GET' | 'POST' | 'DELETE', body?: object): Promise<unknown> {
  const origin = base(), secret = readPrivateLiveFile(config.DARSHAN_LIVE_MEDIA_CONTROL_SECRET_FILE!).bytes.toString('utf8').trim();
  if (secret.length < 32 || secret.length > 512 || /[\r\n\0]/.test(secret)) throw liveError('LIVE_MEDIA_UNAVAILABLE', 'Live media credential is unavailable.', 503);
  let ca: Buffer | undefined;
  try { ca = config.DARSHAN_LIVE_MEDIA_CA_CERT_PATH ? readFileSync(config.DARSHAN_LIVE_MEDIA_CA_CERT_PATH) : undefined; }
  catch { throw liveError('LIVE_MEDIA_UNAVAILABLE', 'Live media trust configuration is unavailable.', 503); }
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = () => { if (!settled) { settled = true; reject(liveError('LIVE_MEDIA_UNAVAILABLE', 'Live media service did not confirm the operation.', 503)); } };
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = https.request({ protocol: 'https:', hostname: origin.hostname.replace(/^\[|\]$/g, ''), port: origin.port || 443,
      method, path, ca, rejectUnauthorized: true,
      headers: { 'x-darshan-media-secret': secret, ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}) } }, response => {
      const parts: Buffer[] = []; let bytes = 0;
      response.on('data', (part: Buffer) => {
        bytes += part.length; if (bytes > 8192) { fail(); response.destroy(); req.destroy(); } else parts.push(part);
      });
      response.on('error', fail);
      response.on('end', () => {
        clearTimeout(timer);
        if (settled) return;
        // No redirects or diagnostic/raw error-body propagation; media errors
        // may contain a transient credential and must never reach logs/clients.
        if (response.statusCode === 404) {
          settled = true; reject(liveError('LIVE_MEDIA_NOT_FOUND', 'The assigned media endpoint did not find that identity.', 404)); return;
        }
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300 ||
            !String(response.headers['content-type'] ?? '').toLowerCase().includes('application/json')) { fail(); return; }
        try { const parsed: unknown = JSON.parse(Buffer.concat(parts).toString('utf8')); settled = true; resolve(parsed); } catch { fail(); }
      });
    });
    const timer = setTimeout(() => { fail(); req.destroy(); }, 1500);
    timer.unref();
    req.on('error', () => { clearTimeout(timer); fail(); });
    if (payload) req.write(payload); req.end();
  });
}
const viewSchema = z.object({ protocol_version: z.literal(1), node_instance_id: liveUuid, authority_epoch: liveUuid,
  run_id: liveUuid.optional(), generation: z.number().int().positive().optional(), admission_id: liveUuid.optional(),
  state: z.string(), teardown_confirmed: z.boolean(), lease_ms: z.number().int().nonnegative().optional(),
  window_remaining_ms: z.number().int().nonnegative().optional(), ticket: z.string().optional(), signal_url: z.string().optional() }).passthrough();
export const liveMediaClient: LiveMediaTransport = {
  async discover() {
    const result = liveMediaHealthSchema.safeParse(await request('/internal/health', 'GET'));
    if (!result.success || result.data.status !== 'ready' || result.data.authority_epoch !== requireLiveAuthorityEpoch().epoch_id || result.data.isolation_complete) {
      throw liveError('LIVE_MEDIA_UNAVAILABLE', 'Live media node is not ready for this authority.', 503);
    }
    return result.data;
  },
  async perform(kind, fence) {
    const id = fence.id ? liveUuid.parse(fence.id) : undefined, run = liveUuid.parse(fence.run_id);
    const path = kind === 'CREATE' ? '/internal/admissions' : kind === 'REVOKE_RUN' ? `/internal/runs/${run}/revoke`
      : kind === 'RUN_STATUS' ? `/internal/runs/${run}?generation=${fence.generation}`
        : kind === 'ADMISSION_STATUS' ? `/internal/admissions/${id}`
        : `/internal/admissions/${id}${kind === 'REVOKE_ADMISSION' ? '' : kind === 'RENEW' ? '/renew' : '/ticket'}`;
    const method = kind === 'RUN_STATUS' || kind === 'ADMISSION_STATUS' ? 'GET' : kind === 'REVOKE_ADMISSION' ? 'DELETE' : 'POST';
    const result = viewSchema.safeParse(await request(path, method, method === 'GET' ? undefined : fence));
    if (!result.success || result.data.node_instance_id !== fence.node_instance_id || result.data.authority_epoch !== fence.authority_epoch ||
        result.data.run_id !== fence.run_id || result.data.generation !== fence.generation || (id && result.data.admission_id !== id)) {
      throw liveError('LIVE_MEDIA_FENCE_MISMATCH', 'Live media did not confirm the assigned run identity.', 503);
    }
    return result.data;
  },
};
