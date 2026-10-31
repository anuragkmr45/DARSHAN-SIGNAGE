import { createConnection } from 'node:net';
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { RecoveryError } from './errors';
import type { RecoveryTargetTransport } from './target-client';
import { TARGET_HELPER_MAX_REQUEST_BYTES, TARGET_HELPER_MAX_RESPONSE_BYTES } from './target-helper-protocol';
import { encodeTargetUnixFrame, TargetUnixFrameDecoder, TARGET_UNIX_INCOMPLETE_FRAME_TIMEOUT_MS } from './target-unix-framing';

export type TargetUnixFailureClassification =
  | 'CANCELLED_BEFORE_DISPATCH'
  | 'CANCELLED_AFTER_DISPATCH'
  | 'TIMEOUT_BEFORE_DISPATCH'
  | 'TIMEOUT_AFTER_DISPATCH'
  | 'DISCONNECTED_BEFORE_DISPATCH'
  | 'LOST_RESPONSE_AFTER_DISPATCH'
  | 'RESPONSE_INVALID';

export class TargetUnixTransportError extends RecoveryError {
  constructor(public readonly classification: TargetUnixFailureClassification, message: string, options?: ErrorOptions) {
    super(classification === 'CANCELLED_BEFORE_DISPATCH' || classification === 'CANCELLED_AFTER_DISPATCH'
      ? 'RECOVERY_CANCELLED' : 'RECOVERY_TARGET_TRANSPORT_FAILED', message, options);
    this.name = 'TargetUnixTransportError';
  }
}

export class TargetUnixClient implements RecoveryTargetTransport {
  private readonly socketPath: string;
  private readonly actionDeadlineMs: number;
  private readonly socketAuthority: { uid: number; gid: number };
  constructor(options: { socketPath: string; actionDeadlineMs: number; socketAuthority?: { uid: number; gid: number } }) {
    if (!isAbsolute(options.socketPath) || resolve(options.socketPath) !== options.socketPath || options.socketPath.endsWith(sep) ||
        Buffer.byteLength(options.socketPath) > 107) {
      throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Target relay socket path must be fixed, canonical, absolute, and Linux-bounded.');
    }
    if (!Number.isSafeInteger(options.actionDeadlineMs) || options.actionDeadlineMs < 1 || options.actionDeadlineMs > 240_000) {
      throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Target action deadline is outside the reviewed bound.');
    }
    const authority = options.socketAuthority ?? { uid: 0, gid: process.getgid?.() ?? -1 };
    if (!Number.isSafeInteger(authority.uid) || authority.uid < 0 || !Number.isSafeInteger(authority.gid) || authority.gid < 0) {
      throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Target relay socket authority is invalid.');
    }
    this.socketPath = options.socketPath; this.actionDeadlineMs = options.actionDeadlineMs; this.socketAuthority = authority;
  }

  private async verifySocket(): Promise<{ dev: bigint; ino: bigint }> {
    const parent = dirname(this.socketPath);
    try {
      const [parentState, parentReal, socketState, socketReal] = await Promise.all([
        fs.lstat(parent, { bigint: true }), fs.realpath(parent), fs.lstat(this.socketPath, { bigint: true }), fs.realpath(this.socketPath),
      ]);
      if (parentState.isSymbolicLink() || !parentState.isDirectory() || parentReal !== parent ||
          Number(parentState.uid) !== this.socketAuthority.uid || Number(parentState.gid) !== this.socketAuthority.gid ||
          Number(parentState.mode & 0o777n) !== 0o710 || socketState.isSymbolicLink() || !socketState.isSocket() ||
          socketReal !== this.socketPath || Number(socketState.uid) !== this.socketAuthority.uid ||
          Number(socketState.gid) !== this.socketAuthority.gid || Number(socketState.mode & 0o777n) !== 0o660) {
        throw new Error('relay socket metadata mismatch');
      }
      return { dev: socketState.dev, ino: socketState.ino };
    } catch (cause) {
      throw new TargetUnixTransportError('DISCONNECTED_BEFORE_DISPATCH',
        'Target relay socket authority is unavailable or unsafe.', { cause });
    }
  }

