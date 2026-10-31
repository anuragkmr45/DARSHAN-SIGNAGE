import { RecoveryError } from './errors';
import { TARGET_HELPER_MAX_CONNECTIONS, TARGET_HELPER_MAX_REQUEST_BYTES,
  TARGET_HELPER_MAX_RESPONSE_BYTES, TARGET_HELPER_REQUEST_TIMEOUT_MS } from './target-helper-protocol';

export const TARGET_UNIX_MAX_ACCEPTED_CONNECTIONS = TARGET_HELPER_MAX_CONNECTIONS;
export const TARGET_UNIX_INCOMPLETE_FRAME_TIMEOUT_MS = TARGET_HELPER_REQUEST_TIMEOUT_MS;

export function encodeTargetUnixFrame(payload: Uint8Array, maximumBytes: number): Buffer {
  const bytes = Buffer.from(payload);
  const newline = bytes.indexOf(0x0a);
  if (bytes.byteLength < 2 || bytes.byteLength > maximumBytes || bytes.includes(0x0d) ||
      newline !== bytes.byteLength - 1 || bytes.indexOf(0x0a, newline + 1) !== -1) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Target Unix payload is not exactly one canonical newline-terminated JSON value.');
  }
  return bytes;
}

export class TargetUnixFrameDecoder {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  private newline = -1;

  constructor(private readonly maximumBytes: number) {}

  push(chunk: Uint8Array): void {
    const bytes = Buffer.from(chunk);
    if (bytes.byteLength === 0) return;
    const nextSize = this.size + bytes.byteLength;
    if (nextSize > this.maximumBytes) {
      throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Target Unix frame exceeds its reviewed bound.');
    }
    const newline = bytes.indexOf(0x0a);
    if (newline !== -1) {
      if (this.newline !== -1 || bytes.indexOf(0x0a, newline + 1) !== -1 || newline !== bytes.byteLength - 1) {
        throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Target Unix transport accepts exactly one terminal newline.');
      }
      this.newline = this.size + newline;
    } else if (this.newline !== -1) {
      throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Trailing bytes after the target Unix frame are forbidden.');
    }
    if (bytes.includes(0x0d)) throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Carriage returns are forbidden in target Unix frames.');
    this.chunks.push(bytes); this.size = nextSize;
  }

  finish(): Buffer {
    if (this.newline < 1 || this.newline !== this.size - 1) {
      throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Target Unix frame requires one canonical newline followed by EOF.');
    }
    return Buffer.concat(this.chunks, this.size);
  }
}

async function nextWithTimeout<T>(iterator: AsyncIterator<T>, timeoutMs: number, signal?: AbortSignal): Promise<IteratorResult<T>> {
  signal?.throwIfAborted();
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const pending: Array<Promise<IteratorResult<T>>> = [iterator.next(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new RecoveryError('RECOVERY_TARGET_TRANSPORT_FAILED',
        'Target Unix request did not complete its frame before the fixed timeout.')), timeoutMs);
    })];
    if (signal) pending.push(new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason ?? new RecoveryError('RECOVERY_CANCELLED', 'Target Unix request was cancelled.'));
      signal.addEventListener('abort', onAbort, { once: true });
    }));
    return await Promise.race(pending);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}

async function invokeWithAbort<T>(invoke: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([invoke(), new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason ?? new RecoveryError('RECOVERY_CANCELLED', 'Target action was cancelled.'));
      signal.addEventListener('abort', onAbort, { once: true });
    })]);
  } finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
}

/** Pure connection/framing gate. Native pathname ownership and accept loops remain a later packet. */
export class BoundedTargetUnixGateway {
  private active = 0;
  constructor(private readonly options: {
    handle(payload: Uint8Array, signal?: AbortSignal): Promise<Uint8Array>;
    actionDeadlineMs: number;
  }) {
    if (!Number.isSafeInteger(options.actionDeadlineMs) || options.actionDeadlineMs < 1) {
      throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Target action deadline must be a positive explicit integer.');
    }
  }

  async handleConnection(chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<Buffer> {
    if (this.active >= TARGET_UNIX_MAX_ACCEPTED_CONNECTIONS) {
      throw new RecoveryError('RECOVERY_TARGET_TRANSPORT_FAILED', 'Target Unix connection limit is reached.');
    }
    this.active += 1;
    try {
      const decoder = new TargetUnixFrameDecoder(TARGET_HELPER_MAX_REQUEST_BYTES);
      const iterator = chunks[Symbol.asyncIterator]();
      const actionDeadline = Date.now() + this.options.actionDeadlineMs;
      let done = false; let frameDeadline: number | undefined;
      try {
        while (!done) {
          const deadline = Math.min(actionDeadline, frameDeadline ?? actionDeadline); const remaining = deadline - Date.now();
          if (remaining <= 0) throw new RecoveryError('RECOVERY_TARGET_TRANSPORT_FAILED', frameDeadline === undefined
            ? 'Target Unix connection exceeded its action deadline before framing began.'
            : 'Target Unix request exceeded the absolute incomplete-frame timeout.');
          const item = await nextWithTimeout(iterator, remaining, signal);
          done = Boolean(item.done);
          if (!item.done) {
            if (frameDeadline === undefined && item.value.byteLength > 0) {
              frameDeadline = Date.now() + TARGET_UNIX_INCOMPLETE_FRAME_TIMEOUT_MS;
            }
            decoder.push(item.value);
          }
        }
      } catch (cause) {
        if (!done) void iterator.return?.().catch(() => undefined);
        throw cause;
      }
      const payload = decoder.finish();
      const actionRemaining = actionDeadline - Date.now();
      if (actionRemaining <= 0) throw new RecoveryError('RECOVERY_TARGET_TRANSPORT_FAILED',
        'Target action deadline elapsed before dispatch.');
      const deadline = AbortSignal.timeout(actionRemaining);
      const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
      let response: Uint8Array;
      try { response = await invokeWithAbort(() => this.options.handle(payload, combined), combined); }
      catch (cause) {
        if (deadline.aborted && !signal?.aborted) {
          throw new RecoveryError('RECOVERY_TARGET_TRANSPORT_FAILED', 'Target action exceeded its separate deadline.', { cause });
        }
        throw cause;
      }
      return encodeTargetUnixFrame(response, TARGET_HELPER_MAX_RESPONSE_BYTES);
    } finally { this.active -= 1; }
  }
}
