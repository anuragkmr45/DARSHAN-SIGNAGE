import { constants, openSync, closeSync, fstatSync, lstatSync, readFileSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from '@/config';
import { AppError } from '@/utils/app-error';

const epochSchema = z.object({ version: z.literal(1), epoch_id: z.string().uuid().transform(v => v.toLowerCase()),
  authority_secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/).refine(value => {
    const bytes = Buffer.from(value, 'base64url'); return bytes.length === 32 && bytes.toString('base64url') === value;
  }) }).strict();
export function liveError(code: string, message: string, statusCode = 409, details?: Record<string, unknown>): AppError {
  return new AppError({ code, message, statusCode, details });
}
export function readPrivateLiveFile(file: string) {
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = fstatSync(fd), named = lstatSync(file);
    if (!before.isFile() || named.isSymbolicLink() || before.dev !== named.dev || before.ino !== named.ino ||
        before.size < 1 || before.size > 4096 || (process.platform !== 'win32' && ((before.mode & 0o077) !== 0 ||
        (before.uid !== process.getuid?.() && before.uid !== 0)))) throw new Error('Private file policy');
    const bytes = readFileSync(fd);
    const after = fstatSync(fd), namedAfter = lstatSync(file);
    if (bytes.length > 4096 || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || after.dev !== namedAfter.dev || after.ino !== namedAfter.ino) {
      throw new Error('Private file changed');
    }
    return { bytes, identity: `${after.dev}:${after.ino}:${after.mode}:${after.uid}:${createHash('sha256').update(bytes).digest('hex')}` };
  } catch { throw liveError('LIVE_AUTHORITY_UNAVAILABLE', 'Live authority configuration is unavailable.', 503); }
  finally { if (fd !== undefined) closeSync(fd); }
}

export class LiveAuthorityEpochGuard {
  private readonly identity: string;
  private readonly authority: z.infer<typeof epochSchema>;
  private invalid = false;
  constructor(private readonly file: string) {
    const first = readPrivateLiveFile(file); this.identity = first.identity;
    let json: unknown;
    try { json = JSON.parse(first.bytes.toString('utf8')); }
    catch { throw liveError('LIVE_AUTHORITY_UNAVAILABLE', 'Live authority file is invalid.', 503); }
    const parsed = epochSchema.safeParse(json);
    if (!parsed.success) throw liveError('LIVE_AUTHORITY_UNAVAILABLE', 'Live authority file is invalid.', 503);
    this.authority = parsed.data;
  }
  current() {
    if (this.invalid) throw liveError('LIVE_AUTHORITY_EPOCH_CHANGED', 'Live authority changed; restart and reconcile before enabling live.', 503);
    try {
      if (readPrivateLiveFile(this.file).identity !== this.identity) throw new Error('Epoch changed');
    } catch {
      this.invalid = true;
      throw liveError('LIVE_AUTHORITY_EPOCH_CHANGED', 'Live authority changed; restart and reconcile before enabling live.', 503);
    }
    return this.authority;
  }
  acceptsSecret(supplied: unknown) {
    const authority = this.current();
    if (typeof supplied !== 'string') return false;
    const a = Buffer.from(supplied), b = Buffer.from(authority.authority_secret);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
let guard: LiveAuthorityEpochGuard | undefined;
export function initializeLiveAuthorityEpoch() {
  if (!config.DARSHAN_LIVE_RUNTIME_ENABLED) return;
  if (!config.DARSHAN_LIVE_AUTHORITY_FILE || !config.DARSHAN_LIVE_MEDIA_CONTROL_URL || !config.DARSHAN_LIVE_MEDIA_CONTROL_SECRET_FILE ||
      !config.DEVICE_DESIRED_STATE_ENABLED || !config.COMMAND_OUTBOX_WRITE_ENABLED) {
    throw liveError('LIVE_AUTHORITY_UNAVAILABLE', 'Enabled live runtime requires external authority, media control and durable desired-state/outbox configuration.', 503);
  }
  const target = new URL(config.DARSHAN_LIVE_MEDIA_CONTROL_URL);
  if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash || !['', '/'].includes(target.pathname)) {
    throw liveError('LIVE_AUTHORITY_UNAVAILABLE', 'Live media control must use a configured HTTPS origin without credentials or path.', 503);
  }
  guard ??= new LiveAuthorityEpochGuard(config.DARSHAN_LIVE_AUTHORITY_FILE);
  guard.current();
}
export function requireLiveAuthorityEpoch() {
  if (!config.DARSHAN_LIVE_RUNTIME_ENABLED) throw liveError('LIVE_RUNTIME_DISABLED', 'Scheduled live runtime is disabled.', 503);
  if (!guard) initializeLiveAuthorityEpoch();
  return guard!.current();
}
export function authenticateLiveAuthoritySecret(supplied: unknown) {
  requireLiveAuthorityEpoch();
  if (!guard!.acceptsSecret(supplied)) throw AppError.unauthorized('Invalid live authority authentication.');
}