  async request(bytes: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
    const frame = encodeTargetUnixFrame(bytes, TARGET_HELPER_MAX_REQUEST_BYTES);
    if (signal?.aborted) throw new TargetUnixTransportError('CANCELLED_BEFORE_DISPATCH', 'Target request was cancelled before dispatch.');
    const socketIdentity = await this.verifySocket();
    if (signal?.aborted) throw new TargetUnixTransportError('CANCELLED_BEFORE_DISPATCH', 'Target request was cancelled before dispatch.');
    return new Promise((resolvePromise, rejectPromise) => {
      let dispatched = false; let settled = false; let frameTimer: NodeJS.Timeout | undefined;
      const actionDeadline = Date.now() + this.actionDeadlineMs;
      const decoder = new TargetUnixFrameDecoder(TARGET_HELPER_MAX_RESPONSE_BYTES);
      const settle = (error?: unknown, response?: Buffer) => {
        if (settled) return; settled = true; clearTimeout(actionTimer); if (frameTimer) clearTimeout(frameTimer);
        signal?.removeEventListener('abort', onAbort); socket.destroy();
        if (error) rejectPromise(error); else resolvePromise(response!);
      };
      const classify = (before: TargetUnixFailureClassification, after: TargetUnixFailureClassification,
        message: string, cause?: unknown) => settle(new TargetUnixTransportError(dispatched ? after : before, message, { cause }));
      const onAbort = () => classify('CANCELLED_BEFORE_DISPATCH', 'CANCELLED_AFTER_DISPATCH', 'Target request was cancelled.');
      const actionTimer = setTimeout(() => classify('TIMEOUT_BEFORE_DISPATCH', 'TIMEOUT_AFTER_DISPATCH',
        'Target request exceeded its explicit action deadline.'), this.actionDeadlineMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      const socket = createConnection({ path: this.socketPath });
      socket.once('connect', () => { void fs.lstat(this.socketPath, { bigint: true }).then((state) => {
        if (!state.isSocket() || state.dev !== socketIdentity.dev || state.ino !== socketIdentity.ino ||
            Number(state.uid) !== this.socketAuthority.uid || Number(state.gid) !== this.socketAuthority.gid ||
            Number(state.mode & 0o777n) !== 0o660) {
          classify('DISCONNECTED_BEFORE_DISPATCH', 'LOST_RESPONSE_AFTER_DISPATCH', 'Target relay socket identity changed before dispatch.');
          return;
        }
        if (!settled) socket.end(frame, () => { dispatched = true; });
      }, (cause) => classify('DISCONNECTED_BEFORE_DISPATCH', 'LOST_RESPONSE_AFTER_DISPATCH',
        'Target relay socket disappeared before dispatch.', cause)); });
      socket.on('data', (chunk) => {
        if (!frameTimer && chunk.byteLength > 0) {
          const remaining = Math.max(1, Math.min(TARGET_UNIX_INCOMPLETE_FRAME_TIMEOUT_MS, actionDeadline - Date.now()));
          frameTimer = setTimeout(() => classify('TIMEOUT_BEFORE_DISPATCH', 'TIMEOUT_AFTER_DISPATCH',
            'Target response frame was incomplete for five seconds after framing began.'), remaining);
        }
        try { decoder.push(chunk); }
        catch (cause) { classify('RESPONSE_INVALID', 'RESPONSE_INVALID', 'Target response framing is invalid.', cause); return; }
      });
      socket.once('end', () => {
        try { settle(undefined, decoder.finish()); }
        catch (cause) { classify('RESPONSE_INVALID', 'LOST_RESPONSE_AFTER_DISPATCH', 'Target response ended without one complete canonical frame.', cause); }
      });
      socket.once('error', (cause) => classify('DISCONNECTED_BEFORE_DISPATCH', 'LOST_RESPONSE_AFTER_DISPATCH',
        'Target Unix connection failed or was lost.', cause));
      socket.once('close', (hadError) => {
        if (!settled && !hadError) classify('DISCONNECTED_BEFORE_DISPATCH', 'LOST_RESPONSE_AFTER_DISPATCH',
          'Target Unix connection closed before a complete response.');
      });
    });
  }
}
